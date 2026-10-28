import type {Env} from './env';
import {owner,OWNER} from './env';
import {settings,now} from './store';
import {experience,location,roleAllowed,match,MATCH_ENGINE} from './domain';
import type {NormalizedJob} from '../../../contracts/domain';
// A page performs at most twenty new decisions. The indexed cursor avoids
// rescanning the whole catalog on every page read, or fanning out queue work.
export async function personalize(env:Env){
 if(env.MULTI_USER!=='enabled'||owner(env)===OWNER)return {more:false};
 const id=owner(env),config=await settings(env),p=await env.DB.prepare('SELECT revision,data_json FROM profiles WHERE user_id=?').bind(id).first<{revision:number;data_json:string}>();
 if(!p)return {more:false};
 const profile=JSON.parse(p.data_json),state=await env.DB.prepare('SELECT * FROM personalization_state WHERE user_id=?').bind(id).first<{settings_revision:number;profile_revision:number;cursor_time:string;cursor_id:string}>();
 const current=state?.settings_revision===config.revision&&state?.profile_revision===p.revision;
 const time=current?state!.cursor_time:'',cursor=current?state!.cursor_id:'';
 const rows=await env.DB.prepare("SELECT id,revision,normalized_json,updated_at FROM jobs WHERE (updated_at,id)>(?,?) AND NOT EXISTS(SELECT 1 FROM job_source_refs r WHERE r.job_id=jobs.id AND r.source_id='manual') ORDER BY updated_at,id LIMIT 20").bind(time,cursor).all<{id:string;revision:number;normalized_json:string;updated_at:string}>();
 const priority=current?[]:(await env.DB.prepare("SELECT id,revision,normalized_json,updated_at FROM jobs WHERE is_sample=0 AND availability='OPEN' AND role_status='ELIGIBLE' AND experience_status='ELIGIBLE' AND location_status='COMPATIBLE' AND NOT EXISTS(SELECT 1 FROM job_source_refs r WHERE r.job_id=jobs.id AND r.source_id='manual') ORDER BY first_seen_at DESC,id LIMIT 20").all<{id:string;revision:number;normalized_json:string;updated_at:string}>()).results;
 const statements:D1PreparedStatement[]=[];
 for(const row of new Map([...priority,...rows.results].map(row=>[row.id,row])).values()){const job=JSON.parse(row.normalized_json) as NormalizedJob,e=experience(job,config.data.maximum_experience,config.data),l=location(job,config.data),role=roleAllowed(job.title,config.data);
  statements.push(env.DB.prepare('INSERT INTO job_decisions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,job_id) DO UPDATE SET job_revision=excluded.job_revision,settings_revision=excluded.settings_revision,profile_revision=excluded.profile_revision,experience_status=excluded.experience_status,location_status=excluded.location_status,role_status=excluded.role_status').bind(id,row.id,row.revision,config.revision,p.revision,e.classification,l.status,role?'ELIGIBLE':'NOT_ELIGIBLE'));
  const score=match(job,profile.skills??[],config.data,[profile.headline,profile.professional_summary,...(profile.experience??[]),...(profile.projects??[])].filter(Boolean).join(' '));
  if(score)statements.push(env.DB.prepare('INSERT INTO job_matches(user_id,job_id,score,breakdown_json,analysis_json,profile_revision,settings_revision,job_revision,engine_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,job_id) DO UPDATE SET score=excluded.score,breakdown_json=excluded.breakdown_json,analysis_json=excluded.analysis_json,profile_revision=excluded.profile_revision,settings_revision=excluded.settings_revision,job_revision=excluded.job_revision,engine_version=excluded.engine_version').bind(id,row.id,score.score,JSON.stringify(score.breakdown),JSON.stringify(score),p.revision,config.revision,row.revision,MATCH_ENGINE,now()));
 }
 const last=rows.results.at(-1);
 statements.push(env.DB.prepare('INSERT INTO personalization_state VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET settings_revision=excluded.settings_revision,profile_revision=excluded.profile_revision,cursor_time=excluded.cursor_time,cursor_id=excluded.cursor_id').bind(id,config.revision,p.revision,last?.updated_at??time,last?.id??cursor));
 await env.DB.batch(statements);return {more:rows.results.length===20};
}
