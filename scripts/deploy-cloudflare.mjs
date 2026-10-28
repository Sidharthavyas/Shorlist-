// Upload the already bundled Worker using the official Workers API. This avoids
// native bundler path discovery on restricted Windows developer environments.
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const authPath=process.env.CLOUDFLARE_OAUTH_CONFIG||'work/cloudflare-config/.wrangler/config/default.toml';
const token=process.env.CLOUDFLARE_API_TOKEN||(existsSync(authPath)?readFileSync(authPath,'utf8').match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1]:undefined);
if(!token)throw Error('Authenticate Wrangler or set CLOUDFLARE_API_TOKEN.');
const base=`https://api.cloudflare.com/client/v4/accounts/${config.account_id}`;
async function api(path,method='GET',body){
 const headers={Authorization:`Bearer ${token}`};
 if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
 const response=await fetch(base+path,{method,headers,body});const result=await response.json();
 if(!response.ok||result.success===false)throw Error(`Cloudflare ${response.status}: ${JSON.stringify(result.errors??[])}`);
 return result.result;
}
const metadata={main_module:'index.js',compatibility_date:config.compatibility_date,keep_bindings:['secret_text'],observability:{enabled:true},bindings:[
 ...config.d1_databases.map(db=>({type:'d1',name:db.binding,id:db.database_id})),
 ...config.queues.producers.map(queue=>({type:'queue',name:queue.binding,queue_name:queue.queue})),
 ...Object.entries(config.vars).map(([name,text])=>({type:'plain_text',name,text}))
]};
const upload=new FormData();upload.set('metadata',JSON.stringify(metadata));upload.set('index.js',new Blob([readFileSync(config.main)],{type:'application/javascript+module'}),'index.js');
await api(`/workers/scripts/${config.name}`,'PUT',upload);console.log('Uploaded production Worker; existing secrets retained.');
let subdomain;
try{subdomain=await api('/workers/subdomain');}catch(error){if(!String(error).includes('10007'))throw error;}
if(!subdomain?.subdomain)subdomain=await api('/workers/subdomain','PUT',{subdomain:'shortlist-sidharthavyas'});
await api(`/workers/scripts/${config.name}/subdomain`,'POST',{enabled:true,previews_enabled:false});
const queues=await api('/queues');
for(const consumer of config.queues.consumers){
 const queue=queues.find(row=>row.queue_name===consumer.queue);if(!queue)throw Error(`Missing queue ${consumer.queue}`);
 const consumers=await api(`/queues/${queue.queue_id}/consumers`);
 const prior=consumers.find(row=>(row.script_name??row.script)===config.name);
 const definition={type:'worker',script_name:config.name,dead_letter_queue:consumer.dead_letter_queue,settings:{batch_size:consumer.max_batch_size,max_wait_time_ms:consumer.max_batch_timeout*1000,max_retries:consumer.max_retries}};
 await api(`/queues/${queue.queue_id}/consumers${prior?'/'+prior.consumer_id:''}`,prior?'PUT':'POST',definition);
}
await api(`/workers/scripts/${config.name}/schedules`,'PUT',config.triggers.crons.map(cron=>({cron})));
const url=`https://${config.name}.${subdomain.subdomain}.workers.dev`;
writeFileSync('work/backend-url.txt',url);console.log('Worker and queue consumer deployed: '+url);
