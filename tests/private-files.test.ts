import test from 'node:test';
import assert from 'node:assert/strict';
import {storageEnv} from '../apps/worker/src/private-files';
import type {Env} from '../apps/worker/src/env';

test('large board JSON is compressed below the upload limit and read back intact',async()=>{
 const original=globalThis.fetch;const stored=new Map<string,{bytes:ArrayBuffer,type:string}>();
 let consumed=0;
 try{
  globalThis.fetch=async(input,options)=>{
   const key=new URL(String(input)).searchParams.get('key')!;
   const headers=new Headers(options?.headers);
   assert.equal(headers.get('X-Storage-Token'),'test-secret');
   if(options?.method==='PUT'){
    const bytes=await new Response(options.body).arrayBuffer();stored.set(key,{bytes,type:headers.get('Content-Type')!});
   }else if(options?.method==='GET'){
    const object=stored.get(key);return object?new Response(object.bytes,{headers:{'Content-Type':object.type}}):new Response(null,{status:404});
   }else stored.delete(key);
   const response=new Response('{"ok":true}');const read=response.arrayBuffer.bind(response);response.arrayBuffer=()=>{consumed++;return read();};return response;
  };
  const env=storageEnv({MONGO_STORAGE_URL:'https://storage.example.test/api/storage',MONGO_STORAGE_SECRET:'test-secret'} as Env);
  const large=JSON.stringify({jobs:Array.from({length:500},(_,i)=>({id:i,description:'Verified job description. '.repeat(400)}))});
  assert.ok(large.length>4*1024*1024);
  await env.FILES.put('jobs/large-page.json',large);
  const compressed=stored.get('jobs/large-page.json')!;assert.ok(compressed.bytes.byteLength<4*1024*1024);assert.equal(compressed.type,'application/vnd.shortlist.gzip+json');
  const read=await env.FILES.get('jobs/large-page.json');assert.equal(await read!.text(),large);assert.equal(read!.httpMetadata?.contentType,'application/json');
  await env.FILES.put('profile/original.pdf',new Uint8Array([37,80,68,70]),{httpMetadata:{contentType:'application/pdf'}});
  const pdf=await env.FILES.get('profile/original.pdf');assert.equal(pdf!.httpMetadata?.contentType,'application/pdf');assert.deepEqual(new Uint8Array(await pdf!.arrayBuffer()),new Uint8Array([37,80,68,70]));
  await env.FILES.delete('jobs/large-page.json');assert.equal(await env.FILES.get('jobs/large-page.json'),null);assert.equal(consumed,3);
 }finally{globalThis.fetch=original;}
});
