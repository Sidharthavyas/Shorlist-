import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
const window=new Window({url:'http://127.0.0.1:5173/review'});
for(const key of ['window','document','HTMLElement','HTMLInputElement','Event','MouseEvent'])globalThis[key]=key==='window'?window:key==='document'?window.document:window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement:h,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const {useData}=await import('../../work/web-test/use-data.js');
const {SourceSyncButton}=await import('../../work/web-test/setup-controls.js');
function review({path}){const resource=useData(path);return h('section',null,h('input',{'aria-label':'Filter',defaultValue:'backend'}),resource.loading?h('p',{id:'loading'},'Loading'):h('div',{id:'results'},...(resource.data?.rows??[]).map(row=>h('button',{key:row.id,id:'job-'+row.id},row.title))),h('span',{id:'error'},resource.error||resource.refreshError));}
test('background review updates preserve cards, focus and scroll, including fetch errors',async()=>{
 const calls=[],original=globalThis.fetch;globalThis.fetch=(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),data={rows:[{id:1,title:'Backend Engineer'}]};
 try{
  await act(async()=>root.render(h(review,{path:'/jobs?view=review'})));assert.ok(document.getElementById('loading'));
  await act(async()=>calls[0].resolve({ok:true,json:async()=>data}));const card=document.getElementById('job-1'),grid=document.getElementById('results');card.focus();grid.scrollTop=220;
  await act(async()=>window.dispatchEvent(new Event('refresh-data')));assert.equal(document.getElementById('job-1'),card);assert.equal(document.activeElement,card);assert.equal(grid.scrollTop,220);assert.equal(document.getElementById('loading'),null);
  await act(async()=>calls[1].resolve({ok:true,json:async()=>data}));assert.equal(document.getElementById('job-1'),card);
  await act(async()=>window.dispatchEvent(new Event('refresh-data')));await act(async()=>calls[2].reject(Error('Temporary network error')));
  assert.equal(document.getElementById('job-1'),card);assert.equal(document.activeElement,card);assert.ok(document.getElementById('error').textContent.includes('Temporary'));
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=original;}
});
test('filter changes abort stale requests and ignore late responses',async()=>{
 const calls=[],original=globalThis.fetch;globalThis.fetch=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}));const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(h(review,{path:'/jobs?view=review'})));await act(async()=>root.render(h(review,{path:'/jobs?view=review&q=python'})));assert.equal(calls[0].options.signal.aborted,true);
 await act(async()=>calls[1].resolve({ok:true,json:async()=>({rows:[{id:2,title:'Python Engineer'}]})}));await act(async()=>calls[0].resolve({ok:true,json:async()=>({rows:[{id:1,title:'Old response'}]})}));assert.equal(document.getElementById('job-1'),null);assert.ok(document.getElementById('job-2'));
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=original;}
});
test('sync progress polling refreshes the workspace only once on completion',async()=>{
 const originalFetch=globalThis.fetch,originalTimeout=globalThis.setTimeout;let polls=0,refreshes=0;const notices=[];
 globalThis.setTimeout=(fn,delay,...args)=>originalTimeout(fn,delay===10000?0:delay,...args);
 globalThis.fetch=async(_url,options)=>({ok:true,json:async()=>options?.method==='POST'?{data:{state:'QUEUED',sources:['freehire']}}:{data:[{id:'freehire',source_id:'freehire',enabled:1,config_json:'{}',last_completed_at:++polls>3?'2026-10-26T12:00:00Z':null,lease_token:polls>1&&polls<4?'running':null}]}});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(h(SourceSyncButton,{notice:message=>notices.push(message),refresh:()=>refreshes++})));await act(async()=>{host.querySelector('button').click();await new Promise(resolve=>originalTimeout(resolve,80));});assert.ok(polls>=4);assert.equal(refreshes,1);assert.equal(notices.length,1);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimeout;}
});
