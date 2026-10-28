import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const description='Build Python FastAPI backend services. 0-2 years of professional experience.';
const calls=[];
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:readFileSync('work/worker-build/index.js','utf8'),compatibilityDate:'2026-10-23',d1Databases:['DB'],r2Buckets:['FILES'],queueProducers:{TASKS:'companies'},queueConsumers:{companies:{maxBatchSize:1,maxBatchTimeout:0,maxRetries:0}},bindings:{APP_ENV:'local',APP_ORIGIN:'http://127.0.0.1:5173'},outboundService:async request=>{
 const u=new URL(request.url);calls.push(u.href);let data;
 if(u.hostname==='fixture.wd5.myworkdayjobs.com'){
  if(u.pathname.endsWith('/jobs')){const body=await request.json();data={total:body.searchText==='engineer'?11:0,jobPostings:body.searchText==='engineer'?Array.from({length:body.offset?1:10},(_,i)=>({title:'Backend Engineer',externalPath:'/job/India/Engineer_'+(body.offset+i)})):[]};}
  else {const id=u.pathname.split('_').at(-1);data={jobPostingInfo:{jobReqId:id,title:'Backend Engineer',jobDescription:description,location:'India',remoteType:'Remote',startDate:'2026-10-28'}};}
 }else if(u.hostname==='api.smartrecruiters.com'){
  if(u.search){assert.equal(u.searchParams.get('destination'),'PUBLIC');data={totalFound:u.searchParams.get('q')==='engineer'?1:0,content:u.searchParams.get('q')==='engineer'?[{id:'smart-one',name:'Backend Engineer'}]:[]};}
  else data={name:'Backend Engineer',postingUrl:'https://jobs.smartrecruiters.com/fixture/smart-one',location:{country:'India',remote:true},jobAd:{sections:{jobDescription:{title:'Responsibilities',text:description}}}};
 }else if(u.hostname==='apply.workable.com')data={jobs:[{shortcode:'workable-one',title:'Backend Engineer',description,url:'https://apply.workable.com/fixture/j/workable-one/',location:{country:'India'},telecommuting:true},{shortcode:'workable-us',title:'Backend Engineer',description,url:'https://apply.workable.com/fixture/j/workable-us/',location:{country:'United States'},telecommuting:true}]};
 else if(u.hostname==='remoteok.com')data=[{legal:'Link to Remote OK'},{id:'remote-one',position:'Backend Engineer',company:'Fixture',description,location:'Worldwide',url:'https://remoteok.com/remote-jobs/one'}];
 else if(u.hostname==='www.arbeitnow.com')data={data:[{slug:'arbeit-one',title:'Backend Engineer',company_name:'Fixture',description,location:'India',remote:true,url:'https://www.arbeitnow.com/view/one'}],links:{next:null}};
 else return new Response('unexpected fixture host',{status:502});
 return Response.json(data);
}}));
async function request(path,method='GET',body){const r=await mf.dispatchFetch('http://localhost/api/v1'+path,{method,headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,await r.clone().text());return (await r.json()).data;}
try{
 const db=await mf.getD1Database('DB');
 for(const f of ['0001_initial','0002_runtime','0004_durable_work'])await db.exec(readFileSync('migrations/'+f+'.sql','utf8').replace(/--[^\n]*/g,'').replace(/\r?\n/g,' '));
 await request('/sources');
 const migration=readFileSync('migrations/0005_company_sources.sql','utf8').replace(/^--[^\n]*/gm,'').replace(/\r?\n/g,' ');await db.exec(migration);await db.prepare("UPDATE job_sources SET enabled=0 WHERE id='greenhouse:razorpaysoftwareprivatelimited'").run();await db.exec(migration);
 assert.equal((await db.prepare("SELECT enabled FROM job_sources WHERE id='greenhouse:razorpaysoftwareprivatelimited'").first()).enabled,0);console.log('PASS migration is idempotent and preserves disabled sources');
 assert.equal((await request('/companies')).length,470);console.log('PASS company directory includes all 470 supplied entries');
 await db.prepare('UPDATE job_sources SET enabled=0').run();
 const fixtures=['workday','smartrecruiters','workable','remoteok','arbeitnow'];
 for(const provider of fixtures){const id=provider+':fixture',config={id,name:'Fixture '+provider,provider,board:'fixture',host:'fixture.wd5.myworkdayjobs.com',site:'External',company:'Fixture '+provider,interval:720};await db.batch([db.prepare('INSERT INTO job_sources(id,name,enabled,config_json) VALUES(?,?,1,?)').bind(id,config.name,JSON.stringify(config)),db.prepare('INSERT INTO source_sync_state(source_id) VALUES(?)').bind(id)]);}
 await request('/profile','PUT',{revision:1,name:'Candidate',email:'candidate@example.test',headline:'Backend Engineer',skills:['Python','FastAPI'],education:[],experience:[],projects:['Built Python services.'],verified_bullets:[]});
 await request('/sources/sync','POST');let states;
 for(let i=0;i<300;i++){states=await request('/sources');if(fixtures.every(p=>states.find(s=>s.id===p+':fixture')?.last_completed_at))break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(fixtures.every(p=>states.find(s=>s.id===p+':fixture')?.last_completed_at),JSON.stringify(states.filter(s=>s.enabled).map(s=>[s.id,s.last_error_code,s.cursor])));
 assert.equal(JSON.parse(states.find(s=>s.id==='workday:fixture').counters_json).fetched,11);assert.ok(calls.some(url=>url.endsWith('/Engineer_10')));console.log('PASS five new providers complete through queued Worker ingestion, including Workday pagination and detail hydration');
 let jobs=[];for(let i=0;i<100;i++){jobs=await request('/jobs?limit=100');if(jobs.length===15)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(jobs.length,15);assert.ok(jobs.every(j=>j.experience_status==='ELIGIBLE'&&j.location_status==='COMPATIBLE'));assert.ok(jobs.every(j=>j.description.includes('Python FastAPI')));assert.ok(jobs.every(j=>JSON.parse(j.analysis_json).engine_version==='patterns-2'));console.log('PASS all five providers produce factual, gated pattern matches from full descriptions');
 const incompatible=await db.prepare("SELECT j.id,j.location_status FROM jobs j JOIN job_source_refs r ON r.job_id=j.id WHERE r.external_id='workable-us'").first();assert.equal(incompatible.location_status,'INCOMPATIBLE');assert.equal((await db.prepare("SELECT COUNT(*) n FROM tasks WHERE entity_id=? AND kind='ANALYZE_JOB'").bind(incompatible.id).first()).n,0);console.log('PASS incompatible jobs remain stored without wasting matching queue operations');
 assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
}finally{await mf.dispose();}
