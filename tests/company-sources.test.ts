import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchFeed,normalizeFeed,type Feed} from '../apps/worker/src/providers';
import {boardsIn,discoverCompany,jobPostings,publicUrl} from '../apps/worker/src/company-discovery';
import catalog from '../config/company-catalog.json';
import coverage from '../config/company-coverage.json';
import feeds from '../config/company-feeds.json';
const description='Build Python APIs. 0-2 years of professional experience.';
const feed=(provider:Feed['provider']):Feed=>({id:provider,provider,name:'Fixture',board:'fixture',host:'fixture.wd5.myworkdayjobs.com',site:'External',company:'Fixture',interval:720});
test('all supplied companies are retained and connected statuses refer to verified feeds',()=>{
 assert.equal(catalog.length,470);assert.equal(new Set(catalog.map(c=>c.id)).size,470);assert.equal(coverage.length,470);
 for(const row of coverage){assert.ok(catalog.some(c=>c.id===row.id));assert.equal(row.status==='CONNECTED',row.sourceIds.length>0);for(const id of row.sourceIds)assert.ok(feeds.some(f=>f.id===id));}
});
test('discovery handles public ATS links, European endpoints and nested JobPosting data',()=>{
 const boards=boardsIn('https://job-boards.eu.greenhouse.io/groww https://api.lever.co/v0/postings/fixture https://tenant.wd5.myworkdayjobs.com/en-US/External/job/1');
 assert.equal(boards[0].host,'boards-api.greenhouse.io');assert.equal(boards[1].board,'fixture');assert.equal(boards[2].site,'External');
 assert.equal(jobPostings('<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"Engineer"}]}</script>')[0].title,'Engineer');
 for(const url of ['http://localhost/','https://127.0.0.1/','https://secret@company.com/','file:///x','https://[::1]/'])assert.equal(publicUrl(url),null);
});
test('a blocked company is never reported connected',async()=>{
 const result=await discoverCompany({id:'x',name:'Fixture',url:'https://careers.fixture.com'},async()=>new Response('blocked',{status:403}));assert.equal(result.status,'BLOCKED');assert.equal(result.boards.length,0);
});
test('Workday retrieves full descriptions, iterates search queries and rejects untrusted hosts',async()=>{
 const original=globalThis.fetch;const calls:string[]=[];
 try{globalThis.fetch=async(input,init)=>{const url=String(input);calls.push(url);if(url.endsWith('/jobs')){const body=JSON.parse(String(init?.body));assert.equal(body.limit,10);return Response.json({total:1,jobPostings:[{title:'Backend Engineer',externalPath:'/job/India/Backend-Engineer_1'}]});}return Response.json({jobPostingInfo:{jobReqId:'1',title:'Backend Engineer',jobDescription:description,location:'India',remoteType:'Remote',startDate:'2026-10-28'}});};
  const page=await fetchFeed(feed('workday'),null),job=normalizeFeed(feed('workday'),page.jobs[0])!;
  assert.equal(job.description,description);assert.equal(job.remote_type,'INDIA_REMOTE');assert.equal(JSON.parse(page.next!).query,1);assert.equal(calls.length,2);
  await assert.rejects(fetchFeed({...feed('workday'),host:'localhost'},null));assert.equal(calls.length,2);
 }finally{globalThis.fetch=original;}
});
test('SmartRecruiters reads only public postings and follows totalFound',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(input)=>{calls++;const url=new URL(String(input));if(url.search){assert.equal(url.searchParams.get('destination'),'PUBLIC');return Response.json({totalFound:11,content:[{id:'one',name:'Software Engineer'}]});}return Response.json({name:'Software Engineer',postingUrl:'https://jobs.smartrecruiters.com/fixture/one',location:{city:'Delhi',country:'India',remote:true},jobAd:{sections:{jobDescription:{title:'Work',text:description}}}});};
  const page=await fetchFeed(feed('smartrecruiters'),null),job=normalizeFeed(feed('smartrecruiters'),page.jobs[0])!;assert.ok(job.description.includes(description));assert.equal(JSON.parse(page.next!).offset,1);assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});
test('new public aggregators preserve attribution and do not turn unspecified remote into worldwide',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async()=>Response.json([{legal:'Attribution required'},{id:'1',position:'Backend Engineer',company:'Actual Employer',description,location:'',url:'https://remoteok.com/jobs/1',date:'2026-10-28'}]);
  const page=await fetchFeed(feed('remoteok'),null);assert.equal(page.jobs.length,1);const job=normalizeFeed(feed('remoteok'),page.jobs[0])!;assert.equal(job.company,'Actual Employer');assert.equal(job.remote_type,'REMOTE');assert.equal(job.job_url,'https://remoteok.com/jobs/1');
  globalThis.fetch=async()=>Response.json({data:[],links:{next:'https://evil.com/api/job-board-api?page=2'}});await assert.rejects(fetchFeed(feed('arbeitnow'),null));
 }finally{globalThis.fetch=original;}
});
