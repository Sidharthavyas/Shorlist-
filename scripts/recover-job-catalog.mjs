// Compile shared parsers first: node scripts/test.mjs --compile-only
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {mongoDirect} from './mongo-direct.mjs';
import {normalizeFeed,INITIAL_FEEDS} from '../work/runtime/apps/worker/src/providers.js';
import {normalize} from '../work/runtime/apps/worker/src/source.js';
import {experience,location,roleAllowed,DEFAULTS} from '../work/runtime/apps/worker/src/domain.js';
import {mirrorCatalog} from '../server/job-catalog.mjs';
const feeds=[...INITIAL_FEEDS,...JSON.parse(fs.readFileSync('config/company-feeds.json'))];
const client=await mongoDirect(fs.readFileSync('work/mongodb-uri.txt','utf8').trim());
try{
 const db=client.db('shortlist'),files=db.collection('private_files'),catalog=db.collection('job_catalog');
 await files.createIndex({key:1});await catalog.createIndex({id:1},{unique:true});await catalog.createIndex({experience_status:1,role_status:1,location_status:1,cached_at:-1,id:1});await catalog.createIndex({source:1,cached_at:-1});
 const latest=new Map();let inspected=0,stored=0,invalid=0;
 for await(const file of files.find({key:{$regex:'^jobs/snapshots/(?!manual/)'}},{projection:{key:1,updatedAt:1}})){
  const m=file.key.match(/^jobs\/snapshots\/(.+)\/([a-f0-9-]{36})-(\d+)(-raw)?\.json$/i);if(!m)continue;
  if(++inspected>200000)throw Error('RECOVERY_REQUIRES_REVIEW');const prior=latest.get(m[2]),revision=Number(m[3]);
  if(!prior||revision>prior.revision||revision===prior.revision&&!m[4])latest.set(m[2],{...file,id:m[2],source:m[1],revision});
 }
 for(const file of latest.values()){
  try{const record=await files.findOne({_id:file._id});const bytes=Buffer.from(record.data.buffer),value=JSON.parse((record.contentType==='application/vnd.shortlist.gzip+json'?gunzipSync(bytes):bytes).toString());let row=value._shortlist_catalog;
   if(!row){const raw=value.raw??value;let job;
    if(Array.isArray(raw.skills)&&Array.isArray(raw.requirements)&&raw.job_url&&raw.external_id)job=raw;
    else if(file.source==='freehire')job=normalize(raw);
    else {const feed=feeds.find(f=>f.id===file.source);if(!feed)throw Error('UNKNOWN_SOURCE');job=normalizeFeed(feed,raw);}
    if(!job)continue;const e=experience(job,2,DEFAULTS),l=location(job,DEFAULTS);
    row={...job,id:file.id,revision:file.revision,experience_status:e.classification,experience_min:e.min_years,experience_max:e.max_years,location_status:l.status,location_reason:l.reason,role_status:roleAllowed(job.title,DEFAULTS)?'ELIGIBLE':'NOT_ELIGIBLE',experience:e,normalized_json:JSON.stringify(job),is_sample:0};
   }
   row.cached_at=new Date(file.updatedAt).toISOString();if(await mirrorCatalog(row,catalog))stored++;
  }catch{invalid++;}
  if((stored+invalid)%200===0)console.log('Recovered public jobs:',stored,'skipped:',invalid);
 }
 const eligible=await catalog.countDocuments({experience_status:'ELIGIBLE',role_status:'ELIGIBLE',location_status:'COMPATIBLE',availability:'OPEN',cached_at:{$gte:new Date(Date.now()-7*86400000).toISOString()}});
 console.log(JSON.stringify({snapshots:inspected,recovered:stored,skipped:invalid,eligible}));
}finally{await client.close();}
