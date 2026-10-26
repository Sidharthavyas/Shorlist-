import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const calls=[];
const description='0-2 years of professional experience. Build Python FastAPI backend services.';
const application=n=>`https://careers.example.test/jobs/coverage-${n}`;
const jobicy=n=>({id:n,jobTitle:'Backend Engineer',companyName:'Fixture',jobDescription:description,jobGeo:'India',url:application(n),jobType:['Full-Time']});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:readFileSync('work/worker-build/index.js','utf8'),compatibilityDate:'2026-10-23',d1Databases:['DB'],r2Buckets:['FILES'],queueProducers:{TASKS:'coverage'},queueConsumers:{coverage:{maxBatchSize:1,maxBatchTimeout:0,maxRetries:0}},bindings:{APP_ENV:'local',APP_ORIGIN:'http://127.0.0.1:5173'},serviceBindings:{ASSETS:()=>new Response('assets')},outboundService:async request=>{
 const url=new URL(request.url);calls.push(url.href);let data;
 if(url.hostname==='jobicy.com')data={jobs:url.searchParams.has('cursor')?[jobicy(1)]:Array.from({length:30},(_,i)=>jobicy(i+1)),nextCursor:url.searchParams.has('cursor')?null:'opaque-page-2'};
 else if(url.hostname==='remotive.com')return new Response('Rate limited',{status:429,headers:{'Retry-After':'3600'}});
 else if(url.hostname==='himalayas.app')data={jobs:url.searchParams.get('page')==='1'?[{guid:'https://himalayas.app/companies/fixture/jobs/1',title:'Backend Engineer',companyName:'Fixture',description,applicationLink:application(101),locationRestrictions:['India'],timezoneRestrictions:[5.5]}]:[]};
 else if(url.hostname==='boards-api.greenhouse.io')data={jobs:Array.from({length:40},(_,i)=>({id:i+1,title:'Backend Engineer',content:description,absolute_url:i===0?application(1):application(200+i),location:{name:'Remote India'}}))};
 else if(url.hostname==='api.ashbyhq.com')data={jobs:[{id:'a1',title:'Backend Engineer',descriptionPlain:description,location:'Remote, Global',isRemote:true,isListed:true,jobUrl:'https://jobs.ashbyhq.com/fixture/a1',applyUrl:application(300)},{isListed:false}]};
 else if(url.hostname==='api.lever.co'){const skip=Number(url.searchParams.get('skip')??0);data=Array.from({length:skip?1:100},(_,i)=>({id:'l'+(skip+i),text:'Backend Engineer',descriptionPlain:description,hostedUrl:application(400+skip+i),categories:{location:'India'},workplaceType:'remote'}));}
 else return new Response('Unexpected source',{status:502});
 return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
}}));
let checks=0;const pass=name=>{console.log('PASS '+name);checks++;};
async function request(path,method='GET',body){const r=await mf.dispatchFetch('http://localhost/api/v1'+path,{method,headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};}
try{
 const db=await mf.getD1Database('DB');for(const f of ['migrations/0001_initial.sql','migrations/0002_runtime.sql'])await db.exec(readFileSync(f,'utf8').replace(/--[^\n]*/g,'').replace(/\r?\n/g,' '));
 const sources=(await request('/sources')).data;assert.equal(sources.length,10);pass('All seven provider types initialize without a new database or migration');
 const enabled=['himalayas','jobicy','remotive','greenhouse:stripe','ashby:supabase','lever:palantir'];for(const s of sources)if(!enabled.includes(s.id))await request('/sources/'+encodeURIComponent(s.id),'PATCH',{enabled:false});
 await request('/profile','PUT',{revision:1,name:'Test Candidate',email:'candidate@example.test',headline:'Backend Engineer',skills:['Python','FastAPI'],education:[],experience:[],projects:['Built a Python API.'],verified_bullets:[]});
 assert.equal((await request('/sources','POST',{provider:'lever',board:'../../evil',company:'Bad'})).status,400);pass('Company watchlist rejects arbitrary paths and hosts');
 assert.equal((await request('/sources/sync','POST')).status,202);
 let states;
 for(let i=0;i<400;i++){states=(await request('/sources')).data;if(states.filter(s=>enabled.includes(s.id)&&s.id!=='remotive').every(s=>s.last_completed_at&&!s.cursor&&!s.lease_token)&&states.find(s=>s.id==='remotive').last_error_code)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(states.filter(s=>enabled.includes(s.id)&&s.id!=='remotive').every(s=>s.last_completed_at&&!s.cursor),JSON.stringify(states.map(s=>[s.id,s.cursor,s.last_error_code])));pass('Five source adapters complete independently through real Worker queue consumers');
 assert.equal(states.find(s=>s.id==='remotive').last_error_code,'UPSTREAM_429');assert.ok(Date.parse(states.find(s=>s.id==='remotive').next_retry_at)>Date.now()+3000000);pass('A rate-limited provider backs off while other sources finish');
 assert.equal(calls.filter(x=>x.includes('boards-api.greenhouse.io')).length,1);assert.equal(JSON.parse(states.find(s=>s.id==='greenhouse:stripe').counters_json).fetched,40);pass('Large company feeds resume from R2 page cache without refetching or truncating');
 assert.equal(calls.filter(x=>x.includes('jobicy.com')).length,2);assert.equal(JSON.parse(states.find(s=>s.id==='jobicy').counters_json).duplicates,1);pass('Opaque pagination resumes and duplicate source records remain idempotent');
 assert.ok(calls.some(x=>x.includes('skip=100')));assert.equal(JSON.parse(states.find(s=>s.id==='lever:palantir').counters_json).fetched,101);pass('Lever pagination reads beyond the first 100 postings');
 assert.equal(calls.filter(x=>x.includes('himalayas.app')).length,6);pass('Himalayas searches all engineer/developer/SDE queries through their empty terminal pages');
 const refs=await db.prepare('SELECT COUNT(*) n FROM job_source_refs').first(),jobs=await db.prepare('SELECT COUNT(*) n FROM jobs').first();assert.ok(refs.n>jobs.n);pass('Identical specific application URLs merge across sources');
 let result;for(let i=0;i<100;i++){result=await request('/jobs?source=jobicy&sort=match');if(result.data.length===30)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(result.data.length,30);assert.ok(result.data.every(j=>JSON.parse(j.analysis_json).engine_version==='patterns-2'));assert.ok(result.data.every(j=>JSON.parse(j.analysis_json).verified_matching_skills.includes('Python')));pass('Source filtering and profile pattern evidence work in Discover');
 const before=calls.length;await request('/sources/sync','POST');await new Promise(r=>setTimeout(r,600));assert.equal(calls.length,before);pass('Repeated Sync respects daily/six-hour polling windows and provider backoff');
 await request('/sources/jobicy','PATCH',{enabled:false});assert.equal((await request('/sources/jobicy/sync','POST')).status,422);pass('Disabled feeds cannot be synchronized');
 await db.prepare("UPDATE jobs SET availability='UNKNOWN' WHERE id IN (SELECT job_id FROM job_source_refs WHERE source_id='jobicy')").run();
 await db.prepare("UPDATE source_sync_state SET last_completed_at='2000-01-01T00:00:00.000Z' WHERE source_id='jobicy'").run();
 await request('/sources/jobicy','PATCH',{enabled:true});await request('/sources/jobicy/sync','POST');
 for(let i=0;i<100;i++){const row=await db.prepare("SELECT cursor,last_completed_at FROM source_sync_state WHERE source_id='jobicy'").first();if(!row.cursor&&row.last_completed_at!=='2000-01-01T00:00:00.000Z')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM jobs j JOIN job_source_refs r ON r.job_id=j.id WHERE r.source_id='jobicy' AND j.availability='UNKNOWN'").first()).n,0);pass('Fresh positive verification restores unchanged jobs after stale status');
 const cache=await (await mf.getR2Bucket('FILES')).list({prefix:'jobs/feeds/'});assert.equal(cache.objects.length,0);pass('Completed cached pages are cleaned up');
 console.log(checks+' multi-source Worker integration checks passed.');
}finally{await mf.dispose();}
