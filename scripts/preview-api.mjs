import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const secrets={};
if(existsSync('.dev.vars'))for(const line of readFileSync('.dev.vars','utf8').split(/\r?\n/)){
 const match=line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(match&&/^(FREEHIRE_API_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|GOOGLE_TOKEN_ENCRYPTION_KEY)$/.test(match[1]))secrets[match[1]]=match[2].replace(/^['"]|['"]$/g,'');
}
export const mf=new Miniflare({...convertV4MiniflareOptions({
  port:8787,host:'127.0.0.1',modules:true,
  script:readFileSync('work/worker-build/index.js','utf8'),
  compatibilityDate:'2026-10-23',
  d1Databases:{DB:'00000000-0000-0000-0000-000000000001'},
  d1Persist:'.wrangler/state/v3/d1',
  r2Buckets:['FILES'],r2Persist:'.wrangler/state/v3/r2',
  queueProducers:{TASKS:'local-tasks'},queueConsumers:{'local-tasks':{maxBatchSize:1,maxRetries:3}},
  bindings:{...secrets,APP_ENV:'local',APP_ORIGIN:'http://127.0.0.1:5173',ACCESS_ISSUER:'',ACCESS_AUDIENCE:''},
  serviceBindings:{ASSETS:()=>new Response('Use the frontend preview on http://127.0.0.1:5173',{status:404})}
}),resourcePersistencePath:resolve('.wrangler/preview-state')});
console.log(`Local Worker runtime: ${await mf.ready}`);
const db=await mf.getD1Database('DB');
if(!(await db.prepare("SELECT name FROM sqlite_master WHERE name='users'").first())) {
  for(const file of ['migrations/0001_initial.sql','migrations/0002_runtime.sql']) {
    // D1 exec accepts one or more SQL statements per line, including whole triggers.
    await db.exec(readFileSync(file,'utf8').replace(/--[^\n]*/g,'').replace(/\r?\n/g,' '));
  }
  await db.exec(readFileSync('seed.sql','utf8').replace(/--[^\n]*/g,'').replace(/\r?\n/g,' '));
  console.log('Initialized isolated preview database with fictional sample jobs.');
}
const outboxColumns=await db.prepare('PRAGMA table_info(outbox)').all();
if(!outboxColumns.results.some(column=>column.name==='dispatch_token'))await db.exec(readFileSync('migrations/0004_durable_work.sql','utf8').replace(/--[^\n]*/g,'').replace(/\r?\n/g,' '));
process.on('SIGINT',async()=>{await mf.dispose();process.exit(0);});
