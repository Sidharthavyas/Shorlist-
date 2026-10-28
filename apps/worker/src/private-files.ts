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
    return response;
  };
  const FILES:PrivateFiles={
    put:(key,body,options)=>call(key,'PUT',body as BodyInit,options?.httpMetadata?.contentType),
    delete:key=>call(key,'DELETE'),
    async get(key){const response=await call(key,'GET');return response?{body:response.body!,httpMetadata:{contentType:response.headers.get('Content-Type')??undefined},text:()=>response.text(),arrayBuffer:()=>response.arrayBuffer()}:null;}
  };
  return {...env,FILES};
}

