import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { OWNER } from './env';
import { settings, saveJob, dispatch, now } from './store';
import { safeUrl, skills, experience, location, roleAllowed } from './domain';
import type { NormalizedJob } from '../../../contracts/domain';
export const extras=new Hono<{Bindings:Env}>();
extras.post('/jobs',async c=>{
  const input=z.object({company:z.string().min(1).max(200),title:z.string().min(1).max(200),description:z.string().min(10).max(100000),location:z.string().max(300),remote_type:z.enum(['WORLDWIDE_REMOTE','INDIA_REMOTE','REMOTE','HYBRID','ONSITE','UNKNOWN']),apply_url:z.url(),experience_min:z.number().min(0).nullable().default(null),experience_max:z.number().min(0).nullable().default(null)}).parse(await c.req.json());
  if(!safeUrl(input.apply_url))return c.json({error:{code:'INVALID_URL',message:'Use an HTTP(S) application URL.'}},400);
  await c.env.DB.prepare("INSERT OR IGNORE INTO job_sources(id,name) VALUES('manual','Manual')").run();
  const j:NormalizedJob={...input,external_id:crypto.randomUUID(),public_slug:null,source:'manual',requirements:[],preferred_qualifications:[],allowed_countries:input.remote_type==='INDIA_REMOTE'?['in']:null,job_url:input.apply_url,posted_at:null,first_seen_at:now(),skills:skills(input.description),salary:null,employment_type:null,seniority:null,availability:'OPEN'};
  const result=await saveJob(c.env,j,await settings(c.env));c.executionCtx.waitUntil(dispatch(c.env));return c.json({data:result},201);
});
extras.post('/jobs/:id/corrections',async c=>{
  const input=z.object({revision:z.number().int(),reason:z.string().min(10).max(2000),experience_min:z.number().min(0).max(2).nullable(),experience_max:z.number().min(0).max(2).nullable(),remote_type:z.enum(['WORLDWIDE_REMOTE','INDIA_REMOTE','REMOTE','HYBRID','ONSITE','UNKNOWN'])}).parse(await c.req.json());
  const row=await c.env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(c.req.param('id')).first<{normalized_json:string;revision:number}>();
  if(!row)return c.json({error:{code:'NOT_FOUND',message:'Job not found.'}},404);
  if(row.revision!==input.revision)return c.json({error:{code:'CONFLICT',message:'Job changed. Reload first.'}},409);
  const job=JSON.parse(row.normalized_json) as NormalizedJob;
  const corrected={...job,experience_min:input.experience_min,experience_max:input.experience_max,remote_type:input.remote_type};
  const config=await settings(c.env),e=experience(corrected,config.data.maximum_experience,config.data),l=location(corrected,config.data);
  if(e.classification==='NOT_ELIGIBLE')return c.json({error:{code:'HARD_GATE',message:'The original mandatory requirements still exceed the hard gate.'}},422);
  const updated=await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO audit_events(id,user_id,entity_type,entity_id,actor,reason,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),OWNER,'job',c.req.param('id'),'owner',input.reason,row.normalized_json,JSON.stringify(corrected),now()),
    c.env.DB.prepare('UPDATE jobs SET normalized_json=?,experience_min=?,experience_max=?,experience_status=?,location_status=?,location_reason=?,role_status=?,revision=revision+1,decision_settings_revision=?,updated_at=? WHERE id=? AND revision=? RETURNING id').bind(JSON.stringify(corrected),e.min_years,e.max_years,e.classification,l.status,l.reason,roleAllowed(corrected.title,config.data)?'ELIGIBLE':'NOT_ELIGIBLE',config.revision,now(),c.req.param('id'),input.revision)
  ]);
  return c.json({data:{updated:updated[1].results.length>0,classification:e.classification}});
});
extras.get('/notifications',async c=>c.json({data:(await c.env.DB.prepare('SELECT id,job_id,channel,state,created_at,last_error_code FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(OWNER).all()).results}));
extras.get('/follow-ups',async c=>c.json({data:(await c.env.DB.prepare(`SELECT a.*,j.company,j.title FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=? AND a.status NOT IN ('OFFER','REJECTED','WITHDRAWN','CLOSED') AND a.applied_at IS NOT NULL AND COALESCE(a.next_follow_up_at,datetime(COALESCE(a.last_response_at,a.applied_at),'+7 days'))<=? ORDER BY a.applied_at`).bind(OWNER,now()).all()).results}));
extras.post('/applications/:id/follow-up-draft',async c=>{
  const a=await c.env.DB.prepare('SELECT j.company,j.title,a.applied_at FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=? AND a.user_id=?').bind(c.req.param('id'),OWNER).first<{company:string;title:string;applied_at:string}>();
  if(!a)return c.json({error:{code:'NOT_FOUND',message:'Application not found.'}},404);
  const p=await c.env.DB.prepare('SELECT data_json FROM profiles WHERE user_id=?').bind(OWNER).first<{data_json:string}>();
  return c.json({data:{draft:`Hello,\n\nI’m following up on my application for the ${a.title} position at ${a.company}${a.applied_at?` submitted on ${a.applied_at.slice(0,10)}`:''}. I remain interested in the opportunity and would appreciate any updates you can share about the hiring process.\n\nThank you for your time and consideration.\n\nBest regards,\n${JSON.parse(p?.data_json ?? '{}').name || '[Your name]'}`,sent:false}});
});
