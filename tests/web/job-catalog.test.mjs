import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogRequest,mirrorCatalog} from '../../server/job-catalog.mjs';
import {storageRequest} from '../../server/mongo-storage.mjs';
test('a protected public snapshot upload also maintains the MongoDB catalog',async()=>{
 const old=process.env.MONGO_STORAGE_SECRET;process.env.MONGO_STORAGE_SECRET='catalog-storage-fixture-secret-32-characters';let files=0,jobs=0;
 try{const row={id:'12345678-1234-1234-1234-123456789012',revision:1,source:'freehire',is_sample:0,description:'Public description',job_url:'https://careers.fixture.test/one'};
 const r=await storageRequest(new Request('https://app.test/api/storage?key=jobs/snapshots/freehire/'+row.id+'-1-raw.json',{method:'PUT',headers:{'X-Storage-Token':process.env.MONGO_STORAGE_SECRET,'Content-Type':'application/json'},body:JSON.stringify({raw:{title:'Backend Engineer'},_shortlist_catalog:row})}),async()=>({async updateOne(){files++;}}),async()=>({async updateOne(){jobs++;}}));
 assert.equal(r.status,200);assert.equal(files,1);assert.equal(jobs,1);
 }finally{old===undefined?delete process.env.MONGO_STORAGE_SECRET:process.env.MONGO_STORAGE_SECRET=old;}
});
test('catalog never exposes manual jobs, sample records or personal scores',async()=>{
 const calls=[],collection={async updateOne(...args){calls.push(args);}};
 const row={id:'12345678-1234-1234-1234-123456789012',revision:2,source:'freehire',is_sample:0,description:'Public role',job_url:'https://careers.fixture.test/one',match_score:99,score:99};
 assert.equal(await mirrorCatalog({...row,source:'manual'},collection),false);assert.equal(await mirrorCatalog({...row,is_sample:1},collection),false);assert.equal(calls.length,0);
 assert.equal(await mirrorCatalog(row,collection),true);assert.equal(calls[0][1].$set.match_score,null);assert.equal(calls[0][1].$set.score,null);assert.equal(calls[0][1].$set.catalog_read_only,true);assert.deepEqual(calls[0][0].$or[0],{revision:{$lte:2}});
});
test('catalog requires a valid account and does not replace private saved-job views or match filters',async()=>{
 const old=process.env.MONGODB_URI;process.env.MONGODB_URI='configured-for-fixture';let connected=0;const get=async()=>{connected++;throw Error('Must not connect');};
 try{const request=path=>new Request('https://app.test/api/v1/'+path);
  assert.equal(await catalogRequest(request('jobs'),get,async()=>null),null);
  assert.equal(await catalogRequest(request('jobs?view=saved'),get,async()=>({id:'account'})),null);
  assert.equal(await catalogRequest(request('jobs?min_score=80'),get,async()=>({id:'account'})),null);assert.equal(connected,0);
  let filter;const collection={async countDocuments(f){filter=f;return 1;},find(){return {sort(){return this;},skip(){return this;},limit(){return this;},async toArray(){return [{id:'fixture',catalog_read_only:true,score:null}];}};}};
  const r=await catalogRequest(request('jobs?q=a.*&limit=12'),async()=>collection,async()=>({id:'account'}));const body=await r.json();assert.equal(r.status,200);assert.equal(body.meta.personalized,false);assert.equal(body.meta.catalog_backend,'mongodb');assert.equal(body.meta.sort_applied,'recent');assert.equal(filter.$and[0].source.$ne,'manual');assert.equal(filter.$and.at(-1).$or[0].title.$regex,'a\\.\\*');
 }finally{old===undefined?delete process.env.MONGODB_URI:process.env.MONGODB_URI=old;}
});
