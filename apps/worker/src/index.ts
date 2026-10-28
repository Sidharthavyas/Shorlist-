import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Env } from './env';
import { OWNER } from './env';
import { DEFAULTS, experience, location, roleAllowed, plain, safeUrl } from './domain';
import { initialize, settings, now, saveJob, dispatch } from './store';
import { analyzeTask, sync, expireStale, verifyAvailability, deliverNotifications } from './pipeline';
import { resumes, generateResume } from './resumes';
import { extras } from './extras';
import { google, pollGmail, syncSheets } from './google';
import type { NormalizedJob } from '../../../contracts/domain';
import { queueCoverage, syncFeed, refreshPatternMatches } from './coverage';
import { providers } from './providers';
import { ownerSession } from './owner-session';
import { storageEnv } from './private-files';

export const app = new Hono<{Bindings:Env;Variables:{requestId:string}}>();
const keys=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
app.use('*',async(c,next)=>{
  c.set('requestId',crypto.randomUUID());
  c.header('X-Content-Type-Options','nosniff'); c.header('Referrer-Policy','no-referrer');
  c.header('Cache-Control','private, no-store'); c.header('X-Frame-Options','DENY');
  c.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
  const host=new URL(c.req.url).hostname;
  const local=c.env.APP_ENV==='local' && ['127.0.0.1','localhost','[::1]'].includes(host);
  let subject='local-owner', email='owner@example.test';
  const session=local?null:await ownerSession(c);
  if(session instanceof Response)return session;
  if(session){subject=session.subject;email=session.email;}
  else if(!local) {
    if(c.env.APP_ENV!=='production' || !c.env.ACCESS_AUDIENCE || c.env.ACCESS_AUDIENCE.includes('REPLACE') || !c.env.OWNER_EMAIL) return c.json({error:{code:'AUTH_NOT_CONFIGURED',message:'Configure Cloudflare Access and owner identity.'}},503);
    try {
      let jwks=keys.get(c.env.ACCESS_ISSUER);
      if(!jwks) { jwks=createRemoteJWKSet(new URL(`${c.env.ACCESS_ISSUER}/cdn-cgi/access/certs`));keys.set(c.env.ACCESS_ISSUER,jwks); }
      const {payload}=await jwtVerify(c.req.header('Cf-Access-Jwt-Assertion') ?? '',jwks,{issuer:c.env.ACCESS_ISSUER,audience:c.env.ACCESS_AUDIENCE});
      if(typeof payload.email!=='string' || payload.email.toLowerCase()!==c.env.OWNER_EMAIL.toLowerCase() || !payload.sub) return c.json({error:{code:'FORBIDDEN',message:'Owner access only.'}},403);
      subject=payload.sub;email=payload.email;
    } catch { return c.json({error:{code:'UNAUTHORIZED',message:'Sign in through Cloudflare Access.'}},401); }
  }
  if(!['GET','HEAD','OPTIONS'].includes(c.req.method)) {
    const allowed=local?['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:8787']: [c.env.APP_ORIGIN];
    if(!allowed.includes(c.req.header('Origin') ?? '')) return c.json({error:{code:'ORIGIN_REJECTED',message:'Request origin is not allowed.'}},403);
  }
  await initialize(c.env,subject,email); await next();
});
app.use('/api/*',bodyLimit({maxSize:8*1024*1024,onError:c=>c.json({error:{code:'TOO_LARGE',message:'Maximum request size is 8 MB.'}},413)}));
app.onError((err,c)=>{
  if(err instanceof z.ZodError) return c.json({error:{code:'INVALID_INPUT',message:'Check the supplied fields.',details:err.issues,request_id:c.get('requestId')}},400);
  console.error(JSON.stringify({event:'request_error',request_id:c.get('requestId'),code:'INTERNAL_ERROR'}));
  if(c.env.APP_ENV==='local')console.error(err.stack);
  return c.json({error:{code:'INTERNAL_ERROR',message:'The request could not be completed.',request_id:c.get('requestId')}},500);
});
app.get('/api/v1/health',c=>c.json({data:{status:'ok',environment:c.env.APP_ENV,integrations:{telegram:!!c.env.TELEGRAM_BOT_TOKEN,gmail:false,sheets:false}}}));
app.get('/api/v1/settings',async c=>c.json({data:await settings(c.env)}));
app.get('/api/v1/summary',async c=>{
  const jobs=await c.env.DB.prepare(`SELECT COUNT(*) total,COALESCE(SUM(experience_status='ELIGIBLE' AND role_status='ELIGIBLE' AND location_status='COMPATIBLE' AND availability='OPEN'),0) eligible,0 samples FROM jobs WHERE is_sample=0`).first();
  const daily=await c.env.DB.prepare("SELECT COUNT(*) new_today,COALESCE(SUM(match_score>=80),0) high_matches FROM recommended_jobs WHERE user_id=? AND is_sample=0 AND first_seen_at>=?").bind(OWNER,new Date(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})+'T00:00:00+05:30').toISOString()).first();
  const applications=await c.env.DB.prepare('SELECT status,COUNT(*) count FROM applications WHERE user_id=? GROUP BY status').bind(OWNER).all();
  const source=await c.env.DB.prepare("SELECT * FROM source_sync_state WHERE source_id='freehire'").first();
  const sources=await c.env.DB.prepare('SELECT s.id,s.name,s.enabled,t.* FROM job_sources s JOIN source_sync_state t ON t.source_id=s.id WHERE s.enabled=1').all();
  const profileRow=await c.env.DB.prepare('SELECT data_json FROM profiles WHERE user_id=?').bind(OWNER).first<{data_json:string}>();
  const profile=JSON.parse(profileRow?.data_json ?? '{}');
  const uploaded=await c.env.DB.prepare("SELECT COUNT(*) count FROM resumes WHERE user_id=? AND kind='MASTER' AND deleted_at IS NULL").bind(OWNER).first<{count:number}>();
  const review=await c.env.DB.prepare("SELECT COUNT(*) count FROM jobs WHERE is_sample=0 AND availability='OPEN' AND role_status='ELIGIBLE' AND location_status<>'INCOMPATIBLE' AND experience_status<>'NOT_ELIGIBLE' AND (experience_status='REVIEW_REQUIRED' OR location_status='REVIEW_REQUIRED')").first<{count:number}>();
  return c.json({data:{jobs,daily,applications:applications.results,source,sources:sources.results,review_count:review?.count ?? 0,onboarding:{has_uploaded_resume:!!uploaded?.count,profile_ready:!!(profile.name&&profile.email&&(profile.projects?.length||profile.experience?.length||profile.verified_bullets?.length))}}});
});
app.get('/api/v1/jobs',async c=>{
  const query=z.object({q:z.string().max(200).default(''),source:z.string().max(130).default(''),sort:z.enum(['recent','match']).default('recent'),view:z.enum(['discover','review','saved','ignored']).default('discover'),remote_type:z.string().max(40).default(''),demo:z.enum(['true','false']).default('false'),min_score:z.coerce.number().min(0).max(100).default(0),days:z.coerce.number().min(0).max(365).default(0),limit:z.coerce.number().int().min(1).max(100).default(40),offset:z.coerce.number().int().min(0).max(100000).default(0)}).parse(c.req.query());
  const from=query.view==='discover'?'recommended_jobs j':'jobs j';
  const args:(string|number)[]=query.view==='discover'?[OWNER]:[];
  const where=query.view==='discover'?['j.user_id=?']:['1=1'];
  if(query.demo!=='true')where.push('j.is_sample=0');
  if(query.view==='review') where.push("j.availability='OPEN' AND j.role_status<>'NOT_ELIGIBLE' AND j.experience_status<>'NOT_ELIGIBLE' AND j.location_status<>'INCOMPATIBLE' AND (j.experience_status='REVIEW_REQUIRED' OR j.location_status='REVIEW_REQUIRED')");
  if(query.view==='saved'||query.view==='ignored') { where.push('EXISTS(SELECT 1 FROM job_dispositions d WHERE d.job_id=j.id AND d.user_id=? AND d.status=?)');args.push(OWNER,query.view.toUpperCase()); }
  for(const token of query.q.split(/\s+/).filter(Boolean)) { where.push("(j.company||' '||j.title||' '||j.description||' '||j.location) LIKE ? ESCAPE '\\'");args.push(`%${token.replace(/[\\%_]/g,'\\$&')}%`); }
  if(query.source){where.push('EXISTS(SELECT 1 FROM job_source_refs r WHERE r.job_id=j.id AND r.source_id=?)');args.push(query.source);}
  if(query.remote_type) { where.push('j.remote_type=?');args.push(query.remote_type); }
  if(query.min_score) { where.push('EXISTS(SELECT 1 FROM job_matches m JOIN profiles p ON p.user_id=m.user_id JOIN settings s ON s.user_id=m.user_id WHERE m.job_id=j.id AND m.user_id=? AND m.score>=? AND m.job_revision=j.revision AND m.settings_revision=s.revision AND m.profile_revision=p.revision)');args.push(OWNER,query.min_score); }
  if(query.days) {where.push('j.first_seen_at>=?');args.push(new Date(Date.now()-query.days*86400000).toISOString());}
  const predicate=where.join(' AND ');
  const count=await c.env.DB.prepare(`SELECT COUNT(*) total FROM ${from} WHERE ${predicate}`).bind(...args).first<{total:number}>();
  const rows=await c.env.DB.prepare(`SELECT j.*,m.score raw_score,m.analysis_json,d.status disposition FROM ${from} LEFT JOIN job_matches m ON m.job_id=j.id AND m.user_id='${OWNER}' AND m.job_revision=j.revision AND m.settings_revision=j.decision_settings_revision AND m.profile_revision=(SELECT revision FROM profiles WHERE user_id=m.user_id) LEFT JOIN job_dispositions d ON d.job_id=j.id AND d.user_id='${OWNER}' WHERE ${predicate} ORDER BY ${query.sort==='match'?'COALESCE(m.score,0) DESC,':''} j.first_seen_at DESC,j.id LIMIT ? OFFSET ?`).bind(...args,query.limit,query.offset).all();
  return c.json({data:rows.results,meta:{total:count?.total ?? 0,limit:query.limit,offset:query.offset}});
});
app.get('/api/v1/jobs/:id',async c=>{
  const job=await c.env.DB.prepare('SELECT j.*,m.score,m.analysis_json,d.status disposition FROM jobs j LEFT JOIN job_matches m ON m.job_id=j.id AND m.user_id=? AND m.job_revision=j.revision AND m.settings_revision=(SELECT revision FROM settings WHERE user_id=m.user_id) AND m.profile_revision=(SELECT revision FROM profiles WHERE user_id=m.user_id) LEFT JOIN job_dispositions d ON d.job_id=j.id AND d.user_id=? WHERE j.id=?').bind(OWNER,OWNER,c.req.param('id')).first();
  if(!job) return c.json({error:{code:'NOT_FOUND',message:'Job not found.'}},404);
  const evidence=await c.env.DB.prepare('SELECT * FROM job_experience_analysis WHERE job_id=? ORDER BY created_at DESC LIMIT 1').bind(c.req.param('id')).first();
  const refs=await c.env.DB.prepare('SELECT source_id,source_url,public_slug FROM job_source_refs WHERE job_id=?').bind(c.req.param('id')).all();
  return c.json({data:{...job,experience:evidence,source_refs:refs.results}});
});
app.get('/api/v1/sources',async c=>c.json({data:(await c.env.DB.prepare("SELECT s.id,s.name,s.enabled,s.config_json,t.*,(SELECT COUNT(*) FROM job_source_refs r JOIN jobs j ON j.id=r.job_id WHERE r.source_id=s.id AND j.is_sample=0) stored_jobs FROM job_sources s LEFT JOIN source_sync_state t ON t.source_id=s.id WHERE s.id<>'manual'").all()).results}));
app.post('/api/v1/sources/sync',async c=>{const ids=await queueCoverage(c.env);const freehire=await c.env.DB.prepare("SELECT enabled FROM job_sources WHERE id='freehire'").first<{enabled:number}>();if(freehire?.enabled)await c.env.TASKS.send({kind:'SYNC_SOURCE'});c.executionCtx.waitUntil(refreshPatternMatches(c.env));return c.json({data:{state:'QUEUED',sources:[...ids,...(freehire?.enabled?['freehire']:[])]}},202);});
app.post('/api/v1/sources',async c=>{
  const input=z.object({provider:z.enum(['greenhouse','lever','ashby']),board:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),company:z.string().trim().min(1).max(100)}).parse(await c.req.json());
  const id=`${input.provider}:${input.board}`,config={...input,interval:360};
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO job_sources(id,name,enabled,config_json) VALUES(?,?,1,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=1,config_json=excluded.config_json').bind(id,`${input.company} · ${input.provider}`,JSON.stringify(config)),c.env.DB.prepare('INSERT OR IGNORE INTO source_sync_state(source_id) VALUES(?)').bind(id)]);
  await c.env.TASKS.send({kind:'SYNC_FEED',source_id:id});return c.json({data:{id}},201);
});
app.patch('/api/v1/sources/:id',async c=>{const input=z.object({enabled:z.boolean()}).parse(await c.req.json());const updated=await c.env.DB.prepare('UPDATE job_sources SET enabled=? WHERE id=? RETURNING id').bind(input.enabled?1:0,c.req.param('id')).first();return updated?c.json({data:updated}):c.json({error:{code:'NOT_FOUND',message:'Source not found.'}},404);});
app.post('/api/v1/sources/:id/sync',async c=>{const row=await c.env.DB.prepare('SELECT id,enabled,config_json FROM job_sources WHERE id=?').bind(c.req.param('id')).first<{id:string;enabled:number;config_json:string}>();if(!row||!row.enabled)return c.json({error:{code:'SOURCE_DISABLED',message:'Enable the source first.'}},422);if(row.id==='freehire')c.executionCtx.waitUntil(sync(c.env).catch(()=>{}));else if(providers.includes(JSON.parse(row.config_json).provider))await c.env.TASKS.send({kind:'SYNC_FEED',source_id:row.id});else return c.json({error:{code:'NOT_CONFIGURED',message:'Source has no adapter.'}},422);return c.json({data:{state:'QUEUED'}},202);});
app.patch('/api/v1/jobs/:id/disposition',async c=>{
  const {status}=z.object({status:z.enum(['NEW','SAVED','IGNORED'])}).parse(await c.req.json());
  if(!await c.env.DB.prepare('SELECT id FROM jobs WHERE id=?').bind(c.req.param('id')).first()) return c.json({error:{code:'NOT_FOUND',message:'Job not found.'}},404);
  await c.env.DB.prepare('INSERT INTO job_dispositions(user_id,job_id,status,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,job_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at').bind(OWNER,c.req.param('id'),status,now()).run();
  return c.json({data:{status}});
});
app.patch('/api/v1/settings',async c=>{
  const input=z.object({revision:z.number().int(),maximum_experience:z.number().min(0).max(2),minimum_match_score:z.number().int().min(0).max(100),location:z.object({remote_first:z.boolean(),worldwide_remote:z.boolean(),india_remote:z.boolean(),hybrid:z.boolean(),onsite:z.boolean(),unknown:z.literal('REVIEW_REQUIRED')}),notifications_enabled:z.boolean(),preferred_technologies:z.object({backend:z.array(z.string()),frontend:z.array(z.string()),mobile:z.array(z.string()),database:z.array(z.string()),infrastructure:z.array(z.string()),ai:z.array(z.string())}),preferred_roles:z.array(z.string().min(1)).min(1).max(100),excluded_title_terms:z.array(z.string().min(1)).max(100)}).parse(await c.req.json());
  const config=await settings(c.env); if(config.revision!==input.revision) return c.json({error:{code:'CONFLICT',message:'Settings changed; reload and try again.'}},409);
  const data={...config.data,...input};
  const updated=await c.env.DB.prepare('UPDATE settings SET data_json=?,maximum_experience=?,minimum_match_score=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? RETURNING revision').bind(JSON.stringify(data),input.maximum_experience,input.minimum_match_score,now(),OWNER,input.revision).first();
  if(!updated)return c.json({error:{code:'CONFLICT',message:'Settings changed.'}},409);
  const rows=await c.env.DB.prepare('SELECT normalized_json,is_sample FROM jobs').all<{normalized_json:string;is_sample:number}>();
  // Reclassify immediately; unchanged-content optimization must not keep old settings decisions.
  for(const row of rows.results) { const j=JSON.parse(row.normalized_json) as NormalizedJob,e=experience(j,input.maximum_experience,data),l=location(j,data);await c.env.DB.prepare('UPDATE jobs SET experience_status=?,experience_min=?,experience_max=?,location_status=?,location_reason=?,role_status=?,decision_settings_revision=? WHERE id IN (SELECT job_id FROM job_source_refs WHERE source_id=? AND external_id=?)').bind(e.classification,e.min_years,e.max_years,l.status,l.reason,roleAllowed(j.title,data)?'ELIGIBLE':'NOT_ELIGIBLE',input.revision+1,j.source,j.external_id).run(); }
  c.executionCtx.waitUntil(reanalyze(c.env));return c.json({data:updated});
});
async function reanalyze(env:Env) {
  const config=await settings(env);
  const rows=await env.DB.prepare('SELECT id,revision FROM jobs').all<{id:string;revision:number}>();
  for(const row of rows.results) {const id=crypto.randomUUID(),key=`analyze:${row.id}:${row.revision}:${config.revision}:${crypto.randomUUID()}`;const payload={task_id:id,entity_id:row.id,entity_revision:row.revision,settings_revision:config.revision};await env.DB.batch([env.DB.prepare("INSERT INTO tasks(id,user_id,kind,entity_id,entity_revision,idempotency_key,state,created_at,updated_at,settings_revision) VALUES(?,?,'ANALYZE_JOB',?,?,?,'PENDING',?,?,?)").bind(id,OWNER,row.id,row.revision,key,now(),now(),config.revision),env.DB.prepare('INSERT INTO outbox(id,task_id,payload_json,available_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),id,JSON.stringify(payload),now())]);} await dispatch(env);
}
app.get('/api/v1/profile',async c=>{const p=await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id=?').bind(OWNER).first<{data_json:string;revision:number}>();return c.json({data:{...JSON.parse(p?.data_json ?? '{}'),revision:p?.revision ?? 1}});});
app.get('/api/v1/profile/autofill',async c=>{const row=await c.env.DB.prepare('SELECT data_json,revision FROM profiles WHERE user_id=?').bind(OWNER).first<{data_json:string;revision:number}>();const profile=JSON.parse(row?.data_json??'{}');if(!profile.name||!profile.email||profile.email==='owner@example.test')return c.json({error:{code:'PROFILE_INCOMPLETE',message:'Save your verified name and email in Profile first.'}},422);return new Response(JSON.stringify({format:'shortlist-profile',version:1,exported_at:now(),profile:{...profile,revision:row?.revision??1}},null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="shortlist-autofill-profile.json"','Cache-Control':'private, no-store'}});});
app.put('/api/v1/profile',async c=>{
  const profile=z.object({revision:z.number().int(),name:z.string().trim().min(1,'Enter your name before saving.').max(200),email:z.email(),phone:z.string().max(80).default(''),location:z.string().max(200).default(''),linkedin:z.string().max(500).default(''),github:z.string().max(500).default(''),portfolio:z.string().max(500).default(''),headline:z.string().max(300).default(''),professional_summary:z.string().max(3000).default(''),skill_groups:z.array(z.string().max(1500)).max(30).default([]),skills:z.array(z.string().max(80)).max(100),education:z.array(z.string().max(1000)).max(20),experience:z.array(z.string().max(2000)).max(30),projects:z.array(z.string().max(2000)).max(30),verified_bullets:z.array(z.string().max(2000)).max(100)}).parse(await c.req.json());
  const updated=await c.env.DB.prepare('UPDATE profiles SET data_json=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? RETURNING revision').bind(JSON.stringify(profile),now(),OWNER,profile.revision).first();
  if(!updated) return c.json({error:{code:'CONFLICT',message:'Profile changed; reload.'}},409);
  c.executionCtx.waitUntil(reanalyze(c.env));return c.json({data:updated});
});
app.get('/api/v1/applications',async c=>c.json({data:(await c.env.DB.prepare('SELECT a.*,j.company,j.title,j.remote_type,j.is_sample,m.score FROM applications a JOIN jobs j ON j.id=a.job_id LEFT JOIN job_matches m ON m.job_id=j.id AND m.user_id=a.user_id WHERE a.user_id=? ORDER BY a.updated_at DESC').bind(OWNER).all()).results}));
const statuses=['NEW','SAVED','REVIEW','APPLYING','APPLIED','APPLICATION_CONFIRMED','ONLINE_ASSESSMENT','RECRUITER_RESPONSE','INTERVIEW','TECHNICAL_INTERVIEW','FINAL_ROUND','OFFER','REJECTED','WITHDRAWN','CLOSED'] as const;
app.post('/api/v1/applications',async c=>{
  const input=z.object({job_id:z.string().min(1),resume_version_id:z.string().nullable().default(null)}).parse(await c.req.json());
  const j=await c.env.DB.prepare('SELECT apply_url FROM jobs WHERE id=?').bind(input.job_id).first<{apply_url:string}>();
  if(!j)return c.json({error:{code:'NOT_FOUND',message:'Job not found.'}},404);
  if(input.resume_version_id && !await c.env.DB.prepare("SELECT id FROM resume_versions WHERE id=? AND user_id=? AND state='READY'").bind(input.resume_version_id,OWNER).first())return c.json({error:{code:'INVALID_RESUME',message:'Choose a ready resume.'}},422);
  const t=now();await c.env.DB.prepare("INSERT OR IGNORE INTO applications(id,user_id,job_id,resume_version_id,apply_url,status,applied_at,transition_actor,transition_reason,transition_event_key,created_at,updated_at) VALUES(?,?,?,?,?,'APPLIED',?,'owner','Manually marked applied',?,?,?)").bind(crypto.randomUUID(),OWNER,input.job_id,input.resume_version_id,j.apply_url ?? '',t,crypto.randomUUID(),t,t).run();
  return c.json({data:await c.env.DB.prepare('SELECT * FROM applications WHERE user_id=? AND job_id=?').bind(OWNER,input.job_id).first()},201);
});
app.patch('/api/v1/applications/:id',async c=>{
  const input=z.object({version:z.number().int(),status:z.enum(statuses),notes:z.string().max(10000).default(''),next_follow_up_at:z.string().nullable().optional()}).parse(await c.req.json());
  const row=await c.env.DB.prepare("UPDATE applications SET status=?,notes=?,next_follow_up_at=?,version=version+1,transition_actor='owner',transition_reason='Manual tracker update',transition_event_key=?,updated_at=? WHERE id=? AND user_id=? AND version=? RETURNING *").bind(input.status,input.notes,input.next_follow_up_at ?? null,crypto.randomUUID(),now(),c.req.param('id'),OWNER,input.version).first();
  return row?c.json({data:row}):c.json({error:{code:'CONFLICT',message:'Application changed; reload.'}},409);
});
app.get('/api/v1/applications/:id/history',async c=>c.json({data:(await c.env.DB.prepare('SELECT h.* FROM application_status_history h JOIN applications a ON a.id=h.application_id WHERE a.user_id=? AND a.id=? ORDER BY h.id').bind(OWNER,c.req.param('id')).all()).results}));
app.get('/api/v1/analytics',async c=>{
  const rows=await c.env.DB.prepare(`SELECT j.title role,j.remote_type,COUNT(*) applications,SUM(EXISTS(SELECT 1 FROM application_status_history h WHERE h.application_id=a.id AND h.to_status IN ('APPLICATION_CONFIRMED','ONLINE_ASSESSMENT','RECRUITER_RESPONSE','INTERVIEW','TECHNICAL_INTERVIEW','FINAL_ROUND','OFFER','REJECTED'))) responses,SUM(EXISTS(SELECT 1 FROM application_status_history h WHERE h.application_id=a.id AND h.to_status IN ('INTERVIEW','TECHNICAL_INTERVIEW','FINAL_ROUND','OFFER'))) interviews FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=? GROUP BY j.title,j.remote_type`).bind(OWNER).all();
  return c.json({data:rows.results});
});
app.get('/api/v1/exports/applications.csv',async c=>{
  const rows=await c.env.DB.prepare('SELECT j.company,j.title,a.apply_url,a.status,a.applied_at,a.notes FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=?').bind(OWNER).all<Record<string,unknown>>();
  const csv=(v:unknown)=>'"'+String(v ?? '').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
  return new Response(['Company,Role,URL,Status,Applied,Notes',...rows.results.map(r=>Object.values(r).map(csv).join(','))].join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="applications.csv"','Cache-Control':'private, no-store'}});
});
app.route('/api/v1',resumes);
app.route('/api/v1',extras);
app.route('/api/v1',google);
app.all('/api/*',c=>c.json({error:{code:'NOT_FOUND',message:'API route not found.'}},404));
app.get('*',c=>c.env.ASSETS.fetch(c.req.raw));
export default {
  fetch:(request:Request,env:Env,ctx:ExecutionContext)=>app.fetch(request,storageEnv(env),ctx),
  async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext) { env=storageEnv(env);ctx.waitUntil((async()=>{await initialize(env,'scheduled-owner',env.OWNER_EMAIL ?? 'owner@example.test');await expireStale(env);await dispatch(env);await queueCoverage(env);await refreshPatternMatches(env);for(const kind of ['SYNC_SOURCE','GMAIL_SYNC','SHEETS_SYNC','NOTIFICATIONS','VERIFY_JOBS'])await env.TASKS.send({kind});})()); },
  async queue(batch:MessageBatch<{kind?:string;source_id?:string;task_id:string;entity_id:string;entity_revision:number;settings_revision:number}>,env:Env) {env=storageEnv(env);for(const message of batch.messages) {try{if(message.body.kind==='TAILOR_RESUME')await generateResume(env,message.body.task_id);else if(message.body.kind==='SYNC_FEED')await syncFeed(env,message.body.source_id??'');else if(message.body.kind==='REFRESH_MATCHES')await refreshPatternMatches(env);else if(message.body.kind==='SYNC_SOURCE')await sync(env);else if(message.body.kind==='GMAIL_SYNC')await pollGmail(env);else if(message.body.kind==='SHEETS_SYNC')await syncSheets(env);else if(message.body.kind==='NOTIFICATIONS')await deliverNotifications(env);else if(message.body.kind==='VERIFY_JOBS')await verifyAvailability(env);else await analyzeTask(env,message.body);message.ack();}catch{message.retry({delaySeconds:60});}}await dispatch(env);}
} satisfies ExportedHandler<Env,{kind?:string;source_id?:string;task_id:string;entity_id:string;entity_revision:number;settings_revision:number}>;

