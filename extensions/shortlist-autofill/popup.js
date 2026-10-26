import './engine.js';
const engine=globalThis.ShortlistAutofill,$=id=>document.getElementById(id);
let saved=null,resume=null,previewTab=null;
function dashboardOrigin(value){const url=new URL(value);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('Use HTTPS, or your local Shortlist address.');if(url.username||url.password)throw Error('Use a dashboard URL without embedded credentials.');return url.origin;}
function status(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
function resetPreview(){previewTab=null;$('preview-fields').replaceChildren();$('fill').disabled=true;}
function renderProfile(){
 $('profile-name').textContent=saved?`${saved.full_name} · ${saved.email}`:'No profile imported';
 $('profile-fields').replaceChildren();
 for(const [key,label] of Object.entries(engine.fields)){const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement(['summary','skills'].includes(key)?'textarea':'input');input.name=key;input.value=saved?.[key]??'';wrapper.append(input);$('profile-fields').append(wrapper);}
 $('resume-name').textContent=resume?.name??'No resume selected';
}
async function activeTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!/^https?:\/\//.test(tab.url??''))throw Error('Open a job application or your Shortlist dashboard in a normal browser tab.');return tab;}
async function command(tabId,method,args=[]){
 await chrome.scripting.executeScript({target:{tabId},files:['engine.js']});
 const results=await chrome.scripting.executeScript({target:{tabId},func:(method,args)=>{try{return {data:globalThis.ShortlistAutofill[method](...args)};}catch(error){return {error:error.message};}},args:[method,args]});
 const result=results[0]?.result;if(!result||result.error)throw Error(result?.error??'Unable to access this page.');return result.data;
}
async function saveProfile(value){saved=engine.profile(value);await chrome.storage.local.set({profile:saved});resetPreview();renderProfile();status('Profile saved. Open an application and preview matching fields.');}
async function run(action){try{await action();}catch(error){status(error.message,true);}}
$('import-tab').addEventListener('click',()=>run(async()=>{
 const tab=await activeTab(),origin=dashboardOrigin($('dashboard-url').value);
 if(new URL(tab.url).origin!==origin)throw Error('Open your Shortlist dashboard tab, then click Import from dashboard tab.');
 const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:async(expected)=>{if(location.origin!==expected)return {error:'Dashboard tab changed.'};try{const r=await fetch('/api/v1/profile',{credentials:'same-origin'});if(!r.ok)return {error:'Sign in to Shortlist and save your verified profile first.'};return await r.json();}catch{return {error:'Unable to read the Shortlist profile.'};}},args:[origin]});
 const data=result[0]?.result;if(data?.error)throw Error(data.error);await saveProfile(data?.data);
}));
$('import-file').addEventListener('change',()=>run(async()=>{const file=$('import-file').files[0];if(!file)return;if(file.size>256*1024)throw Error('Profile JSON must be under 256 KB.');const data=JSON.parse(await file.text());if(data.format&&data.format!=='shortlist-profile')throw Error('Choose the exported Shortlist profile JSON.');await saveProfile(data);}));
$('save-origin').addEventListener('click',()=>run(async()=>{const origin=dashboardOrigin($('dashboard-url').value);$('dashboard-url').value=origin;await chrome.storage.local.set({dashboardOrigin:origin});status('Dashboard address saved.');}));
$('profile-form').addEventListener('submit',event=>{event.preventDefault();run(()=>saveProfile(Object.fromEntries(new FormData(event.target))));});
$('resume-file').addEventListener('change',()=>run(async()=>{
 const file=$('resume-file').files[0];if(!file)return;if(file.size>4*1024*1024||!file.size)throw Error('Choose a nonempty PDF or DOCX under 4 MB.');
 const bytes=new Uint8Array(await file.arrayBuffer()),pdf=new TextDecoder().decode(bytes.slice(0,5))==='%PDF-',docx=bytes[0]===0x50&&bytes[1]===0x4b&&/\.docx$/i.test(file.name);
 if(!pdf&&!docx)throw Error('Choose a PDF or DOCX resume.');
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 resume={name:file.name,type:pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',base64:btoa(binary)};await chrome.storage.local.set({resume});resetPreview();renderProfile();status('Resume saved in this browser. Include it in the preview when ready.');
}));
$('attach').addEventListener('change',resetPreview);
$('preview').addEventListener('click',()=>run(async()=>{
 if(!saved)throw Error('Import your profile first.');if($('attach').checked&&!resume)throw Error('Choose a resume first.');
 const tab=await activeTab(),result=await command(tab.id,'preview',[saved,$('attach').checked?resume:null]);previewTab=tab.id;$('preview-fields').replaceChildren();
 for(const field of result.fields){const label=document.createElement('label');label.className='check suggestion';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=true;checkbox.value=field.token;const body=document.createElement('div');body.textContent=field.label;const value=document.createElement('span');value.textContent=field.value.length>160?field.value.slice(0,160)+'…':field.value;body.append(value);label.append(checkbox,body);$('preview-fields').append(label);}
 $('fill').disabled=!result.fields.length;$('preview-info').textContent=`${result.fields.length} matching fields · ${result.occupied} existing answers preserved.`;status(result.fields.length?'Uncheck anything you do not want filled, then choose Fill selected fields.':'No supported empty fields found. Open the application form or its next step.');
}));
$('fill').addEventListener('click',()=>run(async()=>{
 const tab=await activeTab();if(tab.id!==previewTab)throw Error('The active tab changed. Preview the application again.');
 const tokens=Array.from($('preview-fields').querySelectorAll('input:checked')).map(input=>input.value),result=await command(tab.id,'fill',[tokens]);resetPreview();status(`${result.filled.length} fields filled. ${result.errors.length?'Some fields need manual entry. ':''}Review the form before submitting.`);
}));
$('undo').addEventListener('click',()=>run(async()=>{const tab=await activeTab(),count=await command(tab.id,'undoLast');resetPreview();status(`${count} fields restored. Answers edited since filling were preserved.`);}));
$('clear').addEventListener('click',()=>run(async()=>{await chrome.storage.local.remove(['profile','resume']);saved=null;resume=null;$('attach').checked=false;resetPreview();renderProfile();status('Saved profile and resume removed from this browser.');}));
await run(async()=>{await chrome.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});const stored=await chrome.storage.local.get(['profile','resume','dashboardOrigin']);saved=stored.profile?engine.profile(stored.profile):null;resume=stored.resume??null;if(stored.dashboardOrigin)$('dashboard-url').value=stored.dashboardOrigin;renderProfile();status(saved?'Open a job application and preview matching fields.':'Import your saved Shortlist profile to get started.');});
