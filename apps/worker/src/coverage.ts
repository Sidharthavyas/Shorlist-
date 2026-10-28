import type { Env } from './env';
import { dispatch, now, saveJob, settings } from './store';
import { roleAllowed, MATCH_ENGINE } from './domain';
import { owner } from './env';
import { fetchFeed, normalizeFeed, FeedError, type Feed } from './providers';

type Cursor={pageKey?:string;offset:number;upstream:string|null;next?:string|null;};
export async function syncFeed(env:Env,id:string){
  const row=await env.DB.prepare('SELECT * FROM job_sources WHERE id=? AND enabled=1').bind(id).first<{id:string;name:string;config_json:string}>();
  if(!row)return {state:'DISABLED'};
  const feed={...JSON.parse(row.config_json),id:row.id,name:row.name} as Feed;
  if(!feed.provider)return {state:'NOT_CONFIGURED'};
  const t=now(),token=crypto.randomUUID();
  const lease=await env.DB.prepare('UPDATE source_sync_state SET lease_token=?,lease_until=?,queued_until=NULL,run_started_at=COALESCE(run_started_at,?) WHERE source_id=? AND (lease_until IS NULL OR lease_until<?) AND (next_retry_at IS NULL OR next_retry_at<=?) AND (cursor IS NOT NULL OR last_completed_at IS NULL OR last_completed_at<=?) RETURNING *').bind(token,new Date(Date.now()+120000).toISOString(),t,id,t,t,new Date(Date.now()-feed.interval*60000).toISOString()).first<{cursor:string|null;counters_json:string;run_started_at:string}>();
  if(!lease)return {state:'BUSY_OR_NOT_DUE'};
  const cursor:Cursor=lease.cursor?JSON.parse(lease.cursor):{offset:0,upstream:null};
  const counters=lease.cursor?JSON.parse(lease.counters_json):{fetched:0,stored:0,duplicates:0,invalid_records:0,skipped:0,pages:0};
  try{
    let jobs:unknown[];
    if(cursor.pageKey){const cached=await env.FILES.get(cursor.pageKey);if(!cached)throw new FeedError('PAGE_CACHE_MISSING');jobs=JSON.parse(await cached.text());}
    else{
      const page=await fetchFeed(feed,cursor.upstream);jobs=page.jobs;cursor.next=page.next;cursor.offset=0;
      cursor.pageKey=`jobs/feeds/${id}/${token}.json`;await env.FILES.put(cursor.pageKey,JSON.stringify(jobs));counters.pages++;
    }
    const config=await settings(env),end=Math.min(cursor.offset+25,jobs.length);let invalid=0;
    for(let i=cursor.offset;i<end;i++){
      counters.fetched++;
      let job;try{job=normalizeFeed(feed,jobs[i],lease.run_started_at);}catch{invalid++;counters.invalid_records++;await env.FILES.put(`jobs/quarantine/${id}/${token}-${i}.json`,JSON.stringify(jobs[i]));continue;}
      if(!job||!roleAllowed(job.title,config.data)){counters.skipped++;continue;}
      const result=await saveJob(env,job,config,false,jobs[i]);counters.stored++;if(result.duplicate)counters.duplicates++;
    }
    if(end-cursor.offset>3&&invalid>(end-cursor.offset)/2)throw new FeedError('SOURCE_SCHEMA_DRIFT');
    cursor.offset=end;
    const pageDone=cursor.offset>=jobs.length,complete=pageDone&&!cursor.next;
    const next:Cursor=pageDone?{offset:0,upstream:cursor.next??null}:cursor;
    // Himalayas asks for a daily feed walk; spread page requests across the queue.
    const continuationDelay=feed.provider==='himalayas'&&pageDone?2:0;
    await env.DB.prepare('UPDATE source_sync_state SET cursor=?,last_completed_at=CASE WHEN ? THEN ? ELSE last_completed_at END,run_started_at=CASE WHEN ? THEN NULL ELSE run_started_at END,lease_token=NULL,lease_until=NULL,next_retry_at=NULL,last_error_code=NULL,counters_json=? WHERE source_id=? AND lease_token=?').bind(complete?null:JSON.stringify(next),complete?1:0,now(),complete?1:0,JSON.stringify(counters),id,token).run();
    // Queue publication before cache deletion makes the committed cursor recoverable.
    await dispatch(env);
    if(!complete)await env.TASKS.send({kind:'SYNC_FEED',source_id:id},{delaySeconds:continuationDelay});
    if(pageDone&&cursor.pageKey)await env.FILES.delete(cursor.pageKey);
    return {state:complete?'COMPLETE':'RESUMABLE',...counters};
  }catch(error){
    const code=error instanceof FeedError?error.code:'SOURCE_CONTRACT_OR_FETCH_ERROR';
    const reset=code==='UPSTREAM_400'||code==='PAGE_CACHE_MISSING';
    await env.DB.prepare('UPDATE source_sync_state SET lease_token=NULL,lease_until=NULL,last_error_code=?,next_retry_at=?,cursor=CASE WHEN ? THEN NULL ELSE cursor END,run_started_at=CASE WHEN ? THEN NULL ELSE run_started_at END WHERE source_id=? AND lease_token=?').bind(code,new Date(Date.now()+(error instanceof FeedError?error.retryAfter:300)*1000).toISOString(),reset?1:0,reset?1:0,id,token).run();
    // A failed first page has no persisted cursor; subsequent runs start it safely again.
    throw new Error(`${id}: ${code}`);
  }
}
export async function queueCoverage(env:Env){
  const t=now();
  const rows=await env.DB.prepare("UPDATE source_sync_state SET queued_until=? WHERE source_id IN (SELECT s.id FROM job_sources s JOIN source_sync_state t ON t.source_id=s.id WHERE s.enabled=1 AND s.id<>'freehire' AND json_extract(s.config_json,'$.provider') IS NOT NULL AND (t.next_retry_at IS NULL OR t.next_retry_at<=?) AND (t.lease_until IS NULL OR t.lease_until<=?) AND (t.queued_until IS NULL OR t.queued_until<=?) AND (t.cursor IS NOT NULL OR t.last_completed_at IS NULL OR julianday(t.last_completed_at)<=julianday(?)-COALESCE(json_extract(s.config_json,'$.interval'),360)/1440.0) ORDER BY COALESCE(t.last_completed_at,''),s.id LIMIT 12) RETURNING source_id").bind(new Date(Date.now()+120000).toISOString(),t,t,t,t).all<{source_id:string}>();
  for(const row of rows.results)await env.TASKS.send({kind:'SYNC_FEED',source_id:row.source_id});
  return rows.results.map(r=>r.source_id);
}
export async function refreshPatternMatches(env:Env){
  const config=await settings(env),profile=await env.DB.prepare('SELECT revision FROM profiles WHERE user_id=?').bind(owner(env)).first<{revision:number}>();
  const rows=await env.DB.prepare("SELECT j.id,j.revision FROM jobs j LEFT JOIN job_matches m ON m.job_id=j.id AND m.user_id=? WHERE j.availability='OPEN' AND j.role_status='ELIGIBLE' AND j.experience_status='ELIGIBLE' AND j.location_status='COMPATIBLE' AND (m.engine_version IS NULL OR m.engine_version<>? OR m.profile_revision<>? OR m.job_revision<>j.revision OR m.settings_revision<>?) LIMIT 50").bind(owner(env),MATCH_ENGINE,profile?.revision??1,config.revision).all<{id:string;revision:number}>();
  for(const row of rows.results){const id=crypto.randomUUID(),key=`match:${MATCH_ENGINE}:${row.id}:${row.revision}:${profile?.revision??1}:${config.revision}`,payload={kind:'ANALYZE_JOB',task_id:id,entity_id:row.id,entity_revision:row.revision,settings_revision:config.revision};await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO tasks(id,user_id,kind,entity_id,entity_revision,idempotency_key,state,created_at,updated_at,settings_revision) VALUES(?,?,'ANALYZE_JOB',?,?,?,'PENDING',?,?,?)").bind(id,owner(env),row.id,row.revision,key,now(),now(),config.revision),env.DB.prepare('INSERT OR IGNORE INTO outbox(id,task_id,payload_json,available_at) SELECT ?,id,?,? FROM tasks WHERE id=?').bind(id,JSON.stringify(payload),now(),id)]);}
  await dispatch(env);
  if(rows.results.length===50)await env.TASKS.send({kind:'REFRESH_MATCHES'},{delaySeconds:10});
  return rows.results.length;
}
