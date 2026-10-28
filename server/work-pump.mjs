export async function pumpWork(backend,secret,{fetcher=fetch,maxTasks=8,maxMs=40000}={}){
  const until=Date.now()+maxMs;
  try{
    for(let n=0;n<maxTasks&&Date.now()<until;n++){
      const response=await fetcher(new URL('/api/internal/drain',backend),{method:'POST',headers:{'X-Shortlist-Proxy-Token':secret},redirect:'manual',signal:AbortSignal.timeout(45000)});
      if(!response.ok)break;
      const result=await response.json();if(result.state!=='PROCESSED')break;
    }
  }catch{console.warn(JSON.stringify({event:'background_work_paused',code:'WORKER_UNAVAILABLE'}));}
}
