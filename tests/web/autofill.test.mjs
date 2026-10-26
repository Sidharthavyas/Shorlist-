import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
const window=new Window({url:'https://careers.example.test/application'});
globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
Object.defineProperty(window.HTMLElement.prototype,'getClientRects',{value(){return [{width:100,height:30}];},configurable:true});
await import('../../extensions/shortlist-autofill/engine.js');
const engine=globalThis.ShortlistAutofill;
const candidate={name:'Test Candidate',email:'candidate@example.test',phone:'+91 9000000000',location:'Mumbai, India',linkedin:'https://linkedin.com/in/candidate',github:'https://github.com/candidate',portfolio:'https://candidate.example.test',skills:['Python','FastAPI'],professional_summary:'Builds verified APIs.',education:['Example College — B.E. Computer Science Graduated 05/2026'],experience:['Engineer 01/2025 – Present','Example Company · Mumbai','• Built APIs.']};
const setForm=html=>{document.body.innerHTML=html;};
test('resume profile import uses supplied facts and allows explicit edits',()=>{
 const p=engine.profile({format:'shortlist-profile',version:1,profile:candidate});assert.equal(p.full_name,'Test Candidate');assert.equal(p.first_name,'Test');assert.equal(p.country,'India');assert.equal(p.current_company,'Example Company');assert.equal(p.graduation_year,'2026');assert.equal(p.school,'Example College');assert.equal(p.summary,candidate.professional_summary);assert.ok(!('salary' in p));assert.throws(()=>engine.profile({name:'Missing email'}));
 assert.equal(engine.profile({...p,first_name:'Preferred explicit name'}).first_name,'Preferred explicit name');
});
test('preview changes nothing and selected fill preserves existing answers and screening fields',()=>{
 setForm(`<form id="application"><label>First name<input name="firstName"></label><label>Last name<input name="lastName"></label><label>Email<input name="email" value="existing@example.test"></label><label>Country<select name="country"><option value="">Choose country</option><option value="IN">India</option><option value="US">United States</option></select></label><label>LinkedIn profile<input name="linkedin"></label><label>Salary expectation<input name="salary"></label><label>Gender<input name="gender"></label><label>Sponsorship required<input name="sponsor"></label><label>Desired job title<input name="jobTitle"></label><label>Phone extension<input name="extension"></label><input type="password" autocomplete="current-password"><label><input type="checkbox" name="consent">Agree</label><button type="submit">Submit</button></form>`);
 let submitted=false;document.querySelector('form').addEventListener('submit',e=>{submitted=true;e.preventDefault();});
 const preview=engine.preview(candidate);assert.equal(document.querySelector('[name=firstName]').value,'');assert.equal(preview.occupied,1);assert.ok(!preview.fields.some(f=>['salary','gender','sponsor','jobTitle','extension','consent'].some(v=>f.label.toLowerCase().includes(v))));
 const keys=preview.fields.filter(f=>['first_name','country','linkedin'].includes(f.key));let changed=0;document.querySelector('[name=firstName]').addEventListener('input',()=>changed++);
 const result=engine.fill(keys.map(f=>f.token));assert.equal(result.filled.length,3);assert.equal(document.querySelector('[name=firstName]').value,'Test');assert.equal(document.querySelector('[name=lastName]').value,'');assert.equal(document.querySelector('[name=country]').value,'IN');assert.equal(document.querySelector('[name=email]').value,'existing@example.test');assert.equal(changed,1);assert.equal(submitted,false);
});
test('user changes after preview and after fill are never overwritten by fill or undo',()=>{
 setForm('<label>First name<input name="first_name"></label><label>Last name<input name="last_name"></label>');let preview=engine.preview(candidate);document.querySelector('[name=first_name]').value='Typed by user';engine.fill(preview.fields.map(f=>f.token));assert.equal(document.querySelector('[name=first_name]').value,'Typed by user');assert.equal(document.querySelector('[name=last_name]').value,'Candidate');
 document.querySelector('[name=last_name]').value='Edited afterward';assert.equal(engine.undoLast(),0);assert.equal(document.querySelector('[name=last_name]').value,'Edited afterward');
 setForm('<label>Full name<input name="name"></label>');preview=engine.preview(candidate);engine.fill(preview.fields.map(f=>f.token));assert.equal(document.querySelector('input').value,'Test Candidate');assert.equal(engine.undoLast(),1);assert.equal(document.querySelector('input').value,'');
});
test('disabled, hidden, read-only, newsletter and non-matching selects are skipped',()=>{
 setForm('<label>Email<input name="email" disabled></label><label>First name<input name="first_name" readonly></label><label>Full name<input name="name" style="display:none"></label><form id="newsletter"><label>Email<input name="email"></label></form><label>Country<select name="country"><option value="">Select country</option><option value="AUS">Australia</option></select></label>');
 assert.equal(engine.preview(candidate).fields.length,0);
});
test('resume attachment requires inclusion, matches CV fields and respects accepted types',()=>{
 setForm('<label for="cv">Resume / CV</label><input type="file" name="resume" id="cv" hidden accept=".pdf"><label>Cover letter<input type="file" name="cover_letter" accept=".pdf"></label>');const file={name:'resume.pdf',type:'application/pdf',base64:btoa('%PDF-1.7 test')};
 assert.equal(engine.preview(candidate).fields.length,0);let preview=engine.preview(candidate,file);assert.equal(preview.fields.length,1);assert.equal(preview.fields[0].key,'resume');const result=engine.fill(preview.fields.map(f=>f.token));assert.equal(result.errors.length,0);assert.equal(document.getElementById('cv').files[0].name,'resume.pdf');assert.equal(engine.undoLast(),1);assert.equal(document.getElementById('cv').files.length,0);
 document.getElementById('cv').accept='.docx';preview=engine.preview(candidate,file);assert.equal(engine.fill(preview.fields.map(f=>f.token)).errors.length,1);
});
test('open shadow roots and same-origin frame fields can be previewed',()=>{
 setForm('<div id="shadow"></div><iframe></iframe>');const root=document.getElementById('shadow').attachShadow({mode:'open'});root.innerHTML='<label>GitHub<input name="github"></label>';
 const frame=document.querySelector('iframe');frame.srcdoc='<label>First name<input name="first_name"></label>';assert.ok(frame.contentDocument);const input=frame.contentDocument.querySelector('input');Object.defineProperty(input,'getClientRects',{value:()=>[{width:100,height:30}]});
 const preview=engine.preview(candidate);assert.ok(preview.fields.some(f=>f.key==='github'));assert.ok(preview.fields.some(f=>f.key==='first_name'));engine.fill(preview.fields.map(f=>f.token));assert.equal(root.querySelector('input').value,candidate.github);assert.equal(input.value,'Test');
});
test('native setter and input events update a React-controlled field',async()=>{
 globalThis.HTMLElement=window.HTMLElement;globalThis.HTMLInputElement=window.HTMLInputElement;globalThis.Event=window.Event;
 const {createElement:h,useState,act}=await import('react'),{createRoot}=await import('react-dom/client');setForm('<div id="react"></div>');const root=createRoot(document.getElementById('react'));
 function Controlled(){const [name,setName]=useState('');return h('label',null,'First name',h('input',{name:'first_name',value:name,onChange:e=>setName(e.target.value)}),h('span',{id:'react-value'},name));}
 try{await act(async()=>root.render(h(Controlled)));const preview=engine.preview(candidate);await act(async()=>engine.fill(preview.fields.map(f=>f.token)));assert.equal(document.getElementById('react-value').textContent,'Test');}finally{await act(async()=>root.unmount());}
});
test('extension requests only user-invoked tab access and local storage',()=>{
 const manifest=JSON.parse(readFileSync('extensions/shortlist-autofill/manifest.json','utf8'));assert.equal(manifest.manifest_version,3);assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);assert.equal(manifest.host_permissions,undefined);assert.equal(manifest.content_scripts,undefined);assert.equal(manifest.externally_connectable,undefined);
 for(const file of ['popup.html','popup.js','popup.css','engine.js'])assert.ok(readFileSync('extensions/shortlist-autofill/'+file).length);
});

test('camel-case GitHub labels match, while mobile-experience essay questions stay untouched',()=>{
 setForm('<label>GitHub profile<input name="GitHubUrl"></label><label>Describe your mobile application experience<textarea name="question"></textarea></label>');
 const preview=engine.preview(candidate);assert.deepEqual(preview.fields.map(f=>f.key),['github']);engine.fill(preview.fields.map(f=>f.token));assert.equal(document.querySelector('input').value,candidate.github);assert.equal(document.querySelector('textarea').value,'');
});

