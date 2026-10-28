import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {queueEnv,drainWork} from '../work/runtime/apps/worker/src/durable-work.js';
import {dispatch} from '../work/runtime/apps/worker/src/store.js';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-10-23',d1Databases:['DB']}));
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
try{
 const DB=await mf.getD1Database('DB');for(const file of ['migrations/0001_initial.sql','migrations/0002_runtime.sql','migrations/0004_durable_work.sql','seed.sql'])await DB.exec(readFileSync(file,'utf8').replace(/--[^\n]*/g,'').replace(/\r?\n/g,' '));
 let attempts=0;const native={async send(){attempts++;throw Error('You have exceeded the daily write operations limit in Queues free tier');}};
 const env=queueEnv({APP_ENV:'production',DB,TASKS:native});
 await env.TASKS.send({kind:'SYNC_FEED',source_id:'fixture'});await env.TASKS.send({kind:'SYNC_FEED',source_id:'fixture'});
 assert.equal(attempts,1);assert.equal((await DB.prepare('SELECT COUNT(*) count FROM durable_work').first()).count,1);pass('daily queue quota persists a single durable task instead of throwing');
 await queueEnv({APP_ENV:'production',DB,TASKS:native}).TASKS.send({kind:'SYNC_FEED',source_id:'fixture'});assert.equal(attempts,1);pass('queue backoff survives a new Worker environment');
 const resumed=await drainWork(env,body=>env.TASKS.send(body));assert.equal(resumed.state,'PROCESSED');assert.equal((await DB.prepare('SELECT state FROM durable_work').first()).state,'PENDING');pass('a continuation created while its task is running is preserved');
 await env.TASKS.send({kind:'TAILOR_RESUME',task_id:'urgent'});const order=[];await drainWork(env,async body=>order.push(body.kind));assert.deepEqual(order,['TAILOR_RESUME']);pass('owner resume generation takes priority over discovery backlog');
 let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);const first=drainWork(env,async()=>{entered();await gate;});await started;assert.equal((await drainWork(env,async()=>{})).state,'BUSY');release();await first;pass('concurrent drainers cannot execute the same durable work');
 await env.TASKS.send({kind:'SYNC_FEED',source_id:'delayed'},{delaySeconds:60});assert.equal((await drainWork(env,async()=>{})).state,'IDLE');pass('durable continuations honor provider delays');
 await DB.prepare('DELETE FROM durable_work').run();await env.TASKS.send({kind:'SYNC_FEED',source_id:'retry'});assert.equal((await drainWork(env,async()=>{throw Error('temporary');})).state,'RETRY');const retry=await DB.prepare('SELECT state,error_code,attempts FROM durable_work').first();assert.deepEqual(retry,{state:'PENDING',error_code:'TASK_FAILED',attempts:1});pass('failed durable work remains recoverable with bounded backoff');
 await DB.prepare("INSERT INTO tasks(id,user_id,kind,entity_id,entity_revision,idempotency_key,state,created_at,updated_at) VALUES('outbox-task','primary-owner','ANALYZE_JOB','sample-1',1,'outbox-test','PENDING',?,?)").bind(new Date().toISOString(),new Date().toISOString()).run();
 await DB.prepare("INSERT INTO outbox(id,task_id,payload_json,available_at) VALUES('outbox-test','outbox-task',?,?)").bind(JSON.stringify({kind:'ANALYZE_JOB',task_id:'outbox-task'}),new Date().toISOString()).run();
 let sent=0;const counted={DB,TASKS:{async send(){sent++;await new Promise(resolve=>setTimeout(resolve,30));}}};await Promise.all(Array.from({length:6},()=>dispatch(counted)));assert.equal(sent,1);assert.equal((await DB.prepare("SELECT attempts FROM outbox WHERE id='outbox-test'").first()).attempts,1);pass('concurrent outbox dispatchers publish each task once');
 console.log(`${checks} durable queue recovery checks passed.`);
}finally{await mf.dispose();}

