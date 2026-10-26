import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { unzipSync, strFromU8 } from 'fflate';
import { tailor, renderPdf, renderDocx, type Profile } from '../apps/worker/src/resumes';
const profile:Profile={name:'Test Candidate',email:'candidate@example.test',skills:['React','Python'],education:['BSc Computer Science 2026'],experience:[],projects:['Built a React task tracker.','Built a Python API.'],verified_bullets:['Wrote 12 unit tests.']};
test('tailoring never adds absent job skills or invented facts',()=>{
 const content=tailor(profile,['Python','AWS','Kubernetes']);
 assert.equal(JSON.stringify(content).includes('Kubernetes'),false);assert.equal(JSON.stringify(content).includes('AWS'),false);
 assert.deepEqual(content.sections.find(s=>s.title==='Projects')?.lines,['Built a Python API.','Built a React task tracker.']);
 assert.deepEqual(profile.skills,['React','Python']);
});
test('unverified empty profile cannot generate a resume',()=>assert.throws(()=>tailor({...profile,name:''},[]),/PROFILE_INCOMPLETE/));
test('generated PDF supports long content and pagination',async()=>{
 const content=tailor({...profile,verified_bullets:Array(75).fill('Built a verified project feature with Python and wrote unit tests for the API.')},['Python']);
 const bytes=await renderPdf(content),doc=await PDFDocument.load(bytes);
 assert.ok(doc.getPageCount()>1);assert.equal(doc.getTitle(),'Test Candidate Resume');
});
test('DOCX has valid package structure and escapes facts',()=>{
 const content=tailor({...profile,name:'Test & Candidate'},[]),parts=unzipSync(renderDocx(content));
 assert.ok(parts['[Content_Types].xml']);assert.ok(parts['word/styles.xml']);
 const document=strFromU8(parts['word/document.xml']);assert.ok(document.includes('TEST &amp; CANDIDATE'));assert.ok(document.includes('w:style')===false);
 assert.ok(document.includes('w:w="12240" w:h="15840"'));assert.ok(strFromU8(parts['word/styles.xml']).includes('Carlito'));
});
test('reference template preserves complete entries, chronology and section order',async()=>{
 const experience=['Engineer 01/2025 – Present','Example Company · Mumbai','• Built a Python API.'];
 const projects=['First project 2026','• Built a React UI.','Tech: React','Second project 2026','• Built a Python service.','Tech: Python'];
 const content=tailor({...profile,headline:'Backend Engineer',location:'Mumbai, India',professional_summary:'Builds verified APIs.',experience,projects,skill_groups:['Languages: Python, TypeScript']},['Python']);
 assert.equal(content.subtitle,'Backend Engineer | Mumbai, India');
 assert.deepEqual(content.sections.map(s=>s.title),['Professional Summary','Experience','Projects','Selected Achievements','Technical Skills','Education']);
 assert.deepEqual(content.sections.find(s=>s.title==='Experience')?.lines,[experience.join('\n')]);
 assert.deepEqual(content.sections.find(s=>s.title==='Projects')?.lines,[projects.slice(3).join('\n'),projects.slice(0,3).join('\n')]);
 const pdf=await PDFDocument.load(await renderPdf(content));assert.deepEqual(pdf.getPage(0).getSize(),{width:612,height:792});assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getSubject(),'carlito-letter-v2');
});
