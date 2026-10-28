import type { Env } from './env';

export interface PrivateFiles {
  put(key:string,body:string|ArrayBuffer|ArrayBufferView,options?:{httpMetadata?:{contentType?:string}}):Promise<unknown>;
  get(key:string):Promise<{body:ReadableStream;httpMetadata?:{contentType?:string};text():Promise<string>;arrayBuffer():Promise<ArrayBuffer>}|null>;
  delete(key:string):Promise<unknown>;
}

export function storageEnv(env:Env):Env {
  if(!env.MONGO_STORAGE_URL)return env;
  const call=async(key:string,method:string,body?:BodyInit,type?:string)=>{
    const url=new URL(env.MONGO_STORAGE_URL!);url.searchParams.set('key',key);
    const response=await fetch(url,{method,headers:{'X-Storage-Token':env.MONGO_STORAGE_SECRET??'','Content-Type':type??'application/octet-stream'},body,redirect:'manual',signal:AbortSignal.timeout(25000)});
    if(method==='GET'&&response.status===404)return null;
    if(!response.ok)throw Error(`PRIVATE_STORAGE_${response.status}`);
    if(method!=='GET')await response.arrayBuffer();
    return response;
  };
  const FILES:PrivateFiles={
    async put(key,body,options){
      // Whole board responses can exceed Vercel's request limit. JSON snapshots
      // compress well; keep their encoding in object metadata, not HTTP encoding
      // headers, so neither hosting platform silently transforms the bytes.
      if(typeof body==='string'&&new TextEncoder().encode(body).byteLength>1024*1024){
        const stream=new Response(body).body!.pipeThrough(new CompressionStream('gzip'));
        return call(key,'PUT',await new Response(stream).arrayBuffer(),'application/vnd.shortlist.gzip+json');
      }
      return call(key,'PUT',body as BodyInit,options?.httpMetadata?.contentType);
    },
    delete:key=>call(key,'DELETE'),
    async get(key){
      let response=await call(key,'GET');if(!response)return null;
      if(response.headers.get('Content-Type')==='application/vnd.shortlist.gzip+json')response=new Response(response.body!.pipeThrough(new DecompressionStream('gzip')),{headers:{'Content-Type':'application/json'}});
      return {body:response.body!,httpMetadata:{contentType:response.headers.get('Content-Type')??undefined},text:()=>response.text(),arrayBuffer:()=>response.arrayBuffer()};
    }
  };
  return {...env,FILES};
}

