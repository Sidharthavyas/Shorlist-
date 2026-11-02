import {MongoClient} from 'mongodb';
import {accountSession} from './accounts.mjs';
let connection,indexes;
export async function catalogCollection(){
 if(!process.env.MONGODB_URI)throw Error('MONGODB_NOT_CONFIGURED');
 connection??=new MongoClient(process.env.MONGODB_URI,{maxPoolSize:5,serverSelectionTimeoutMS:8000,connectTimeoutMS:8000}).connect().catch(error=>{connection=undefined;throw error;});
 const collection=(await connection).db(process.env.MONGODB_DATABASE||'shortlist').collection('job_catalog');
 indexes??=Promise.all([collection.createIndex({experience_status:1,role_status:1,location_status:1,cached_at:-1,id:1}),collection.createIndex({source:1,cached_at:-1}),collection.createIndex({id:1},{unique:true})]).catch(error=>{indexes=undefined;throw error;});await indexes;return collection;
}
export async function mirrorCatalog(row,collection){
 if(!row||row.source==='manual'||row.is_sample!==0||!/^[-a-f0-9]{36}$/i.test(row.id??'')||typeof row.description!=='string'||!/^https?:\/\//.test(row.job_url??''))return false;
 const saved={...row,catalog_read_only:true,cached_at:row.cached_at??new Date().toISOString(),match_score:null,raw_score:null,score:null,analysis_json:null,disposition:null};
 try{await collection.updateOne({_id:row.id,$or:[{revision:{$lte:row.revision}},{revision:{$exists:false}}]},{$set:saved},{upsert:true});}catch(error){if(error.code!==11000)throw error;}
 return true;
}
export async function catalogRequest(request,getCollection=catalogCollection,sessionFor=accountSession){
 const u=new URL(request.url);if(request.method!=='GET'||!/^\/api\/v1\/jobs(?:\/[^/]+)?$/.test(u.pathname)||!process.env.MONGODB_URI)return null;
 const session=await sessionFor(request);if(!session)return null;
 const view=u.searchParams.get('view')||'discover';if(!['discover','review'].includes(view)||Number(u.searchParams.get('min_score')||0)>0)return null;
 const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Shortlist-Catalog':'mongodb'}});
 try{
  const collection=await getCollection(),id=u.pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/)?.[1];
  const meta={catalog_backend:'mongodb',cached_public_catalog:true,personalized:false,message:'Showing cached public listings with standard 0–2-year remote filters, ordered by when they were last stored. Personal scores, saved jobs and resume actions are temporarily unavailable. Check the original listing before applying.'};
  if(id){const row=await collection.findOne({id,source:{$ne:'manual'},is_sample:0},{projection:{_id:0}});return row?reply({data:{...row,source_refs:[{source_id:row.source,source_url:row.job_url}]},meta}):null;}
  const limit=Number(u.searchParams.get('limit')||40),offset=Number(u.searchParams.get('offset')||0),q=u.searchParams.get('q')||'',source=u.searchParams.get('source')||'',remote=u.searchParams.get('remote_type')||'',days=Number(u.searchParams.get('days')||0);
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>100000||q.length>200||source.length>130||remote.length>40||!Number.isFinite(days)||days<0||days>365)return reply({error:{code:'INVALID_INPUT',message:'Check the job filters.'}},400);
  const conditions=[{is_sample:0,source:{$ne:'manual'},availability:'OPEN',role_status:'ELIGIBLE',cached_at:{$gte:new Date(Date.now()-7*86400000).toISOString()}}];
  conditions.push(view==='review'?{$and:[{experience_status:{$ne:'NOT_ELIGIBLE'}},{location_status:{$ne:'INCOMPATIBLE'}},{$or:[{experience_status:'REVIEW_REQUIRED'},{location_status:'REVIEW_REQUIRED'}]}]}:{experience_status:'ELIGIBLE',location_status:'COMPATIBLE'});
  if(source)conditions.push({source});if(remote)conditions.push({remote_type:remote});if(days)conditions.push({first_seen_at:{$gte:new Date(Date.now()-days*86400000).toISOString()}});
  for(const word of q.split(/\s+/).filter(Boolean)){const regex=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');conditions.push({$or:['title','company','description','location'].map(key=>({[key]:{$regex:regex,$options:'i'}}))});}
  const filter={$and:conditions},[total,data]=await Promise.all([collection.countDocuments(filter),collection.find(filter,{projection:{_id:0}}).sort({cached_at:-1,id:1}).skip(offset).limit(limit).toArray()]);
  // An uninitialized catalog must not turn a healthy D1 result into an empty list.
  if(!total&&!await collection.findOne({is_sample:0},{projection:{_id:1}}))return null;
  return reply({data,meta:{...meta,total,limit,offset,sort_applied:'recent'}});
 }catch{console.warn(JSON.stringify({event:'public_catalog_unavailable'}));return null;}
}
