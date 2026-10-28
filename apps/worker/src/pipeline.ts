import type { Env } from './env';
import { owner, OWNER } from './env';
import { fetchPage, normalize, UpstreamError } from './source';
import { dispatch, now, saveJob, settings } from './store';
import { match, MATCH_ENGINE } from './domain';
import type { NormalizedJob } from '../../../contracts/domain';
import { ZodError } from 'zod';

export async function sync(env:Env) {
  const enabled=await env.DB.prepare("SELECT enabled FROM job_sources WHERE id='freehire'").first<{enabled:number}>();if(!enabled?.enabled)return {state:'DISABLED'};
  const t=now(), token=crypto.randomUUID();
  const lease=await env.DB.prepare("UPDATE source_sync_state SET lease_token=?,lease_until=? WHERE source_id='freehire' AND (lease_until IS NULL OR lease_until<?) AND (next_retry_at IS NULL OR next_retry_at<=?) RETURNING *").bind(token,new Date(Date.now()+180000).toISOString(),t,t).first<{cursor:string|null;window_start:string|null;last_completed_at:string|null;run_started_at:string|null;counters_json:string}>();
  if (!lease) return {state:'BUSY_OR_BACKOFF'};
  let offset=Number(lease.cursor)||0, fetched=0, duplicates=0, invalid=lease.cursor?(JSON.parse(lease.counters_json||'{}').invalid_records ?? 0):0;
  const config=await settings(env);
  const windowStart=lease.window_start ?? lease.last_completed_at ?? new Date(Date.now()-86400000).toISOString();
  const days=Math.min(30,Math.max(1,Math.ceil((Date.parse(lease.run_started_at ?? t)-Date.parse(windowStart))/86400000)+1));
  await env.DB.prepare("UPDATE source_sync_state SET window_start=?,run_started_at=COALESCE(run_started_at,?),last_error_code=NULL WHERE source_id='freehire' AND lease_token=?").bind(windowStart,t,token).run();
  try {
    let complete=false,backoff:string|null=null;
    // One small page per invocation leaves room for object writes and queue
    // publication within the free Worker's subrequest budget.
    {
      const result=await fetchPage(env.FREEHIRE_API_KEY,offset,days);
      let pageInvalid=0;
      for(const raw of result.data) {
        let job:NormalizedJob;
        try{job=normalize(raw,t);}catch(error){
          if(!(error instanceof ZodError))throw error;
          pageInvalid++;invalid++;
          await env.FILES.put(`jobs/snapshots/freehire/quarantine/${token}-${offset}-${pageInvalid}.json`,JSON.stringify({raw,validation:error.issues}),{httpMetadata:{contentType:'application/json'}});
          continue;
        }
        const saved=await saveJob(env,job,config,false,raw);
        fetched++; if(saved.duplicate) duplicates++;
      }
      if(result.data.length&&pageInvalid>result.data.length/2)throw new Error('SOURCE_SCHEMA_DRIFT');
      offset+=result.data.length;
      complete=offset>=result.meta.total || result.data.length===0;
      await env.DB.prepare("UPDATE source_sync_state SET cursor=?,counters_json=? WHERE source_id='freehire' AND lease_token=?").bind(String(offset),JSON.stringify({fetched:offset,last_batch_duplicates:duplicates,invalid_records:invalid,total:result.meta.total}),token).run();
      if(result.rate_remaining===0)backoff=new Date(Math.max(Date.now()+60000,Number(result.rate_reset)*1000||0)).toISOString();
    }
    await env.DB.prepare("UPDATE source_sync_state SET cursor=?,last_completed_at=CASE WHEN ? THEN ? ELSE last_completed_at END,window_start=CASE WHEN ? THEN NULL ELSE window_start END,run_started_at=CASE WHEN ? THEN NULL ELSE run_started_at END,lease_token=NULL,lease_until=NULL,next_retry_at=NULL,last_error_code=NULL WHERE source_id='freehire' AND lease_token=?").bind(complete?null:String(offset),complete?1:0,lease.run_started_at ?? t,complete?1:0,complete?1:0,token).run();
    if(backoff)await env.DB.prepare("UPDATE source_sync_state SET next_retry_at=? WHERE source_id='freehire'").bind(backoff).run();
    await dispatch(env);
    if(!complete&&!backoff)await env.TASKS.send({kind:'SYNC_SOURCE'});
    console.log(JSON.stringify({event:'source_sync',fetched,duplicates,complete}));
    return {state:complete?'COMPLETE':'RESUMABLE',fetched,duplicates};
  } catch(error) {
    const code=error instanceof UpstreamError?`UPSTREAM_${error.status}`:'SOURCE_CONTRACT_OR_FETCH_ERROR';
    await env.DB.prepare("UPDATE source_sync_state SET lease_token=NULL,lease_until=NULL,last_error_code=?,next_retry_at=? WHERE source_id='freehire' AND lease_token=?").bind(code,new Date(Date.now()+(error instanceof UpstreamError?error.retryAfter:60)*1000).toISOString(),token).run();
    console.error(JSON.stringify({event:'source_sync_error',code}));
    throw new Error(code);
  }
}
export async function analyzeTask(env:Env, input: {task_id:string;entity_id:string;entity_revision:number;settings_revision:number}) {
  const token=crypto.randomUUID();
  const task=await env.DB.prepare("UPDATE tasks SET state='RUNNING',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND (state='PENDING' OR (state='RUNNING' AND lease_until<?)) RETURNING *").bind(token,new Date(Date.now()+120000).toISOString(),now(),input.task_id,now()).first();
  if(!task) return;
  try {
    const row=await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(input.entity_id).first<{normalized_json:string;revision:number;is_sample:number}>();
    const config=await settings(env);
    if(!row || row.revision!==input.entity_revision || config.revision!==input.settings_revision) {
      await env.DB.batch([env.DB.prepare("UPDATE tasks SET state='STALE',updated_at=? WHERE id=? AND lease_token=?").bind(now(),input.task_id,token),env.DB.prepare('UPDATE outbox SET completed_at=? WHERE task_id=?').bind(now(),input.task_id)]);return;
    }
    const job=JSON.parse(row.normalized_json) as NormalizedJob;
    const profile=await env.DB.prepare('SELECT revision,data_json FROM profiles WHERE user_id=?').bind(owner(env)).first<{revision:number;data_json:string}>();
    const facts=JSON.parse(profile?.data_json ?? '{}');
    const score=match(job,(facts.skills ?? []) as string[],config.data,[facts.headline,facts.professional_summary,...(facts.experience??[]),...(facts.projects??[])].filter(Boolean).join(' '));
    const statements:D1PreparedStatement[]=[];
    if(score) statements.push(env.DB.prepare('INSERT INTO job_matches(user_id,job_id,score,breakdown_json,analysis_json,profile_revision,settings_revision,job_revision,engine_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,job_id) DO UPDATE SET score=excluded.score,breakdown_json=excluded.breakdown_json,analysis_json=excluded.analysis_json,profile_revision=excluded.profile_revision,settings_revision=excluded.settings_revision,job_revision=excluded.job_revision,engine_version=excluded.engine_version,created_at=excluded.created_at').bind(owner(env),input.entity_id,score.score,JSON.stringify(score.breakdown),JSON.stringify(score),profile?.revision ?? 1,config.revision,row.revision,MATCH_ENGINE,now()));
    statements.push(env.DB.prepare("UPDATE tasks SET state='READY',updated_at=?,lease_until=NULL WHERE id=? AND lease_token=?").bind(now(),input.task_id,token),env.DB.prepare('UPDATE outbox SET completed_at=? WHERE task_id=?').bind(now(),input.task_id));
    if(score && score.score>=config.data.minimum_match_score && !row.is_sample && config.data.notifications_enabled) statements.push(env.DB.prepare("INSERT OR IGNORE INTO notifications(id,user_id,job_id,channel,event_key,state,created_at) VALUES(?,?,?,'TELEGRAM',?,'PENDING',?)").bind(crypto.randomUUID(),owner(env),input.entity_id,`new:${input.entity_id}`,now()));
    await env.FILES.put(`jobs/snapshots/${job.source}/${input.entity_id}-${row.revision}.json`,JSON.stringify(job),{httpMetadata:{contentType:'application/json'}});
    await env.DB.batch(statements);
    if(score && score.score>=config.data.minimum_match_score && !row.is_sample && config.data.notifications_enabled) await deliverNotifications(env);
  } catch(error) {
    await env.DB.prepare("UPDATE tasks SET state='PENDING',error_code='ANALYSIS_FAILED',updated_at=? WHERE id=? AND lease_token=?").bind(now(),input.task_id,token).run();throw error;
  }
}
export async function deliverNotifications(env:Env) {
  if(owner(env)!==OWNER)return;
  if(!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const config=await settings(env);if(!config.data.notifications_enabled)return;
  const intents=await env.DB.prepare("SELECT id,job_id,application_id FROM notifications WHERE state IN ('PENDING','FAILED') AND attempts<5 AND user_id=? LIMIT 10").bind(owner(env)).all<{id:string;job_id:string|null;application_id:string|null}>();
  for(const intent of intents.results) {
  const id=intent.id;
  let text:string;
  if(intent.application_id) {
    const app=await env.DB.prepare('SELECT a.status,j.company,j.title FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=? AND a.user_id=?').bind(intent.application_id,owner(env)).first<{status:string;company:string;title:string}>();
    if(!app)continue;text=`APPLICATION UPDATE\n\n${app.company}\n${app.title}\nStatus: ${app.status}\n\n${env.APP_ORIGIN}/applications`;
  } else {
    const job=await env.DB.prepare('SELECT * FROM recommended_jobs WHERE user_id=? AND id=? AND match_score>=?').bind(owner(env),intent.job_id,config.data.minimum_match_score).first<{company:string;title:string;remote_type:string;experience_min:number;experience_max:number;match_score:number}>();
    if(!job)continue;
    text=`${job.match_score}% MATCH\n\n${job.company}\n${job.title}\nExperience: ${job.experience_min}–${job.experience_max} years\n${job.remote_type}\n\n${env.APP_ORIGIN}/jobs/${intent.job_id}`;
  }
  const claimed=await env.DB.prepare("UPDATE notifications SET state='SENDING',attempts=attempts+1 WHERE id=? AND state IN ('PENDING','FAILED') RETURNING id").bind(id).first();
  if(!claimed)continue;
  try {
    const response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text}),signal:AbortSignal.timeout(12000)});
    if(!response.ok) { await env.DB.prepare("UPDATE notifications SET state='FAILED',last_error_code=? WHERE id=?").bind(`TELEGRAM_${response.status}`,id).run();continue; }
    const result=await response.json() as {result?:{message_id:number}};
    await env.DB.prepare("UPDATE notifications SET state='SENT',provider_message_id=?,sent_at=? WHERE id=?").bind(String(result.result?.message_id ?? ''),now(),id).run();
  } catch { await env.DB.prepare("UPDATE notifications SET state='UNKNOWN',last_error_code='DELIVERY_UNCERTAIN' WHERE id=?").bind(id).run(); }
  }
}
export async function expireStale(env:Env) {
  // Unknown after 7 days without positive verification; never infer closed from search absence.
  await env.DB.prepare("UPDATE jobs SET availability='UNKNOWN' WHERE availability='OPEN' AND last_verified_at<? AND is_sample=0").bind(new Date(Date.now()-7*86400000).toISOString()).run();
}
export async function verifyAvailability(env:Env) {
  const rows=await env.DB.prepare("SELECT j.id,r.public_slug FROM jobs j JOIN job_source_refs r ON r.job_id=j.id WHERE r.source_id='freehire' AND j.is_sample=0 AND j.availability IN ('OPEN','UNKNOWN') AND (j.last_verified_at IS NULL OR j.last_verified_at<?) ORDER BY j.last_verified_at LIMIT 3").bind(new Date(Date.now()-86400000).toISOString()).all<{id:string;public_slug:string}>();
  const config=await settings(env);
  for(const row of rows.results){
    const response=await fetch(`https://freehire.me/api/v1/jobs/${encodeURIComponent(row.public_slug)}`,{headers:env.FREEHIRE_API_KEY?{Authorization:`Bearer ${env.FREEHIRE_API_KEY}`}:{},signal:AbortSignal.timeout(12000)});
    if(response.status===404){await env.DB.prepare("UPDATE jobs SET availability='UNKNOWN',last_verified_at=? WHERE id=?").bind(now(),row.id).run();continue;}
    if(response.status===429)break;if(!response.ok)continue;
    const result=await response.json() as {data:unknown};await saveJob(env,normalize(result.data),config,false,result.data);
  }
}

