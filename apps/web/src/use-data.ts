import { useEffect, useState } from 'react';

export async function api<T=any>(path:string,init?:RequestInit):Promise<T>{
 const response=await fetch(`/api/v1${path}`,{...init,headers:{...(init?.body instanceof FormData?{}:{'Content-Type':'application/json'}),...init?.headers}});
 if(!response.ok){let message='The request failed.';try{const body=await response.json() as any;if(body.error?.code==='AUTH_REQUIRED')window.location.assign('/api/auth/login');message=body.error?.message??message;if(body.error?.details?.length)message=body.error.details.map((issue:any)=>`${issue.path?.join('.')||'Input'}: ${issue.message}`).join('; ');}catch{}throw Error(message);}
 return response.json();
}
export function useData<T=any>(path:string){
 const [state,setState]=useState<{path:string;data:T|null;error:string;refreshError:string;refreshing:boolean}>({path,data:null,error:'',refreshError:'',refreshing:false});
 const [version,setVersion]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  setState(old=>old.path===path?{...old,error:'',refreshError:'',refreshing:old.data!==null}:{path,data:null,error:'',refreshError:'',refreshing:false});
  api<T>(path,{signal:controller.signal}).then(data=>{if(active)setState(old=>({path,data:old.path===path&&JSON.stringify(old.data)===JSON.stringify(data)?old.data:data,error:'',refreshError:'',refreshing:false}));}).catch(error=>{
   if(active)setState(old=>old.path===path&&old.data!==null?{...old,refreshError:error.message,refreshing:false}:{path,data:null,error:error.message,refreshError:'',refreshing:false});
  });
  return()=>{active=false;controller.abort();};
 },[path,version]);
 useEffect(()=>{const changed=()=>setVersion(x=>x+1);window.addEventListener('refresh-data',changed);return()=>window.removeEventListener('refresh-data',changed);},[]);
 const current=state.path===path;
 return {data:current?state.data:null,error:current?state.error:'',loading:!current||(!state.data&&!state.error),refreshing:current&&state.refreshing,refreshError:current?state.refreshError:'',reload:()=>setVersion(x=>x+1)};
}
