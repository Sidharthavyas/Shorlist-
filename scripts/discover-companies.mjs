// Run after `node scripts/test.mjs --compile-only`. Only public careers pages
// and public ATS APIs are inspected; a failed probe never enables a source.
import fs from 'node:fs';
import {discoverCompany,boardsIn} from '../work/runtime/apps/worker/src/company-discovery.js';
import {fetchFeed,normalizeFeed} from '../work/runtime/apps/worker/src/providers.js';
const catalog=JSON.parse(fs.readFileSync('config/company-catalog.json','utf8'));
const resultPath='work/company-discovery-results.json';
const discovery=fs.existsSync(resultPath)?JSON.parse(fs.readFileSync(resultPath,'utf8')):[];
let cursor=0;const missing=catalog.filter(c=>!discovery.some(d=>d.companyId===c.id));
await Promise.all(Array.from({length:6},async()=>{while(cursor<missing.length){discovery.push(await discoverCompany(missing[cursor++]));fs.writeFileSync(resultPath,JSON.stringify(discovery,null,2));}}));
const candidates=new Map();
for(const company of catalog){const row=discovery.find(d=>d.companyId===company.id);for(const b of row?.boards??[]){const match=boardsIn(b.url)[0]??b;if(!['greenhouse','lever','ashby','workday','smartrecruiters','workable'].includes(match.provider))continue;
 const id=[match.provider,match.board,...(match.site?[match.site]:[])].join(':');
 if(!candidates.has(id))candidates.set(id,{...match,id,name:company.name+' · '+match.provider,company:company.name,interval:720,companyIds:[]});candidates.get(id).companyIds.push(company.id);
}}
for(const provider of ['arbeitnow','remoteok'])candidates.set(provider,{id:provider,name:provider==='remoteok'?'Remote OK':'Arbeitnow',provider,interval:360,companyIds:[]});
const verifyPath='work/company-feed-verification.json',verified=fs.existsSync(verifyPath)?JSON.parse(fs.readFileSync(verifyPath,'utf8')):[];
const pending=[...candidates.values()].filter(c=>!verified.some(v=>v.id===c.id));cursor=0;
await Promise.all(Array.from({length:5},async()=>{while(cursor<pending.length){const feed=pending[cursor++];try{const page=await fetchFeed(feed,null);for(const raw of page.jobs.slice(0,3))normalizeFeed(feed,raw);verified.push({...feed,verifiedAt:new Date().toISOString(),status:'VERIFIED',sampleCount:page.jobs.length});}catch(error){verified.push({...feed,verifiedAt:new Date().toISOString(),status:'UNAVAILABLE',error:String(error.message)});}fs.writeFileSync(verifyPath,JSON.stringify(verified,null,2));console.log('Checked public feed '+verified.length+'/'+candidates.size+': '+feed.id+' '+verified.at(-1).status);}}));
const active=verified.filter(v=>v.status==='VERIFIED').map(f=>({...f,name:f.company?`${f.company} · ${f.provider} · ${f.site??f.board}`:f.name})),quote=value=>"'"+String(value).replaceAll("'","''")+"'";
fs.writeFileSync('config/company-feeds.json',JSON.stringify(active.map(({companyIds,status,sampleCount,verifiedAt,...feed})=>({...feed,verifiedAt})),null,2)+'\n');
fs.writeFileSync('config/company-coverage.json',JSON.stringify(catalog.map(c=>{const check=discovery.find(d=>d.companyId===c.id),feeds=active.filter(f=>f.companyIds.includes(c.id));return {id:c.id,checkedAt:check?.checkedAt??null,status:feeds.length?'CONNECTED':check?.status==='BLOCKED'?'BLOCKED':'MANUAL',sourceIds:feeds.map(f=>f.id),note:feeds.length?'Public feed verified':check?.error??'Custom careers portal; automatic sync not available'};}),null,2)+'\n');
fs.writeFileSync('migrations/0005_company_sources.sql','-- Verified public company feeds. Existing enable/disable preferences are retained.\n'+active.map(({companyIds,status,sampleCount,verifiedAt,...f})=>`INSERT OR IGNORE INTO job_sources(id,name,enabled,config_json) VALUES(${quote(f.id)},${quote(f.name)},1,${quote(JSON.stringify(f))});\nINSERT OR IGNORE INTO source_sync_state(source_id) VALUES(${quote(f.id)});`).join('\n')+'\n');
console.log(JSON.stringify({companies:catalog.length,connectedCompanies:catalog.filter(c=>active.some(f=>f.companyIds.includes(c.id))).length,verifiedFeeds:active.length,unavailable:verified.filter(v=>v.status!=='VERIFIED').length}));
