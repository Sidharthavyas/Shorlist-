import {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './env';
import {owner} from './env';
import {hash,now} from './store';
import {tailor,renderPdf} from './resumes';
import {RESUME_TEMPLATE,type ResumeContent} from './resume-layout';
import {aiStatus,requestWriting,applyRewrites,AI_WRITER_VERSION,type Rewrite} from './resume-ai';

export interface ResumePreview {
 id:string;user_id:string;job_id:string;job_revision:number;profile_revision:number;writer_version:string;
 origin:'ai'|'factual';provider:string|null;model:string|null;rewrites:Rewrite[];content:ResumeContent;
 changes:{fact_id:string;before:string;after:string}[];warnings:string[];created_at:string;expires_at:string;
}
const path=(env:Env,id:string)=>`resumes/ai-previews/${owner(env)}/${id}.json`;
export const isPreviewRead=(method:string,url:string)=>method==='GET'&&/^\/api\/v1\/(?:resume-ai\/status|resume-previews\/[^/]+(?:\/pdf)?)$/.test(new URL(url).pathname);
export async function readPreview(env:Env,id:string){
 if(!z.uuid().safeParse(id).success)return null;
 const file=await env.FILES.get(path(env,id));if(!file)return null;
 const preview=JSON.parse(await file.text()) as ResumePreview;
 return preview.user_id===owner(env)&&preview.writer_version===AI_WRITER_VERSION&&Date.parse(preview.expires_at)>Date.now()?preview:null;
}
const safeError=(error:unknown)=>error instanceof Error&&/^(AI_[A-Z_]+|UNSUPPORTED_[A-Z_]+|INVALID_REWRITE_FORMAT|UNKNOWN_OR_DUPLICATE_FACT|INPUT_TOO_LARGE)$/.test(error.message)?error.message:'AI_WRITING_FAILED';
export const resumePreviews=new Hono<{Bindings:Env}>();
resumePreviews.get('/resume-ai/status',c=>c.json({data:{...aiStatus(c.env),format:RESUME_TEMPLATE,requires_consent:true,requires_review:true}}));
resumePreviews.post('/jobs/:id/resume-preview',async c=>{
 const input=z.object({mode:z.enum(['ai','factual']).default('factual'),ai_consent:z.boolean().default(false)}).strict().parse(await c.req.json());
 if(input.mode==='ai'&&!input.ai_consent)return c.json({error:{code:'CONSENT_REQUIRED',message:'Confirm the selected AI provider may process your verified writing facts and this job description.'}},422);
 const job=await c.env.DB.prepare('SELECT id,revision,normalized_json FROM jobs WHERE id=?').bind(c.req.param('id')).first<{id:string;revision:number;normalized_json:string}>();
 if(!job)return c.json({error:{code:'NOT_FOUND',message:'Job not found.'}},404);
 const profile=await c.env.DB.prepare('SELECT revision,data_json FROM profiles WHERE user_id=?').bind(owner(c.env)).first<{revision:number;data_json:string}>();
 const normalized=JSON.parse(job.normalized_json);let baseline:ResumeContent;
 try{baseline=tailor(JSON.parse(profile?.data_json??'{}'),normalized.skills??[]);}catch{return c.json({error:{code:'PROFILE_INCOMPLETE',message:'Save your verified name, email and experience or projects before preparing a resume.'}},422);}
 const status=aiStatus(c.env),key=await hash(JSON.stringify([owner(c.env),job.id,job.revision,profile!.revision,RESUME_TEMPLATE,AI_WRITER_VERSION,input.mode,status.provider,status.model,status.enabled]));
 const cachePath=`resumes/ai-previews/${owner(c.env)}/cache-${key}.json`,cached=await c.env.FILES.get(cachePath);
 if(cached){const pointer=JSON.parse(await cached.text());if(Date.parse(pointer.cache_until)>Date.now()){const preview=await readPreview(c.env,pointer.preview_id);if(preview)return c.json({data:preview,meta:{cached:true}});}}
 const taskId=await hash('resume-preview:'+key);let leased=false;
 if(input.mode==='ai'&&status.enabled){
  await c.env.DB.prepare("INSERT OR IGNORE INTO tasks(id,user_id,kind,entity_id,entity_revision,idempotency_key,state,created_at,updated_at) VALUES(?,?,'RESUME_PREVIEW',?,?,?,'PENDING',?,?)").bind(taskId,owner(c.env),job.id,job.revision,'resume-preview:'+key,now(),now()).run();
  const task=await c.env.DB.prepare("UPDATE tasks SET state='RUNNING',lease_until=?,updated_at=? WHERE id=? AND user_id=? AND (state IN ('PENDING','FAILED') OR (state='RUNNING' AND lease_until<?) OR (state='READY' AND updated_at<?)) RETURNING id").bind(new Date(Date.now()+90000).toISOString(),now(),taskId,owner(c.env),now(),new Date(Date.now()-120000).toISOString()).first();
  if(!task)return c.json({error:{code:'PREVIEW_RUNNING',message:'This preview is already being prepared. Try again shortly.'}},409);
  leased=true;
 }
 try{
  let rewrites:Rewrite[]=[],provider:string|null=null,model:string|null=null,origin:ResumePreview['origin']='factual';const warnings:string[]=[];
  if(input.mode==='ai'){
   if(!status.enabled)warnings.push('AI writing is not configured. Prepared the factual version instead.');
   else {
    try{
     // Indexed atomic counters bound provider usage; page loads never call AI.
     await c.env.DB.prepare('CREATE TABLE IF NOT EXISTS resume_ai_usage(scope TEXT NOT NULL,utc_day TEXT NOT NULL,requests INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,utc_day))').run();
     const day=now().slice(0,10);
     for(const [scope,limit] of [[owner(c.env),status.daily_limit],['global',50]] as const){const budget=await c.env.DB.prepare('INSERT INTO resume_ai_usage(scope,utc_day,requests) VALUES(?,?,1) ON CONFLICT(scope,utc_day) DO UPDATE SET requests=requests+1 WHERE requests<? RETURNING requests').bind(scope,day,limit).first();if(!budget)throw Error('AI_DAILY_LIMIT');}
     const result=await requestWriting(c.env,baseline,normalized);rewrites=result.rewrites;provider=result.provider;model=result.model;origin='ai';
    }catch(error){const code=safeError(error),reason=code==='AI_RATE_LIMITED'?'The AI provider is at its request limit.':code==='AI_DAILY_LIMIT'?'The daily AI writing limit has been reached.':code==='AI_AUTH_FAILED'?'The AI provider credentials need attention.':/^(UNSUPPORTED_|INVALID_REWRITE|UNKNOWN_OR_DUPLICATE)/.test(code)?'The suggested wording did not pass factual checks.':'AI writing is temporarily unavailable.';warnings.push(reason+' Prepared the factual version instead.');}
   }
  }
  const validated=applyRewrites(baseline,{rewrites}),preview:ResumePreview={id:crypto.randomUUID(),user_id:owner(c.env),job_id:job.id,job_revision:job.revision,profile_revision:profile!.revision,writer_version:AI_WRITER_VERSION,origin,provider,model,rewrites,...validated,warnings,created_at:now(),expires_at:new Date(Date.now()+86400000).toISOString()};
  await c.env.FILES.put(path(c.env,preview.id),JSON.stringify(preview),{httpMetadata:{contentType:'application/json'}});
  await c.env.FILES.put(cachePath,JSON.stringify({preview_id:preview.id,cache_until:new Date(Date.now()+(input.mode==='ai'&&origin==='factual'?120000:86400000)).toISOString()}));
  if(leased)await c.env.DB.prepare("UPDATE tasks SET state='READY',lease_until=NULL,result_json=?,updated_at=? WHERE id=? AND user_id=?").bind(JSON.stringify({preview_id:preview.id}),now(),taskId,owner(c.env)).run();
  return c.json({data:preview,meta:{cached:false}});
 }catch(error){if(leased)await c.env.DB.prepare("UPDATE tasks SET state='FAILED',lease_until=NULL,error_code='PREVIEW_FAILED',updated_at=? WHERE id=? AND user_id=?").bind(now(),taskId,owner(c.env)).run();throw error;}
});
resumePreviews.get('/resume-previews/:id',async c=>{const preview=await readPreview(c.env,c.req.param('id'));return preview?c.json({data:preview}):c.json({error:{code:'NOT_FOUND',message:'Preview expired or not found.'}},404);});
resumePreviews.get('/resume-previews/:id/pdf',async c=>{const preview=await readPreview(c.env,c.req.param('id'));if(!preview)return c.json({error:{code:'NOT_FOUND',message:'Preview expired or not found.'}},404);const bytes=await renderPdf(preview.content);return new Response(new Uint8Array(bytes).buffer,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="resume-preview.pdf"','Cache-Control':'private, no-store'}});});
