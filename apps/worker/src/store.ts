import type { Env } from './env';
import { owner } from './env';
import { DEFAULTS, canonicalUrl, experience, location, roleAllowed, type Settings } from './domain';
import type { NormalizedJob } from '../../../contracts/domain';
import { INITIAL_FEEDS } from './providers';
import workspaceSchema from '../../../config/workspace-schema.json';
const initialized=new WeakMap<D1Database,Set<string>>(),schemas=new WeakMap<D1Database,Promise<void>>();

export const now = () => new Date().toISOString();
export async function hash(value:string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
export async function settings(env:Env):Promise<{data:Settings;revision:number}> {
  const row = await env.DB.prepare('SELECT * FROM settings WHERE user_id=?').bind(owner(env)).first<{data_json:string;revision:number;maximum_experience:number;minimum_match_score:number}>();
  return {data:{...DEFAULTS,...JSON.parse(row?.data_json ?? '{}'),maximum_experience:row?.maximum_experience ?? 2,minimum_match_score:row?.minimum_match_score ?? 70},revision:row?.revision ?? 1};
}
export async function initialize(env:Env, subject:string, email:string) {
  if(initialized.get(env.DB)?.has(owner(env)))return;
  if(env.MULTI_USER==='enabled'){
    let schema=schemas.get(env.DB);
    if(!schema){schema=(async()=>{if(!await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='job_decisions'").first())await env.DB.batch(workspaceSchema.flatMap(sql=>sql.split(';').filter(statement=>statement.trim()).map(statement=>env.DB.prepare(statement))));})().catch(error=>{schemas.delete(env.DB);throw error;});schemas.set(env.DB,schema);}
    await schema;
  }
  const t=now();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO users(id,access_subject,email,created_at) VALUES(?,?,?,?)').bind(owner(env),subject,email,t),
    env.DB.prepare('INSERT OR IGNORE INTO settings(user_id,data_json,updated_at) VALUES(?,?,?)').bind(owner(env),JSON.stringify(DEFAULTS),t),
    env.DB.prepare('INSERT OR IGNORE INTO profiles(user_id,data_json,updated_at) VALUES(?,?,?)').bind(owner(env),JSON.stringify({name:'',email,skills:[],education:[],experience:[],projects:[],verified_bullets:[]}),t),
    env.DB.prepare("INSERT OR IGNORE INTO job_sources(id,name) VALUES('freehire','FreeHire')"),
    env.DB.prepare("INSERT OR IGNORE INTO source_sync_state(source_id) VALUES('freehire')"),
    env.DB.prepare(`INSERT OR IGNORE INTO job_sources(id,name,config_json) VALUES ${INITIAL_FEEDS.map(()=>'(?,?,?)').join(',')}`).bind(...INITIAL_FEEDS.flatMap(f=>[f.id,f.name,JSON.stringify(f)])),
    env.DB.prepare('INSERT OR IGNORE INTO source_sync_state(source_id) SELECT id FROM job_sources WHERE id<>\'manual\'')
  ]);
  let users=initialized.get(env.DB);if(!users){users=new Set();initialized.set(env.DB,users);}users.add(owner(env));
}
export async function saveJob(env:Env, job:NormalizedJob, config:{data:Settings;revision:number}, sample=false, raw?:unknown) {
  const t=now(), canonical=canonicalUrl(job.apply_url), contentHash=await hash(JSON.stringify({...job,first_seen_at:undefined})), fingerprint=await hash(`${job.company.toLowerCase()}|${job.title.toLowerCase()}|${job.location.toLowerCase()}`);
  const existing = await env.DB.prepare('SELECT j.*,r.content_hash source_content_hash FROM jobs j JOIN job_source_refs r ON r.job_id=j.id WHERE r.source_id=? AND r.external_id=?').bind(job.source,job.external_id).first<{id:string;revision:number;content_hash:string;source_content_hash:string;first_seen_at:string}>();
  let master=existing;
  // Only a specific application path or requisition query is strong enough for cross-source merging.
  if (!master && canonical) {
    const u=new URL(canonical),last=u.pathname.split('/').filter(Boolean).at(-1) ?? '';
    const generic=/^(?:jobs?|careers?|openings?|opportunities|apply|positions?|vacancies|search)$/i.test(last);
    const specific=!generic && (/\/[^/]+\/[^/]+/.test(u.pathname) || /[?&](?:gh_jid|job|jobid|requisition|id)=/i.test(u.search));
    if(specific)master=await env.DB.prepare('SELECT id,revision,content_hash,first_seen_at FROM jobs WHERE canonical_apply_url=? LIMIT 1').bind(canonical).first();
  }
  const id=master?.id ?? crypto.randomUUID(), revision=(master?.revision ?? 0)+1;
  if (existing && existing.source_content_hash===contentHash) { await env.DB.batch([env.DB.prepare('UPDATE jobs SET last_seen_at=?,last_verified_at=?,availability=? WHERE id=?').bind(t,t,job.availability,id),env.DB.prepare('UPDATE job_source_refs SET last_seen_at=? WHERE source_id=? AND external_id=?').bind(t,job.source,job.external_id)]); return {id,duplicate:true}; }
  job.first_seen_at=master?.first_seen_at ?? job.first_seen_at;
  const snapshotKey=`jobs/snapshots/${job.source}/${id}-${revision}-raw.json`;
  await env.FILES.put(snapshotKey,JSON.stringify(raw ?? job),{httpMetadata:{contentType:'application/json'}});
  const e=experience(job,config.data.maximum_experience,config.data), l=location(job,config.data), eligibleRole=roleAllowed(job.title,config.data);
  const task=crypto.randomUUID(), key=`analyze:${id}:${revision}:${config.revision}`;
  const payload={task_id:task,kind:'ANALYZE_JOB',entity_id:id,entity_revision:revision,settings_revision:config.revision};
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO jobs(id,company,title,normalized_title,description,requirements_json,location,remote_type,allowed_countries_json,location_status,location_reason,role_status,role_reason,experience_status,experience_min,experience_max,job_url,apply_url,canonical_apply_url,fingerprint,salary_json,employment_type,seniority,availability,posted_at,first_seen_at,last_seen_at,last_verified_at,content_hash,revision,decision_settings_revision,created_at,updated_at,normalized_json,is_sample)
      VALUES(${Array(35).fill('?').join(',')}) ON CONFLICT(id) DO UPDATE SET description=excluded.description,title=excluded.title,normalized_title=excluded.normalized_title,requirements_json=excluded.requirements_json,remote_type=excluded.remote_type,location=excluded.location,allowed_countries_json=excluded.allowed_countries_json,location_status=excluded.location_status,location_reason=excluded.location_reason,role_status=excluded.role_status,role_reason=excluded.role_reason,experience_status=excluded.experience_status,experience_min=excluded.experience_min,experience_max=excluded.experience_max,apply_url=excluded.apply_url,canonical_apply_url=excluded.canonical_apply_url,availability=excluded.availability,last_seen_at=excluded.last_seen_at,last_verified_at=excluded.last_verified_at,content_hash=excluded.content_hash,revision=excluded.revision,decision_settings_revision=excluded.decision_settings_revision,updated_at=excluded.updated_at,normalized_json=excluded.normalized_json`)
      .bind(id,job.company,job.title,job.title.toLowerCase(),job.description,JSON.stringify(job.requirements),job.location,job.remote_type,JSON.stringify(job.allowed_countries),l.status,l.reason,eligibleRole?'ELIGIBLE':'NOT_ELIGIBLE',eligibleRole?'Target development role':'Excluded role',e.classification,e.min_years,e.max_years,job.job_url,job.apply_url,canonical,fingerprint,JSON.stringify(job.salary),job.employment_type,job.seniority,job.availability,job.posted_at,job.first_seen_at,t,t,contentHash,revision,config.revision,t,t,JSON.stringify(job),sample?1:0),
    env.DB.prepare(`INSERT INTO job_source_refs(id,job_id,source_id,external_id,public_slug,source_url,source_apply_url,snapshot_key,content_hash,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,external_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,content_hash=excluded.content_hash,snapshot_key=excluded.snapshot_key`).bind(crypto.randomUUID(),id,job.source,job.external_id,job.public_slug,job.job_url,job.apply_url,snapshotKey,contentHash,t,t),
    env.DB.prepare('INSERT INTO job_experience_analysis VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,revision,e.classification,e.min_years,e.max_years,e.confidence,e.reason,JSON.stringify(e.evidence),e.parser_version,'DETERMINISTIC',t),
    ...(eligibleRole&&e.classification==='ELIGIBLE'&&l.status==='COMPATIBLE'&&job.availability==='OPEN'?[env.DB.prepare('INSERT INTO tasks(id,user_id,kind,entity_id,entity_revision,idempotency_key,state,created_at,updated_at,settings_revision) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(task,owner(env),'ANALYZE_JOB',id,revision,key,'PENDING',t,t,config.revision),
    env.DB.prepare('INSERT INTO outbox(id,task_id,payload_json,available_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),task,JSON.stringify(payload),t)]:[]),
    env.DB.prepare('DELETE FROM job_skills WHERE job_id=?').bind(id),
    ...job.skills.map(skill=>env.DB.prepare("INSERT INTO job_skills(job_id,skill,requirement_type,evidence) VALUES(?,?,'MENTIONED',?)").bind(id,skill,`Source technology evidence: ${skill}`))
  ]);
  return {id,duplicate:false};
}
export async function dispatch(env:Env) {
  const token=crypto.randomUUID(),t=now();
  const rows=await env.DB.prepare('UPDATE outbox SET dispatch_token=?,dispatch_until=? WHERE id IN (SELECT id FROM outbox WHERE completed_at IS NULL AND available_at<=? AND (dispatched_at IS NULL OR dispatched_at<?) AND (dispatch_until IS NULL OR dispatch_until<=?) LIMIT 20) RETURNING id,payload_json').bind(token,new Date(Date.now()+90000).toISOString(),t,new Date(Date.now()-600000).toISOString(),t).all<{id:string;payload_json:string}>();
  try{for(const row of rows.results){
    await env.TASKS.send(JSON.parse(row.payload_json));
    await env.DB.prepare('UPDATE outbox SET dispatched_at=?,attempts=attempts+1,dispatch_token=NULL,dispatch_until=NULL WHERE id=? AND dispatch_token=?').bind(now(),row.id,token).run();
  }}finally{await env.DB.prepare('UPDATE outbox SET dispatch_token=NULL,dispatch_until=NULL WHERE dispatch_token=?').bind(token).run();}
}
