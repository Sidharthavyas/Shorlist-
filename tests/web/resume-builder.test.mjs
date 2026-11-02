import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
const window=new Window({url:'https://app.test/jobs/fixture'});
for(const name of ['window','document','HTMLElement','HTMLInputElement','Event','MouseEvent'])globalThis[name]=name==='window'?window:name==='document'?window.document:window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement:h,act}=await import('react'),{createRoot}=await import('react-dom/client');
const {ResumeBuilder}=await import('../../work/web-test/resume-builder.js');
test('AI preview requires consent, shows before/after and requires review before generating files',async()=>{
 const original=globalThis.fetch,calls=[];let generated=0,closed=0;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/status'))return Response.json({data:{enabled:true,provider:'gemini'}});if(url.endsWith('/resume-preview'))return Response.json({data:{id:'private-preview',origin:'ai',provider:'gemini',model:'fixture',warnings:[],changes:[{fact_id:'one',before:'Built Python APIs.',after:'Developed Python APIs.'}],content:{name:'Candidate',sections:[{title:'Professional Summary',lines:['Developed Python APIs.']}]}}});return Response.json({data:{message:'Files queued.'}});};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(h(ResumeBuilder,{jobId:'fixture',onClose:()=>closed++,onGenerated:()=>generated++,notice:()=>{}})));
  const button=()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Prepare preview');assert.equal(button().disabled,true);
  const consent=host.querySelector('input[type=checkbox]');await act(async()=>consent.click());assert.equal(button().disabled,false);await act(async()=>button().click());
  assert.ok(host.textContent.includes('Before:'));assert.ok(host.textContent.includes('After:'));assert.ok(host.querySelector('a[href="/api/v1/resume-previews/private-preview/pdf"]'));
  const generate=()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Generate PDF & DOCX');assert.equal(generate().disabled,true);await act(async()=>host.querySelector('input[type=checkbox]').click());assert.equal(generate().disabled,false);await act(async()=>generate().click());
  assert.deepEqual(JSON.parse(calls.find(c=>c.url.endsWith('/resume-preview')).options.body),{mode:'ai',ai_consent:true});assert.deepEqual(JSON.parse(calls.find(c=>c.url.endsWith('/resume-tasks')).options.body),{preview_id:'private-preview',reviewed:true});assert.equal(generated,1);assert.equal(closed,1);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=original;}
});
test('missing AI configuration keeps the factual mode available and sends no implicit consent',async()=>{
 const original=globalThis.fetch;let input;
 globalThis.fetch=async(url,options)=>url.endsWith('/status')?Response.json({data:{enabled:false,reason:'API_KEY_MISSING'}}):(input=JSON.parse(options.body),Response.json({error:{message:'Save your profile first.'}},{status:422}));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(h(ResumeBuilder,{jobId:'fixture',onClose:()=>{},onGenerated:()=>{},notice:()=>{}})));assert.equal(host.querySelector('option[value=ai]').disabled,true);assert.equal(host.querySelector('select').value,'factual');await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Prepare preview').click());assert.deepEqual(input,{mode:'factual',ai_consent:false});assert.ok(host.querySelector('[role=alert]').textContent.includes('Save your profile'));
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=original;}
});
