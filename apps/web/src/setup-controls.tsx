import { useEffect, useRef, useState } from 'react';
import { FileText, LoaderCircle, RefreshCw } from 'lucide-react';
export function SourceSyncButton({notice,refresh}:{notice:(message:string,error?:boolean)=>void;refresh:()=>void}) {
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState('');const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function run(){
  setBusy(true);setProgress('Starting…');
  try{
   const previous=await fetch('/api/v1/sources');
   if(!previous.ok)throw Error('Unable to read source status.');
   const baseline=((await previous.json()) as any).data;
   const dueCandidates=baseline.filter((s:any)=>s.enabled&&(s.cursor||!s.last_completed_at||Date.parse(s.last_completed_at)+(JSON.parse(s.config_json??'{}').interval??15)*60000<=Date.now())&&(!s.next_retry_at||Date.parse(s.next_retry_at)<=Date.now()));
   const response=await fetch('/api/v1/sources/sync',{method:'POST'});
   const result=await response.json() as any;if(!response.ok)throw new Error(result.error?.message ?? 'Unable to start job sync.');
   const queued=new Set(result.data?.sources??[]),due=dueCandidates.filter((s:any)=>queued.has(s.id));
   for(let attempt=0;attempt<20;attempt++){
    await new Promise(resolve=>setTimeout(resolve,10000));
    if(!mounted.current)return;
    const r=await fetch('/api/v1/sources');if(!r.ok)throw new Error('Unable to read sync progress.');
    const {data}=await r.json() as any;
    const active=data.filter((s:any)=>s.enabled&&(s.lease_token||s.cursor));
    const failed=data.filter((s:any)=>s.enabled&&s.last_error_code);
    const complete=due.every((old:any)=>{const s=data.find((x:any)=>x.id===old.id);return !s?.enabled||s.last_error_code||s.last_completed_at!==old.last_completed_at;});
    if(!mounted.current)return;
    setProgress(active.length?`${active.length} sources syncing…`:'Checking sources…');
    if(attempt>=2&&complete&&!active.length){notice(failed.length?`Sync finished with ${failed.length} source errors. Other sources still contributed jobs; see Integrations.`:due.length?'Available sources synced. Matches are being analyzed.':'Sources checked. Recent feeds will refresh after their polling interval.');return;}
   }
   notice('Sync is continuing in the background. The source status shows its progress.');
  }catch(error){if(mounted.current)notice((error as Error).message,true);}finally{if(mounted.current){setBusy(false);setProgress('');refresh();}}
 }
 return <button className="btn" disabled={busy} onClick={run}><RefreshCw size={16} className={busy?'spin':''}/>{busy?progress:'Sync real jobs'}</button>;
}
export function ResumeImportButton({onImport,notice}:{onImport:(draft:Record<string,any>,text:string)=>void;notice:(message:string,error?:boolean)=>void}) {
 const [busy,setBusy]=useState(false);
 return <button className="btn" disabled={busy} onClick={async()=>{
  setBusy(true);try{
   const response=await fetch('/api/v1/profile/import-resume',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const result=await response.json() as any;if(!response.ok)throw new Error(result.error?.message ?? 'Unable to import your resume.');
   onImport(result.data.draft,result.data.extracted_text);notice('Resume details imported as a draft. Review them, then click Verify & save profile.');
  }catch(error){notice((error as Error).message,true);}finally{setBusy(false);}
 }}>
 {busy?<LoaderCircle className="spin" size={15}/>:<FileText size={15}/>} Import from uploaded resume
 </button>;
}
