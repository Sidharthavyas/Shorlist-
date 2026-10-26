import test from 'node:test';
import assert from 'node:assert/strict';
import { experience, location, canonicalUrl, match, DEFAULTS, skills } from '../apps/worker/src/domain';
import { normalize } from '../apps/worker/src/source';
import type { NormalizedJob } from '../contracts/domain';
export const job=(title='Software Engineer',description='0–2 years of experience'):NormalizedJob=>({external_id:'test',public_slug:'test',source:'freehire',company:'Example',title,description,requirements:[],preferred_qualifications:[],location:'Worldwide remote',remote_type:'WORLDWIDE_REMOTE',allowed_countries:null,job_url:'https://example.test/job',apply_url:'https://example.test/jobs/123',posted_at:new Date().toISOString(),first_seen_at:new Date().toISOString(),experience_min:null,experience_max:null,skills:['Python','FastAPI'],salary:null,employment_type:null,seniority:null,availability:'OPEN'});
for(const [title,description,expected] of [
  ['Software Engineer','0–2 years','ELIGIBLE'],['Backend Developer','1 year experience','ELIGIBLE'],['Java Developer','2 years preferred','ELIGIBLE'],
  ['Software Engineer','3+ years','NOT_ELIGIBLE'],['Senior Software Engineer','2 years','NOT_ELIGIBLE'],['Graduate Software Engineer','No prior professional experience required','ELIGIBLE'],
  ['AI Engineer','0–2 years','ELIGIBLE'],['iOS Developer','1–2 years','ELIGIBLE'],['Backend Developer','2+ years required','NOT_ELIGIBLE'],
  ['Junior Software Engineer','2+ years preferred','REVIEW_REQUIRED'],['Software Engineer','Work with senior engineers. 0-2 years experience.','ELIGIBLE'],
  ['Software Engineer','0-2 years experience. Minimum 3 years of professional development required.','NOT_ELIGIBLE'],
  ['Software Engineer','Our company has a 5 year history.','REVIEW_REQUIRED'],['Software Engineer','A four year degree required','REVIEW_REQUIRED'],
  ['Backend Engineer','18 months of experience','ELIGIBLE'],['Software Engineer','Minimum three years of experience','NOT_ELIGIBLE'],['Software Engineer','Build useful software.','REVIEW_REQUIRED']
  ,['Backend Engineer','At least 2 years of experience','NOT_ELIGIBLE'],['Software Engineer','2 or more years of experience','NOT_ELIGIBLE'],['Java Developer','You have 3 years working with Java','NOT_ELIGIBLE']
] as const) test(`${title}: ${description}`,()=>assert.equal(experience(job(title,description)).classification,expected));
test('location cannot infer worldwide from remote',()=>{const j=job();j.remote_type='REMOTE';assert.equal(location(j).status,'REVIEW_REQUIRED');});
test('US-only remote is incompatible',()=>{const j=job();j.allowed_countries=['us'];assert.equal(location(j).status,'INCOMPATIBLE');});
test('onsite disabled by default',()=>{const j=job();j.remote_type='ONSITE';assert.equal(location(j).status,'INCOMPATIBLE');});
test('score cannot bypass experience gate',()=>assert.equal(match(job('Software Engineer','5+ years'),['Python','FastAPI']),null));
test('aliases use word boundaries',()=>{assert.deepEqual(skills('Amazon Web Services, ReactJS, Retrieval Augmented Generation, Large Language Models'),['React','AWS','LLM','RAG']);assert.deepEqual(skills('JavaScript'),['JavaScript']);});
test('URL preserves requisition identity',()=>assert.equal(canonicalUrl('https://example.test/jobs?id=2&utm_source=x#top'),'https://example.test/jobs?id=2'));
test('normalizer validates live FreeHire wire shape',()=>{
 const j=normalize({public_slug:'junior-example',title:'Backend Developer',company:'Example',url:'https://example.test/jobs/1',work_mode:'remote',countries:['in'],description:'<p>0-2 years experience</p>',enrichment:{requirements:[{text:'Minimum 3 years of experience',priority:'required'}]}});
 assert.equal(j.remote_type,'INDIA_REMOTE');assert.equal(experience(j).classification,'NOT_ELIGIBLE');
});
test('settings cannot increase parser cap',()=>assert.equal(experience(job('Software Engineer','3 years'),10,DEFAULTS).classification,'NOT_ELIGIBLE'));
test('an empty company name does not block source ingestion',()=>{
 const j=normalize({public_slug:'missing-company',title:'Senior Full Stack Developer',company:'',url:'https://example.test/jobs/123',description:'5+ years of experience'});
 assert.equal(j.company,'Company not provided');assert.equal(experience(j).classification,'NOT_ELIGIBLE');
});
