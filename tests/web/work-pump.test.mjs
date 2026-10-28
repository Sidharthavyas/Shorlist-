import test from 'node:test';
import assert from 'node:assert/strict';
import {pumpWork} from '../../server/work-pump.mjs';
import proxy from '../../api/backend.mjs';

test('background pump is bounded and stops when another worker owns the lease',async()=>{
 let calls=0;
 await pumpWork('https://worker.test','server-secret',{maxTasks:3,fetcher:async(url,options)=>{
  calls++;assert.equal(String(url),'https://worker.test/api/internal/drain');assert.equal(options.headers['X-Shortlist-Proxy-Token'],'server-secret');
  return Response.json({state:calls===2?'BUSY':'PROCESSED'});
 }});assert.equal(calls,2);
 calls=0;await pumpWork('https://worker.test','server-secret',{maxTasks:3,fetcher:async()=>{calls++;return Response.json({state:'PROCESSED'});}});assert.equal(calls,3);
});
test('public proxy never exposes the internal drain endpoint',async()=>{
 process.env.SHORTLIST_BACKEND_URL='https://worker.test';process.env.DEPLOYMENT_PROXY_SECRET='server-secret';
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('Internal route must not be forwarded');};
 try{assert.equal((await proxy.fetch(new Request('https://app.test/api/internal/drain',{method:'POST'}))).status,404);}
 finally{globalThis.fetch=original;delete process.env.SHORTLIST_BACKEND_URL;delete process.env.DEPLOYMENT_PROXY_SECRET;}
});

test('successful authenticated API responses wake work without blocking the response',async()=>{
 process.env.SHORTLIST_BACKEND_URL='https://worker.test';process.env.DEPLOYMENT_PROXY_SECRET='server-secret';
 const original=globalThis.fetch;let background,drains=0;
 globalThis.fetch=async url=>{
  if(new URL(String(url)).pathname==='/api/internal/drain'){drains++;return Response.json({state:'IDLE'});}
  return Response.json({data:{status:'ok'}});
 };
 try{
  const response=await proxy.fetch(new Request('https://app.test/api/v1/summary',{headers:{Cookie:'owner=session'}}),{waitUntil:promise=>{background=promise;}});
  assert.equal(response.status,200);assert.ok(background);await background;assert.equal(drains,1);
 }finally{globalThis.fetch=original;delete process.env.SHORTLIST_BACKEND_URL;delete process.env.DEPLOYMENT_PROXY_SECRET;}
});

test('file responses finish before background work and do not start a work pump',async()=>{
 process.env.SHORTLIST_BACKEND_URL='https://worker.test';process.env.DEPLOYMENT_PROXY_SECRET='server-secret';
 const original=globalThis.fetch;let scheduled=false;
 globalThis.fetch=async()=>new Response(new Uint8Array([37,80,68,70]),{headers:{'Content-Type':'application/pdf','Content-Encoding':'gzip','Content-Length':'999'}});
 try{
  const response=await proxy.fetch(new Request('https://app.test/api/v1/resume-versions/fixture/files/pdf',{headers:{Cookie:'owner=session'}}),{waitUntil:()=>{scheduled=true;}});
  assert.equal(scheduled,false);assert.equal(response.headers.get('Content-Encoding'),null);assert.equal(response.headers.get('Content-Length'),'4');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([37,80,68,70]));
 }finally{globalThis.fetch=original;delete process.env.SHORTLIST_BACKEND_URL;delete process.env.DEPLOYMENT_PROXY_SECRET;}
});
