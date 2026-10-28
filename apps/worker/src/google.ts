import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { owner } from './env';
import { hash, now } from './store';
import { deliverNotifications } from './pipeline';

const encode=(b:Uint8Array)=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function encryptionKey(env:Env){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.GOOGLE_TOKEN_ENCRYPTION_KEY!)),'AES-GCM',false,['encrypt','decrypt']);}
export async function encrypt(env:Env,value:unknown){const iv=crypto.getRandomValues(new Uint8Array(12));return `${encode(iv)}.${encode(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(env),new TextEncoder().encode(JSON.stringify(value)))))}`;}
async function decrypt(env:Env,value:string){const [iv,body]=value.split('.');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv)},await encryptionKey(env),decode(body))));}
const configured=(env:Env)=>!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_TOKEN_ENCRYPTION_KEY&&env.GOOGLE_TOKEN_ENCRYPTION_KEY.length>=32);
async function token(env:Env,provider:string){
 const row=await env.DB.prepare('SELECT encrypted_credentials FROM integration_state WHERE user_id=? AND provider=?').bind(owner(env),provider).first<{encrypted_credentials:string}>();
 if(!row?.encrypted_credentials||!configured(env))throw new Error('GOOGLE_NOT_CONNECTED');
 const credentials=await decrypt(env,row.encrypted_credentials);
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID!,client_secret:env.GOOGLE_CLIENT_SECRET!,grant_type:'refresh_token',refresh_token:credentials.refresh_token}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('GOOGLE_REFRESH_FAILED');
 return (await r.json() as {access_token:string}).access_token;
}
async function googleFetch(access:string,url:string,init?:RequestInit){const r=await fetch(url,{...init,headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json',...init?.headers},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`GOOGLE_${r.status}`);return r.json() as Promise<any>;}
export function classifyEmail(text:string):string {
 if(/offer (?:of employment|letter)|pleased to offer|extend.{0,20}offer/i.test(text))return 'OFFER';
 if(/not (?:be )?moving forward|other candidates|unfortunately.{0,100}(?:application|position)|decided not to proceed/i.test(text))return 'REJECTED';
 if(/final (?:round|interview)/i.test(text))return 'FINAL_ROUND';
 if(/technical interview/i.test(text))return 'TECHNICAL_INTERVIEW';
 if(/schedule.{0,50}interview|interview (?:invitation|request)|like to.{0,30}interview/i.test(text))return 'INTERVIEW';
 if(/coding (?:assessment|challenge)|online assessment|complete.{0,40}assessment/i.test(text))return 'ONLINE_ASSESSMENT';
 if(/thank you for applying|application (?:received|confirmation)|received your application/i.test(text))return 'APPLICATION_CONFIRMED';
 return 'OTHER';
}
const stage:Record<string,number>={NEW:0,SAVED:0,REVIEW:0,APPLYING:0,APPLIED:1,APPLICATION_CONFIRMED:2,RECRUITER_RESPONSE:3,ONLINE_ASSESSMENT:4,INTERVIEW:5,TECHNICAL_INTERVIEW:6,FINAL_ROUND:7,OFFER:8};
export function mayAdvance(current:string,next:string){return !['OFFER','REJECTED','WITHDRAWN','CLOSED'].includes(current) && (next==='REJECTED'||(stage[next]??-1)>(stage[current]??0));}
export async function pollGmail(env:Env){
 const state=await env.DB.prepare("SELECT * FROM integration_state WHERE user_id=? AND provider='gmail' AND encrypted_credentials IS NOT NULL").bind(owner(env)).first<{cursor:string;data_json:string}>();
 if(!state||!configured(env))return;
 const access=await token(env,'gmail'),meta=JSON.parse(state.data_json||'{}');
 const after=meta.last_poll?Math.floor(Date.parse(meta.last_poll)/1000)-86400:Math.floor(Date.now()/1000)-30*86400;
 const q=`after:${after} {application interview assessment recruiter offer}`;
 const page=await googleFetch(access,`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({q,maxResults:'20',...(state.cursor?{pageToken:state.cursor}:{})})}`);
 for(const item of page.messages ?? []) {
  if(await env.DB.prepare('SELECT id FROM email_events WHERE user_id=? AND provider_message_id=?').bind(owner(env),item.id).first())continue;
  const message=await googleFetch(access,`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
  const headers=message.payload?.headers ?? [],subject=headers.find((x:any)=>x.name.toLowerCase()==='subject')?.value ?? '';
  const text=`${subject} ${message.snippet ?? ''}`,classification=classifyEmail(text),occurred=new Date(Number(message.internalDate)).toISOString();
  const candidates=await env.DB.prepare("SELECT a.*,j.company,j.title FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=? AND a.applied_at<=? AND j.is_sample=0").bind(owner(env),occurred).all<{id:string;company:string;title:string;apply_url:string;status:string;last_response_at:string|null;version:number}>();
  // Both exact company and full role names must occur; weaker matches are retained for review.
  const matches=candidates.results.filter(a=>text.toLowerCase().includes(a.company.toLowerCase())&&text.toLowerCase().includes(a.title.toLowerCase()));
  const application=matches.length===1?matches[0]:null;
  const from=headers.find((x:any)=>x.name.toLowerCase()==='from')?.value ?? '';
  const senderDomain=(from.match(/@([a-z0-9.-]+)/i)?.[1] ?? '').toLowerCase();
  let expectedDomain='';try{expectedDomain=new URL(application?.apply_url ?? '').hostname.replace(/^www\./,'');}catch{}
  const senderMatches=senderDomain && expectedDomain && (senderDomain===expectedDomain || senderDomain.endsWith(`.${expectedDomain}`));
  const shouldUpdate=application && senderMatches && classification!=='OTHER' && mayAdvance(application.status,classification) && (!application.last_response_at||occurred>application.last_response_at);
  const id=crypto.randomUUID();
  const batch=[env.DB.prepare('INSERT INTO email_events(id,user_id,provider_message_id,application_id,classification,confidence,state,provider_occurred_at,received_at,evidence_json) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,owner(env),item.id,application?.id ?? null,classification,shouldUpdate?0.96:0.4,'REVIEW_REQUIRED',occurred,now(),JSON.stringify({subject:subject.slice(0,300),from,candidate_ids:matches.map(a=>a.id)}))];
  if(shouldUpdate)batch.push(env.DB.prepare("UPDATE applications SET status=?,last_response_at=?,version=version+1,transition_actor='gmail',transition_reason='Exact company and role match in employer message',transition_event_key=?,updated_at=? WHERE id=? AND version=?").bind(classification,occurred,`email:${item.id}`,now(),application.id,application.version));
  if(shouldUpdate)batch.push(
    env.DB.prepare("UPDATE email_events SET state='APPLIED' WHERE id=? AND EXISTS(SELECT 1 FROM application_status_history WHERE application_id=? AND event_key=?)").bind(id,application.id,`email:${item.id}`),
    env.DB.prepare("INSERT OR IGNORE INTO notifications(id,user_id,application_id,channel,event_key,state,created_at) SELECT ?,?,?,'TELEGRAM',?,'PENDING',? WHERE EXISTS(SELECT 1 FROM application_status_history WHERE application_id=? AND event_key=?)").bind(crypto.randomUUID(),owner(env),application.id,`email:${item.id}`,now(),application.id,`email:${item.id}`)
  );
  await env.DB.batch(batch);
 }
 await env.DB.prepare("UPDATE integration_state SET cursor=?,data_json=?,updated_at=? WHERE user_id=? AND provider='gmail'").bind(page.nextPageToken ?? null,JSON.stringify({...meta,last_poll:page.nextPageToken?meta.last_poll:now()}),now(),owner(env)).run();
 await deliverNotifications(env);
}
export async function syncSheets(env:Env){
 const row=await env.DB.prepare("SELECT data_json FROM integration_state WHERE user_id=? AND provider='sheets' AND encrypted_credentials IS NOT NULL").bind(owner(env)).first<{data_json:string}>();
 if(!row)return;
 const meta=JSON.parse(row.data_json);if(!meta.spreadsheet_id)return;
 const access=await token(env,'sheets');
 const rows=await env.DB.prepare('SELECT a.*,j.company,j.title,j.remote_type,j.experience_min,j.experience_max,j.first_seen_at,m.score FROM applications a JOIN jobs j ON j.id=a.job_id LEFT JOIN job_matches m ON m.job_id=j.id AND m.user_id=a.user_id WHERE a.user_id=? ORDER BY a.id').bind(owner(env)).all<any>();
 const values=[['Application ID','Company','Role','URL','Source','Remote','Experience','Match','Found','Applied','Status','Last response','Resume version','Follow-up','Notes'],...rows.results.map(a=>[a.id,a.company,a.title,a.apply_url,'FreeHire',a.remote_type,`${a.experience_min ?? '?'}-${a.experience_max ?? '?'}`,a.score ?? '',a.first_seen_at,a.applied_at ?? '',a.status,a.last_response_at ?? '',a.resume_version_id ?? '',a.next_follow_up_at ?? '',a.notes])];
 // This integration owns a dedicated Shortlist tab and rewrites its stable-ID snapshot.
 // Range updates are idempotent; retries cannot append duplicate rows.
 const book=await googleFetch(access,`https://sheets.googleapis.com/v4/spreadsheets/${meta.spreadsheet_id}?fields=sheets.properties`);
 if(!book.sheets?.some((s:any)=>s.properties.title==='Shortlist'))await googleFetch(access,`https://sheets.googleapis.com/v4/spreadsheets/${meta.spreadsheet_id}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:[{addSheet:{properties:{title:'Shortlist'}}}]})});
 await googleFetch(access,`https://sheets.googleapis.com/v4/spreadsheets/${meta.spreadsheet_id}/values/Shortlist!A1:O${values.length}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values})});
 await env.DB.prepare("UPDATE integration_state SET updated_at=? WHERE user_id=? AND provider='sheets'").bind(now(),owner(env)).run();
}
export const google=new Hono<{Bindings:Env}>();
google.get('/integrations/google',async c=>{
 const rows=await c.env.DB.prepare('SELECT provider,encrypted_credentials IS NOT NULL connected,updated_at,data_json FROM integration_state WHERE user_id=? AND provider IN (?,?)').bind(owner(c.env),'gmail','sheets').all<any>();
 return c.json({data:{configured:configured(c.env),connections:rows.results.map(r=>({provider:r.provider,connected:!!r.connected,updated_at:r.updated_at,spreadsheet_id:JSON.parse(r.data_json).spreadsheet_id ?? ''}))}});
});
google.get('/integrations/google/start',async c=>{
 if(!configured(c.env))return c.json({error:{code:'NOT_CONFIGURED',message:'Configure the Google OAuth client and encryption secret first.'}},503);
 const provider=z.enum(['gmail','sheets']).parse(c.req.query('provider'));
 const state=encode(crypto.getRandomValues(new Uint8Array(32))),verifier=encode(crypto.getRandomValues(new Uint8Array(32))),challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
 await c.env.DB.prepare('INSERT INTO integration_state(user_id,provider,encrypted_credentials,data_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET encrypted_credentials=excluded.encrypted_credentials,data_json=excluded.data_json,updated_at=excluded.updated_at').bind(owner(c.env),'oauth-state',await encrypt(c.env,{verifier}),JSON.stringify({state_hash:await hash(state),provider,expires:Date.now()+600000}),now()).run();
 const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.search=new URLSearchParams({client_id:c.env.GOOGLE_CLIENT_ID!,redirect_uri:`${c.env.APP_ORIGIN}/api/v1/integrations/google/callback`,response_type:'code',access_type:'offline',prompt:'consent',scope:provider==='gmail'?'https://www.googleapis.com/auth/gmail.readonly':'https://www.googleapis.com/auth/spreadsheets',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return c.redirect(u.href);
});
google.get('/integrations/google/callback',async c=>{
 const state=await c.env.DB.prepare("SELECT * FROM integration_state WHERE user_id=? AND provider='oauth-state'").bind(owner(c.env)).first<{data_json:string;encrypted_credentials:string}>();
 if(!state)return c.json({error:{code:'INVALID_STATE',message:'Start the connection again.'}},400);
 const meta=JSON.parse(state.data_json);
 if(meta.expires<Date.now()||await hash(c.req.query('state')??'')!==meta.state_hash)return c.json({error:{code:'INVALID_STATE',message:'OAuth state expired or does not match.'}},400);
 await c.env.DB.prepare("DELETE FROM integration_state WHERE user_id=? AND provider='oauth-state'").bind(owner(c.env)).run();
 const credentials=await decrypt(c.env,state.encrypted_credentials);
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:c.env.GOOGLE_CLIENT_ID!,client_secret:c.env.GOOGLE_CLIENT_SECRET!,code:c.req.query('code')??'',code_verifier:credentials.verifier,redirect_uri:`${c.env.APP_ORIGIN}/api/v1/integrations/google/callback`,grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)});
 const tokens=await r.json() as {refresh_token?:string};if(!r.ok||!tokens.refresh_token)return c.json({error:{code:'OAUTH_FAILED',message:'Google did not provide offline authorization. Reconnect with consent.'}},400);
 await c.env.DB.prepare('INSERT INTO integration_state(user_id,provider,encrypted_credentials,data_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET encrypted_credentials=excluded.encrypted_credentials,updated_at=excluded.updated_at').bind(owner(c.env),meta.provider,await encrypt(c.env,{refresh_token:tokens.refresh_token}),'{}',now()).run();
 return c.redirect('/settings');
});
google.delete('/integrations/google/:provider',async c=>{
 const provider=z.enum(['gmail','sheets']).parse(c.req.param('provider'));
 const state=await c.env.DB.prepare('SELECT encrypted_credentials FROM integration_state WHERE user_id=? AND provider=?').bind(owner(c.env),provider).first<{encrypted_credentials:string}>();
 if(state?.encrypted_credentials){const credentials=await decrypt(c.env,state.encrypted_credentials);await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:credentials.refresh_token}),signal:AbortSignal.timeout(15000)});}
 await c.env.DB.prepare('DELETE FROM integration_state WHERE user_id=? AND provider=?').bind(owner(c.env),provider).run();return c.json({data:{disconnected:true}});
});
google.post('/integrations/sheets/config',async c=>{
 const {spreadsheet_id}=z.object({spreadsheet_id:z.string().regex(/^[a-zA-Z0-9_-]{20,200}$/)}).parse(await c.req.json());
 await c.env.DB.prepare("UPDATE integration_state SET data_json=?,updated_at=? WHERE user_id=? AND provider='sheets'").bind(JSON.stringify({spreadsheet_id}),now(),owner(c.env)).run();return c.json({data:{saved:true}});
});
google.post('/integrations/sheets/sync',async c=>{await syncSheets(c.env);return c.json({data:{synced:true}});});
google.post('/integrations/gmail/sync',async c=>{await pollGmail(c.env);return c.json({data:{synced:true}});});
google.get('/email-events',async c=>c.json({data:(await c.env.DB.prepare('SELECT * FROM email_events WHERE user_id=? ORDER BY received_at DESC LIMIT 100').bind(owner(c.env)).all()).results}));
google.post('/email-events/:id/resolve',async c=>{
 const input=z.object({application_id:z.string().min(1),classification:z.enum(['APPLICATION_CONFIRMED','ONLINE_ASSESSMENT','RECRUITER_RESPONSE','INTERVIEW','TECHNICAL_INTERVIEW','FINAL_ROUND','OFFER','REJECTED']),reason:z.string().min(5).max(1000)}).parse(await c.req.json());
 const event=await c.env.DB.prepare('SELECT * FROM email_events WHERE id=? AND user_id=?').bind(c.req.param('id'),owner(c.env)).first<{state:string;provider_message_id:string;provider_occurred_at:string}>();
 if(!event)return c.json({error:{code:'NOT_FOUND',message:'Email event not found.'}},404);
 if(event.state==='APPLIED')return c.json({data:{already_applied:true}});
 const application=await c.env.DB.prepare('SELECT id,version FROM applications WHERE id=? AND user_id=?').bind(input.application_id,owner(c.env)).first<{id:string;version:number}>();
 if(!application)return c.json({error:{code:'NOT_FOUND',message:'Application not found.'}},404);
 await c.env.DB.batch([
  c.env.DB.prepare("UPDATE applications SET status=?,last_response_at=?,version=version+1,transition_actor='owner',transition_reason=?,transition_event_key=?,updated_at=? WHERE id=? AND user_id=? AND version=?").bind(input.classification,event.provider_occurred_at,input.reason,`review-email:${event.provider_message_id}`,now(),input.application_id,owner(c.env),application.version),
  c.env.DB.prepare("UPDATE email_events SET application_id=?,classification=?,state='APPLIED' WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM application_status_history WHERE application_id=? AND event_key=?)").bind(input.application_id,input.classification,c.req.param('id'),owner(c.env),input.application_id,`review-email:${event.provider_message_id}`)
 ]);
 return c.json({data:{resolved:true}});
});
