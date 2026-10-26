import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeDraft, mergeResumeDraft } from '../apps/worker/src/profile-import';
import { spatialResumeText } from '../apps/worker/src/resume-extract';
import { tailor } from '../apps/worker/src/resumes';
test('resume import extracts contact and preserves original factual section lines',()=>{
 const draft=resumeDraft('Test Candidate\ncandidate@example.test\nhttps://github.com/candidate\nEDUCATION\nBSc Computer Science 2026\nPROJECTS\nBuilt a Python API for a course project.\nTECHNICAL SKILLS\nPython, FastAPI, PostgreSQL\nEXPERIENCE\nIntern at Example Org\nACHIEVEMENTS\nWrote 12 unit tests.');
 assert.equal(draft.name,'Test Candidate');assert.equal(draft.email,'candidate@example.test');assert.deepEqual(draft.projects,['Built a Python API for a course project.']);assert.deepEqual(draft.experience,['Intern at Example Org']);assert.ok(draft.skills.includes('Python'));assert.ok(!draft.skills.includes('AWS'));
});
test('resume import never overwrites verified saved fields',()=>{
 const current={name:'Verified Name',email:'verified@example.test',skills:['Swift'],projects:['Existing verified project.'],revision:4};
 const result=mergeResumeDraft(current,resumeDraft('Other Name\nother@example.test\nPROJECTS\nNew project\nSKILLS\nPython'));
 assert.equal(result.name,current.name);assert.equal(result.email,current.email);assert.deepEqual(result.skills,current.skills);assert.deepEqual(result.projects,current.projects);assert.equal(result.revision,4);
});
test('default placeholder email can be replaced with extracted email',()=>{
 const draft=resumeDraft('Test Candidate\nreal@example.test');assert.equal(mergeResumeDraft({email:'owner@example.test'},draft).email,'real@example.test');
});
test('missing sections remain empty rather than fabricated',()=>{
 const draft=resumeDraft('Test Candidate\nreal@example.test\nSUMMARY\nLooking for an entry-level role.');assert.deepEqual(draft.projects,[]);assert.deepEqual(draft.experience,[]);assert.deepEqual(draft.verified_bullets,[]);
});
test('formatted reference import keeps summary, categories, bullets and whole project groups',()=>{
 const draft=resumeDraft('**Test Candidate**\n**Backend Engineer | Mumbai, India**\ncandidate@example.test | example.dev\n**PROFESSIONAL SUMMARY**\nBuilds transaction-\nsafe APIs.\n**PROJECTS**\n**API project 09/2026**\n• Built a **Python** service with\nverified tests.\n**Tech:** Python\n**Other project 2025**\n• Built a React UI.\n**TECHNICAL SKILLS**\n**Languages:** Python, TypeScript');
 assert.equal(draft.headline,'Backend Engineer');assert.equal(draft.location,'Mumbai, India');assert.equal(draft.portfolio,'https://example.dev');assert.equal(draft.professional_summary,'Builds transaction-safe APIs.');
 assert.equal(draft.projects[1],'• Built a **Python** service with verified tests.');assert.equal(draft.skill_groups.length,1);
 assert.equal(tailor(draft,['Python']).sections.find(s=>s.title==='Projects')?.lines.length,2);
});
test('PDF text follows visual rows even when bullets and dates are painted later',()=>{
 const item=(str:string,x:number,y:number,fontName='body',height=9.8)=>({str,transform:[height,0,0,height,x,y],width:str.length*4,height,fontName});
 const result=spatialResumeText([item('Candidate',200,750,'bold',19),item('Built an API with Python and tests.',45,650),item('Role',32,700,'bold'),item('2026',540,700,'bold'),item('•',38,650)]);
 assert.equal(result.plain,'Candidate\nRole 2026\n• Built an API with Python and tests.');assert.ok(result.formatted.includes('**Role** **2026**'));
});
