import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeed, geography, fetchFeed, type Feed } from '../apps/worker/src/providers';
import { experience, location, match, rolePatterns, skills } from '../apps/worker/src/domain';
const feed=(provider:Feed['provider']):Feed=>({id:provider,name:provider,provider,board:'company',company:'Company',interval:360});
const description='Build Python FastAPI services. 0–2 years of professional experience.';
const him={guid:'https://himalayas.app/companies/example/jobs/backend',title:'Backend Engineer',companyName:'Example',description,applicationLink:'https://himalayas.app/companies/example/jobs/backend?utm_source=api',locationRestrictions:[],timezoneRestrictions:[5.5],pubDate:1793000000,expiryDate:1990000000};
test('Himalayas countries and India timezone restrictions gate recommendations',()=>{
 const j=normalizeFeed(feed('himalayas'),him)!;assert.equal(location(j).status,'COMPATIBLE');assert.equal(experience(j).classification,'ELIGIBLE');
 assert.equal(location(normalizeFeed(feed('himalayas'),{...him,timezoneRestrictions:[-5,-8]})!).status,'INCOMPATIBLE');
 assert.equal(location(normalizeFeed(feed('himalayas'),{...him,locationRestrictions:['United States']})!).status,'INCOMPATIBLE');
 assert.equal(location(normalizeFeed(feed('himalayas'),{...him,timezoneRestrictions:[]})!).status,'REVIEW_REQUIRED');
 assert.equal(normalizeFeed(feed('himalayas'),{...him,expiryDate:1})!.availability,'EXPIRED');
});
test('Jobicy and Remotive normalize actual public fields and retain source links',()=>{
 const j=normalizeFeed(feed('jobicy'),{id:1,jobTitle:'API Developer',companyName:'Example',jobDescription:description,jobGeo:'India',url:'https://jobicy.com/jobs/1',jobType:['Full-Time'],jobLevel:'Any'})!;
 assert.equal(j.source,'jobicy');assert.equal(location(j).status,'COMPATIBLE');assert.ok(j.skills.includes('FastAPI'));
 const r=normalizeFeed(feed('remotive'),{id:2,title:'Backend Developer',company_name:'Example',description,candidate_required_location:'Worldwide',url:'https://remotive.com/remote-jobs/software-dev/backend-2'})!;assert.equal(r.job_url,r.apply_url);assert.equal(location(r).status,'COMPATIBLE');
 assert.equal(location(normalizeFeed(feed('remotive'),{id:3,title:'Backend Developer',company_name:'Example',description,candidate_required_location:'USA',url:'https://remotive.com/remote-jobs/3'})!).status,'INCOMPATIBLE');
});
test('company adapters preserve dates, lists and geographic uncertainty',()=>{
 const g=normalizeFeed(feed('greenhouse'),{id:4,title:'Software Engineer',content:'<p>'+description+'</p>',absolute_url:'https://boards.greenhouse.io/company/jobs/4',location:{name:'Bangalore, India'}})!;
 assert.equal(location(g).status,'REVIEW_REQUIRED');assert.equal(g.description,description);
 const l=normalizeFeed(feed('lever'),{id:'5',text:'SDE I',descriptionPlain:'Build services.',lists:[{text:'Requirements',content:'<li>Minimum 3 years of experience</li>'}],hostedUrl:'https://jobs.lever.co/company/5',applyUrl:'https://jobs.lever.co/company/5/apply',createdAt:1793000000000,categories:{location:'India',allLocations:['India']},workplaceType:'remote'})!;
 assert.equal(experience(l).classification,'NOT_ELIGIBLE');
 const a=normalizeFeed(feed('ashby'),{id:'6',title:'Backend Engineer',descriptionPlain:description,location:'Remote, Global',jobUrl:'https://jobs.ashbyhq.com/company/6',applyUrl:'https://jobs.ashbyhq.com/company/6/application',isListed:true,isRemote:true})!;
 assert.equal(location(a).status,'COMPATIBLE');assert.equal(normalizeFeed(feed('ashby'),{isListed:false}),null);
});
test('invalid contracts and unsafe links are rejected rather than invented',()=>{
 assert.throws(()=>normalizeFeed(feed('jobicy'),{id:1}));assert.throws(()=>normalizeFeed(feed('himalayas'),{...him,applicationLink:'javascript:alert(1)'}));
 assert.equal(geography('Remote',true).remote_type,'REMOTE');assert.equal(location({...normalizeFeed(feed('himalayas'),him)!,...geography('Remote USA global team',true)}).status,'INCOMPATIBLE');
});
test('matching recognizes role and technology variants and rewards verified overlap',()=>{
 assert.deepEqual(rolePatterns('Fullstack Developer'),['Full stack']);assert.ok(rolePatterns('Automation Engineer').includes('Automation'));
 assert.ok(skills('NextJS + React Native, webhook services, n8n').includes('Next.js'));
 const j=normalizeFeed(feed('himalayas'),him)!;
 const good=match(j,['Python','FastAPI'],undefined,'Backend Engineer')!,weak=match(j,['Swift'],undefined,'iOS Engineer')!;
 assert.ok(good.score>weak.score);assert.ok(good.shared_role_patterns.includes('Backend'));assert.equal(good.engine_version,'patterns-2');assert.ok(good.pattern_evidence.some(e=>e.field==='verified_skill'));
 assert.equal(match({...j,description:'Minimum 5 years of experience'},['Python','FastAPI']),null);
 assert.equal(match({...j,description:'Experience requirements not provided'},['Python','FastAPI']),null);
});
test('source paging keeps opaque cursors and Lever offsets; repeated cursors fail',async()=>{
 const original=globalThis.fetch;const urls:string[]=[];
 try{globalThis.fetch=async(input)=>{urls.push(String(input));return new Response(JSON.stringify({jobs:[],nextCursor:'same'}));};
 await assert.rejects(fetchFeed(feed('jobicy'),'same'),/REPEATED_CURSOR/);
 globalThis.fetch=async(input)=>{urls.push(String(input));return new Response(JSON.stringify(Array.from({length:100},()=>({id:'test'}))));};
 const result=await fetchFeed(feed('lever'),'100');assert.equal(result.next,'200');assert.ok(urls.at(-1)!.includes('skip=100'));
 }finally{globalThis.fetch=original;}
});
