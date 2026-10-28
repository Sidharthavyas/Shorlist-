import { MongoClient, Binary } from 'mongodb';
import { createHash, timingSafeEqual } from 'node:crypto';

let connection;
async function objects(){
  const uri=process.env.MONGODB_URI;
  if(!uri)throw Error('MONGODB_NOT_CONFIGURED');
  if(!connection){
    const client=new MongoClient(uri,{maxPoolSize:5,serverSelectionTimeoutMS:8000,connectTimeoutMS:8000});
    connection=client.connect().catch(error=>{connection=undefined;throw error;});
  }
  const client=await connection;
  return client.db(process.env.MONGODB_DATABASE||'shortlist').collection('private_files');
}
function authorized(request){
  const configured=process.env.MONGO_STORAGE_SECRET;
  if(!configured||configured.length<32)return false;
  const digest=value=>createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(configured),digest(request.headers.get('X-Storage-Token')||''));
}
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});

export async function storageRequest(request, getObjects=objects){
  if(!authorized(request))return reply({error:'Unauthorized'},401);
  const key=new URL(request.url).searchParams.get('key')||'';
  if(key.length>1024||!key.match(/^(profile|resumes|jobs)\/[\w./:@-]+$/)||key.split('/').includes('..'))return reply({error:'Invalid object key'},400);
  if(!['GET','PUT','DELETE'].includes(request.method))return reply({error:'Method not allowed'},405);
  try{
    const collection=await getObjects();
    const id=createHash('sha256').update(key).digest('hex');
    if(request.method==='PUT'){
      const length=Number(request.headers.get('Content-Length')||0);
      if(length>4*1024*1024)return reply({error:'Object exceeds 4 MB'},413);
      const bytes=Buffer.from(await request.arrayBuffer());
      if(bytes.length>4*1024*1024)return reply({error:'Object exceeds 4 MB'},413);
      await collection.updateOne({_id:id},{$set:{key,data:new Binary(bytes),contentType:request.headers.get('Content-Type')||'application/octet-stream',updatedAt:new Date()},$setOnInsert:{createdAt:new Date()}},{upsert:true});
      return reply({ok:true});
    }
    if(request.method==='DELETE'){await collection.deleteOne({_id:id});return reply({ok:true});}
    const object=await collection.findOne({_id:id});
    if(!object)return reply({error:'Object not found'},404);
    return new Response(new Uint8Array(object.data.buffer),{headers:{'Content-Type':object.contentType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){
    // Connection strings, driver errors and database contents never reach clients.
    console.error(JSON.stringify({event:'private_storage_error',name:error?.name??'Error',code:error?.code??null}));
    return reply({error:'Private file storage is temporarily unavailable.',code:error?.code===18?'MONGODB_AUTH_FAILED':error?.name==='MongoServerSelectionError'?'MONGODB_CONNECTION_FAILED':'MONGODB_UNAVAILABLE'},503);
  }
}
