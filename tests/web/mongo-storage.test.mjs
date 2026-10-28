import test from 'node:test';
import assert from 'node:assert/strict';
import {storageRequest} from '../../server/mongo-storage.mjs';
import proxy from '../../api/backend.mjs';

test('MongoDB file storage authenticates before connecting and validates keys',async()=>{
 process.env.MONGO_STORAGE_SECRET='test-storage-secret-'.repeat(3);
 const noConnection=()=>{throw Error('Must not connect');};
 assert.equal((await storageRequest(new Request('https://app.test/api/storage?key=resumes/test.pdf'),noConnection)).status,401);
 assert.equal((await storageRequest(new Request('https://app.test/api/storage?key=other/private',{headers:{'X-Storage-Token':process.env.MONGO_STORAGE_SECRET}}),noConnection)).status,400);
 assert.equal((await storageRequest(new Request('https://app.test/api/storage?key=resumes/../secret',{headers:{'X-Storage-Token':process.env.MONGO_STORAGE_SECRET}}),noConnection)).status,400);
});
test('MongoDB private files round-trip binary data, overwrite safely and delete',async()=>{
 process.env.MONGO_STORAGE_SECRET='test-storage-secret-'.repeat(3);
 const stored=new Map();
 const collection={updateOne:async(filter,update)=>stored.set(filter._id,update.$set),findOne:async filter=>stored.get(filter._id),deleteOne:async filter=>stored.delete(filter._id)};
 const call=(method,body)=>storageRequest(new Request('https://app.test/api/storage?key=profile/owner/master-resume.pdf',{method,headers:{'X-Storage-Token':process.env.MONGO_STORAGE_SECRET,'Content-Type':'application/pdf'},body}),async()=>collection);
 const bytes=new Uint8Array([37,80,68,70,0,255]);
 assert.equal((await call('PUT',bytes)).status,200);
 const read=await call('GET');assert.equal(read.status,200);assert.equal(read.headers.get('Content-Type'),'application/pdf');assert.equal(read.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(new Uint8Array(await read.arrayBuffer()),bytes);
 await call('PUT',new Uint8Array([1,2]));assert.equal(stored.size,1);
 await call('DELETE');assert.equal((await call('GET')).status,404);
 assert.equal((await call('PUT',new Uint8Array(4*1024*1024+1))).status,413);
});
test('private storage failures never disclose connection details',async()=>{
 const response=await storageRequest(new Request('https://app.test/api/storage?key=jobs/test.json',{headers:{'X-Storage-Token':process.env.MONGO_STORAGE_SECRET}}),()=>{throw Error('mongodb://secret-password');});
 assert.equal(response.status,503);assert.ok(!(await response.text()).includes('secret-password'));
});
test('Vercel proxy preserves raw uploads, cookies and redirects while stripping spoofed identity',async()=>{
 process.env.SHORTLIST_BACKEND_URL='https://worker.example.test';process.env.DEPLOYMENT_PROXY_SECRET='server-only-proxy-secret';
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,options)=>{
   assert.equal(String(url),'https://worker.example.test/api/v1/profile/uploads?x=1');
   assert.equal(options.headers.get('X-Shortlist-Proxy-Token'),'server-only-proxy-secret');assert.equal(options.headers.get('Accept-Encoding'),'identity');assert.equal(options.headers.get('Cf-Access-Jwt-Assertion'),null);assert.equal(options.headers.get('Cookie'),'session=private');
   assert.deepEqual(new Uint8Array(options.body),new Uint8Array([0,255,1]));assert.equal(options.redirect,'manual');
   return new Response(null,{status:303,headers:{Location:'/','Set-Cookie':'test=owner; HttpOnly; Secure','Cache-Control':'public'}});
  };
  const result=await proxy.fetch(new Request('https://app.test/api/v1/profile/uploads?x=1',{method:'POST',headers:{Cookie:'session=private','Cf-Access-Jwt-Assertion':'spoofed','X-Shortlist-Proxy-Token':'attacker'},body:new Uint8Array([0,255,1])}));
  assert.equal(result.status,303);assert.equal(result.headers.get('Location'),'/');assert.match(result.headers.get('Set-Cookie'),/HttpOnly/);assert.equal(result.headers.get('Cache-Control'),'private, no-store');
 }finally{globalThis.fetch=original;delete process.env.SHORTLIST_BACKEND_URL;delete process.env.DEPLOYMENT_PROXY_SECRET;}
});
