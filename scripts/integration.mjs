import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const sourceOffsets=[];
const mf=new Miniflare(convertV4MiniflareOptions({
 modules:true,script:readFileSync('work/worker-build/index.js','utf8'),compatibilityDate:'2026-10-23',
 d1Databases:['DB'],r2Buckets:['FILES'],queueProducers:{TASKS:'test-tasks'},queueConsumers:{'test-tasks':{maxBatchSize:1,maxBatchTimeout:0,maxRetries:0}},
 bindings:{APP_ENV:'local',APP_ORIGIN:'http://127.0.0.1:5173',ACCESS_ISSUER:'',ACCESS_AUDIENCE:''},
 outboundService:async request=>{
  const url=new URL(request.url);
  if(url.hostname==='freehire.me'&&url.pathname==='/api/v1/agent/jobs/search'){
   const offset=Number(url.searchParams.get('offset')||0);sourceOffsets.push(offset);
   const rows=offset<8?[offset,offset+1].map(index=>index===1?{public_slug:'invalid-fixture',company:'Missing title'}:{public_slug:`fixture-${index}`,company:index===0?'':`Fixture Company ${index}`,title:'Backend Developer',description:'0-2 years of experience. Python APIs. India remote.',url:`https://careers.example.test/jobs/fixture-${index}`,location:'India remote',work_mode:'remote',countries:['in'],skills:['Python']}):[];
   return new Response(JSON.stringify({data:rows,meta:{total:8,offset,limit:2}}),{headers:{'Content-Type':'application/json'}});
  }
  return new Response('Unexpected external request in isolated test',{status:502});
 },
 serviceBindings:{ASSETS:()=>new Response('assets',{status:200})}
}));
let checks=0;
const pass=(name)=>{checks++;console.log(`PASS ${name}`);};
async function request(path,method='GET',body,origin='http://127.0.0.1:5173') {
 if(method==='GET'&&/^\/jobs(?:\?|$)/.test(path))path+=(path.includes('?')?'&':'?')+'demo=true';
 const r=await mf.dispatchFetch(`http://localhost/api/v1${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const json=await r.json();return {status:r.status,...json};
}
try {
 const db=await mf.getD1Database('DB');
 for(const file of ['migrations/0001_initial.sql','migrations/0002_runtime.sql','seed.sql'])await db.exec(readFileSync(file,'utf8').replace(/--[^\n]*/g,'').replace(/\r?\n/g,' '));
 assert.equal((await request('/health')).status,200);pass('Worker runs under workerd with D1 and R2');
 const defaults=await mf.dispatchFetch('http://localhost/api/v1/jobs');assert.equal((await defaults.json()).data.length,0);pass('Fictional sample jobs are hidden by default');
 let result=await request('/jobs');assert.equal(result.data.length,6);assert.ok(result.data.every(j=>j.experience_status==='ELIGIBLE'));pass('Discover excludes ambiguous and rejected jobs');
 result=await request('/jobs?view=review');assert.equal(result.data.length,1);assert.equal(result.data[0].id,'sample-7');pass('Review queue is separate');
 result=await request('/jobs?q=FastAPI');assert.equal(result.data.length,2);pass('Search matches descriptions');
 result=await request('/jobs/sample-1/disposition','PATCH',{status:'SAVED'},'https://evil.example');assert.equal(result.status,403);pass('Cross-origin mutation rejected');
 result=await request('/jobs/sample-1/disposition','PATCH',{status:'SAVED'});assert.equal(result.status,200);
 assert.equal((await request('/jobs?view=saved')).data.length,1);pass('Save persists in D1');
 await request('/jobs/sample-1/disposition','PATCH',{status:'IGNORED'});assert.equal((await request('/jobs')).data.length,5);pass('Ignore removes recommendation');
 await request('/jobs/sample-1/disposition','PATCH',{status:'NEW'});assert.equal((await request('/jobs')).data.length,6);pass('Restore brings recommendation back');
 let app=await request('/applications','POST',{job_id:'sample-1'});assert.equal(app.status,201);const id=app.data.id;
 app=await request('/applications','POST',{job_id:'sample-1'});assert.equal(app.data.id,id);pass('Repeated Mark Applied creates one application');
 app=await request(`/applications/${id}`,'PATCH',{version:1,status:'INTERVIEW',notes:'Test recruiter conversation'});assert.equal(app.data.status,'INTERVIEW');
 result=await request(`/applications/${id}/history`);assert.equal(result.data.length,2);pass('Tracker transition writes atomic history');
 result=await request(`/applications/${id}`,'PATCH',{version:1,status:'OFFER'});assert.equal(result.status,409);pass('Stale application revision rejected');
 result=await request('/analytics');assert.equal(result.data[0].interviews,1);pass('Analytics counts historical interview stage');
 const settings=(await request('/settings')).data;
 result=await request('/settings','PATCH',{...settings.data,revision:settings.revision,maximum_experience:3});assert.equal(result.status,400);pass('API rejects experience cap above two');
 result=await request('/profile','PUT',{revision:1,name:'Test Candidate',email:'candidate@example.test',skills:['Python','FastAPI'],education:['BSc Computer Science 2026'],experience:[],projects:['Built a Python API for a course project.'],verified_bullets:['Wrote 12 unit tests for the API.']});assert.equal(result.status,200);pass('Verified profile persists');
 const exported=await mf.dispatchFetch('http://localhost/api/v1/profile/autofill');assert.equal(exported.status,200);const exportedProfile=await exported.json();assert.equal(exportedProfile.format,'shortlist-profile');assert.equal(exportedProfile.profile.name,'Test Candidate');assert.ok(exported.headers.get('Content-Disposition').includes('shortlist-autofill-profile.json'));assert.equal((await request('/profile')).data.revision,2);pass('Autofill export downloads saved profile facts without mutating the profile');
 result=await request('/jobs/sample-1/resume-tasks','POST');assert.equal(result.status,202);const taskId=result.data.task_id;
 let task;
 for(let i=0;i<80;i++){task=await request(`/tasks/${taskId}`);if(['READY','FAILED'].includes(task.data.state))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(task.data.state,'READY',JSON.stringify(task));pass('Queued resume generation completes inside Workers');
 const resumes=await request('/resumes');assert.equal(resumes.data.length,1);const version=resumes.data[0].version_id;
 const pdf=await mf.dispatchFetch(`http://localhost/api/v1/resume-versions/${version}/files/pdf`);assert.equal(pdf.status,200);const pdfBytes=await pdf.arrayBuffer();assert.equal(new TextDecoder().decode(pdfBytes.slice(0,5)),'%PDF-');pass('Generated PDF is stored in R2 and downloads');
 const docx=await mf.dispatchFetch(`http://localhost/api/v1/resume-versions/${version}/files/docx`);assert.equal(docx.status,200);assert.equal(new Uint8Array(await docx.arrayBuffer())[0],0x50);pass('Generated DOCX is stored in R2 and downloads');
 result=await request('/jobs/sample-1/resume-tasks','POST');assert.equal(result.data.task_id,taskId);pass('Repeated generation reuses the same profile/job version');
 result=await request('/jobs/sample-8/resume-tasks','POST');assert.equal(result.status,422);pass('Rejected job cannot generate an eligible resume');
 const object=await (await mf.getR2Bucket('FILES')).get(resumes.data[0].pdf_key);assert.ok(object);pass('D1 resume metadata points to an existing private object');
 const form=new FormData();form.append('file',new File([pdfBytes],'master.pdf',{type:'application/pdf'}));
 const multipart=new Request('http://localhost',{method:'POST',body:form});
 const upload=await mf.dispatchFetch('http://localhost/api/v1/profile/uploads',{method:'POST',headers:{Origin:'http://127.0.0.1:5173','Content-Type':multipart.headers.get('Content-Type')},body:await multipart.arrayBuffer()});const parsed=await upload.json();assert.equal(upload.status,201,JSON.stringify(parsed));assert.ok(parsed.data.extracted_text.includes('TEST CANDIDATE'),JSON.stringify(parsed));pass('Master PDF text extraction works inside Workers and requires verification');
 const draft=await request('/profile/import-resume','POST',{});assert.equal(draft.status,200);assert.equal(draft.data.verification_required,true);assert.equal(draft.data.draft.name,'Test Candidate');
 assert.equal((await request('/profile')).data.revision,2);pass('Resume import returns an unverified draft without changing saved profile');
 const google=await request('/integrations/google');assert.equal(google.data.configured,false);pass('Google integration stays inactive without credentials');
 result=await request('/api-missing');assert.equal(result.status,404);pass('API misses return JSON rather than SPA HTML');
 const manual=await request('/jobs','POST',{company:'Test Company',title:'Software Engineer',description:'0-2 years of experience. Build Python APIs. Remote worldwide.',location:'Worldwide remote',remote_type:'WORLDWIDE_REMOTE',apply_url:'https://example.test/company/jobs/requisition-1'});assert.equal(manual.status,201);pass('Manual ingestion uses the same filtering pipeline');
 const started=await request('/sources/freehire/sync','POST');assert.equal(started.status,202);
 let source;
 for(let i=0;i<80;i++){source=(await request('/sources')).data.find(s=>s.source_id==='freehire');if(source.last_completed_at)break;await new Promise(resolve=>setTimeout(resolve,100));}
 assert.ok(source.last_completed_at,JSON.stringify(source));assert.deepEqual(sourceOffsets,[0,2,4,6]);pass('Source pagination continues through the queue after the initial bounded run');
 assert.equal(JSON.parse(source.counters_json).invalid_records,1);const quarantined=await(await mf.getR2Bucket('FILES')).list({prefix:'jobs/snapshots/freehire/quarantine/'});assert.equal(quarantined.objects.length,1);pass('One malformed source record is quarantined without blocking later pages');
 const real=await mf.dispatchFetch('http://localhost/api/v1/jobs');const realJobs=await real.json();assert.equal(realJobs.data.length,8);assert.ok(realJobs.data.every(j=>j.is_sample===0));pass('Default Discover shows imported real-source records without demo rows');
 console.log(`${checks} Cloudflare runtime integration checks passed.`);
} finally {await mf.dispose();}
