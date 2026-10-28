import type {Env} from './env';
export interface TaskMessage {kind?:string;source_id?:string;task_id?:string;entity_id?:string;entity_revision?:number;settings_revision?:number;}
export interface TaskQueue {send(body:unknown,options?:{delaySeconds?:number}):Promise<void>;}
const iso=()=>new Date().toISOString();
const later=(seconds:number)=>new Date(Date.now()+seconds*1000).toISOString();
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');

export function queueEnv(env:Env):Env {
  if(env.APP_ENV!=='production'&&env.DURABLE_WORK!=='enabled')return env;
  let nativeBlocked:Promise<boolean>|undefined;
  const native=env.TASKS;
  const TASKS:TaskQueue={async send(value,options){
    nativeBlocked??=env.DB.prepare("SELECT blocked_until FROM work_runtime WHERE id='native-queue'").first<{blocked_until:string}>().then(row=>!!row?.blocked_until&&row.blocked_until>iso());
    if(!await nativeBlocked){
      try{await native.send(value,options);return;}catch(error){
        const daily=/daily|quota|10253/i.test(String(error));
        const midnight=new Date();midnight.setUTCHours(24,0,0,0);
        const until=daily?midnight.toISOString():later(60);
        await env.DB.prepare("INSERT INTO work_runtime(id,blocked_until,error_code) VALUES('native-queue',?,?) ON CONFLICT(id) DO UPDATE SET blocked_until=excluded.blocked_until,error_code=excluded.error_code").bind(until,daily?'DAILY_QUOTA':'QUEUE_UNAVAILABLE').run();
        nativeBlocked=Promise.resolve(true);
        console.warn(JSON.stringify({event:'queue_fallback',code:daily?'DAILY_QUOTA':'QUEUE_UNAVAILABLE',retry_at:until}));
      }
    }
    const body=value as TaskMessage;
    const id=await digest(`${body.kind??'ANALYZE_JOB'}:${body.task_id??body.source_id??'singleton'}`);
    const at=later(options?.delaySeconds??0),priority=body.kind==='TAILOR_RESUME'?100:body.task_id?20:0;
    await env.DB.prepare("INSERT INTO durable_work(id,payload_json,available_at,priority) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,state=CASE WHEN durable_work.state='RUNNING' THEN 'RUNNING' ELSE 'PENDING' END,rerun=CASE WHEN durable_work.state='RUNNING' THEN 1 ELSE 0 END,available_at=MIN(durable_work.available_at,excluded.available_at),next_available_at=excluded.available_at,error_code=NULL").bind(id,JSON.stringify(value),at,priority).run();
  }};
  return {...env,TASKS};
}

export async function drainWork(env:Env,processTask:(body:TaskMessage)=>Promise<unknown>){
  const token=crypto.randomUUID(),t=iso();
  const lock=await env.DB.prepare("INSERT INTO work_runtime(id,lease_until,lease_token) VALUES('work-drain',?,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until,lease_token=excluded.lease_token WHERE work_runtime.lease_until IS NULL OR work_runtime.lease_until<=? RETURNING id").bind(later(90),token,t).first();
  if(!lock)return {state:'BUSY',processed:0};
  try{
    const row=await env.DB.prepare("UPDATE durable_work SET state='RUNNING',lease_token=?,lease_until=?,rerun=0,attempts=attempts+1 WHERE id=(SELECT id FROM durable_work WHERE (state='PENDING' AND available_at<=?) OR (state='RUNNING' AND lease_until<=?) ORDER BY priority DESC,available_at LIMIT 1) RETURNING id,payload_json,attempts").bind(token,later(90),t,t).first<{id:string;payload_json:string;attempts:number}>();
    if(!row)return {state:'IDLE',processed:0};
    try{
      await processTask(JSON.parse(row.payload_json));
      await env.DB.prepare("UPDATE durable_work SET state=CASE WHEN rerun=1 THEN 'PENDING' ELSE 'DONE' END,available_at=COALESCE(next_available_at,available_at),next_available_at=NULL,lease_token=NULL,lease_until=NULL,attempts=CASE WHEN rerun=1 THEN 0 ELSE attempts END WHERE id=? AND lease_token=?").bind(row.id,token).run();
      await env.DB.prepare("DELETE FROM durable_work WHERE id=? AND state='DONE'").bind(row.id).run();
      return {state:'PROCESSED',processed:1};
    }catch{
      await env.DB.prepare("UPDATE durable_work SET state=?,available_at=?,lease_token=NULL,lease_until=NULL,error_code='TASK_FAILED' WHERE id=? AND lease_token=?").bind(row.attempts>=5?'FAILED':'PENDING',later(Math.min(300,row.attempts*30)),row.id,token).run();
      return {state:'RETRY',processed:0};
    }
  }finally{
    await env.DB.prepare("UPDATE work_runtime SET lease_token=NULL,lease_until=NULL WHERE id='work-drain' AND lease_token=?").bind(token).run();
  }
}
