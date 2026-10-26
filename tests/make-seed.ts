import { writeFileSync } from 'node:fs';
import { DEFAULTS, experience, location, match } from '../apps/worker/src/domain';
import { normalize } from '../apps/worker/src/source';
const sql=(v:unknown)=>v===null?'NULL':typeof v==='number'?String(v):`'${String(v).replace(/'/g,"''")}'`;
const insert=(table:string,row:Record<string,unknown>)=>`INSERT OR IGNORE INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(sql).join(',')});`;
const t=new Date().toISOString();let lines=[
insert('users',{id:'primary-owner',access_subject:'local-owner',email:'owner@example.test',created_at:t}),
insert('settings',{user_id:'primary-owner',data_json:JSON.stringify(DEFAULTS),updated_at:t}),
insert('profiles',{user_id:'primary-owner',data_json:JSON.stringify({name:'',email:'owner@example.test',skills:[],education:[],experience:[],projects:[],verified_bullets:[]}),updated_at:t}),
insert('job_sources',{id:'freehire',name:'FreeHire'}),insert('source_sync_state',{source_id:'freehire'})];
const samples=[
 ['Orbit Labs','Backend Software Engineer','Python, FastAPI, PostgreSQL, Docker','0–2 years of experience','Worldwide'],
 ['Layers','Full Stack Developer','React, TypeScript, Node.js, SQL','1–2 years of experience','India'],
 ['Northstar','Software Development Engineer','Java, Spring Boot, AWS, Redis','Fresh graduates are encouraged to apply','Worldwide'],
 ['Form & Function','Frontend Engineer','React, TypeScript, JavaScript','0–1 years of experience','Worldwide'],
 ['Context AI','AI Application Engineer','Python, FastAPI, LLM, RAG','No prior professional experience required','India'],
 ['Sundial','iOS Developer','Swift, SwiftUI, iOS','1–2 years of experience','Worldwide'],
 ['Signal Studio','Junior Software Engineer','Python, React','2+ years preferred','Worldwide'],
 ['Evergreen','Software Engineer','Java, AWS','Minimum 3 years of experience','Worldwide']
];
for(const [i,[company,title,stack,requirement,scope]] of samples.entries()) {
 const id=`sample-${i+1}`,j=normalize({public_slug:id,title,company,url:`https://example.com/jobs/${id}`,work_mode:'remote',countries:scope==='India'?['in']:[],location:`${scope} remote`,description:`${requirement}.\n\nAbout the role\nJoin ${company} to build reliable products with a small, collaborative engineering team. Work on ${stack}.\n\nWhat you will do\nDesign, build, and maintain thoughtful software. Participate in code review, write tests, and learn from experienced engineers.\n\nRequirements\n${requirement}.\nFamiliarity with ${stack}.\n\nThis is fictional sample data for local evaluation, not an available job.`,skills:stack.split(', ')});
 j.first_seen_at=new Date(Date.now()-i*3600000).toISOString();const e=experience(j),l=location(j),m=match(j,[]);
 lines.push(insert('jobs',{id,company,title,normalized_title:title.toLowerCase(),description:j.description,requirements_json:'[]',location:j.location,remote_type:j.remote_type,location_status:l.status,location_reason:l.reason,role_status:'ELIGIBLE',role_reason:'Target role',experience_status:e.classification,experience_min:e.min_years,experience_max:e.max_years,job_url:j.job_url,apply_url:j.apply_url,canonical_apply_url:j.apply_url,fingerprint:id,availability:'OPEN',posted_at:j.posted_at,first_seen_at:j.first_seen_at,last_seen_at:t,last_verified_at:t,content_hash:id,revision:1,decision_settings_revision:1,created_at:t,updated_at:t,normalized_json:JSON.stringify(j),is_sample:1}),insert('job_source_refs',{id,job_id:id,source_id:'freehire',external_id:id,public_slug:id,source_url:j.job_url,source_apply_url:j.apply_url,content_hash:id,first_seen_at:t,last_seen_at:t}),insert('job_experience_analysis',{id,job_id:id,job_revision:1,classification:e.classification,min_years:e.min_years,max_years:e.max_years,confidence:e.confidence,reason:e.reason,evidence_json:JSON.stringify(e.evidence),parser_version:e.parser_version,method:'DETERMINISTIC',created_at:t}));
 if(m) lines.push(insert('job_matches',{user_id:'primary-owner',job_id:id,score:m.score,breakdown_json:JSON.stringify(m.breakdown),analysis_json:JSON.stringify(m),profile_revision:1,settings_revision:1,job_revision:1,engine_version:'deterministic-1',created_at:t}));
}
writeFileSync('seed.sql',`-- FICTIONAL LOCAL SAMPLE DATA ONLY. Never seed production.\n${lines.join('\n')}\n`);
console.log('Created seed.sql with clearly marked sample jobs.');
