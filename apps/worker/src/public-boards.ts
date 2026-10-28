import { z } from 'zod';
import type { Feed } from './providers';

// Only fixed public ATS hosts are used. No credentials or internal postings.
export async function publicJSON(url:string,init:RequestInit={},timeout=12000){
 const response=await fetch(url,{...init,headers:{Accept:'application/json','User-Agent':'Shortlist/1.0',...init.headers},signal:AbortSignal.timeout(timeout)});
 if(!response.ok){await response.body?.cancel();throw Error('UPSTREAM_'+response.status);}
 return await response.json() as any;
}
const rows=(value:unknown)=>z.array(z.record(z.string(),z.unknown())).parse(value);
const target=(title:unknown)=>typeof title==='string'&&/engineer|developer|automation|\bsde\b|programmer/i.test(title);
async function details<T>(items:T[],read:(item:T)=>Promise<unknown>){
 const result:unknown[]=Array(items.length);let cursor=0,error:unknown;
 await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{while(cursor<items.length&&!error){const index=cursor++;try{result[index]=await read(items[index]);}catch(e){error=e;}}}));
 if(error)throw error;return result.filter(Boolean);
}
export function workdayBase(feed:Feed){
 if(!feed.host||!new RegExp('^'+feed.board+'\\.wd\\d+\\.myworkdayjobs\\.com$','i').test(feed.host)||!feed.site||!/^[a-zA-Z0-9_-]{1,100}$/.test(feed.site))throw Error('INVALID_WORKDAY_BOARD');
 return `https://${feed.host}/wday/cxs/${feed.board}/${feed.site}`;
}
const canonical=(id:unknown,title:unknown,content:unknown,url:unknown,location:unknown,remote=false,posted?:unknown)=>({id,title,content,absolute_url:url,location:{name:location},remote,posted});
export async function fetchPublicBoard(feed:Feed,cursor:string|null):Promise<{jobs:unknown[];next:string|null}>{
 if(feed.provider==='arbeitnow'){
  const page=cursor?z.coerce.number().int().min(1).max(1000).parse(cursor):1;
  const result=await publicJSON(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
  const jobs=rows(result.data).map((r:any)=>({...canonical(r.slug,r.title,r.description,r.url,r.location,r.remote===true,r.created_at),company:r.company_name}));
  const next=result.links?.next;if(next){const u=new URL(next);if(u.hostname!=='www.arbeitnow.com'||u.pathname!=='/api/job-board-api'||Number(u.searchParams.get('page'))!==page+1)throw Error('INVALID_CONTINUATION');}
  return {jobs,next:next?String(page+1):null};
 }
 if(feed.provider==='remoteok'){
  const result=await publicJSON('https://remoteok.com/api');
  return {jobs:rows(result).filter(r=>r.id&&r.position).map((r:any)=>({...canonical(r.id,r.position,r.description,r.url,r.location||'Remote (country not specified)',true,r.date),company:r.company})),next:null};
 }
 if(feed.provider==='workable'){
  const result=await publicJSON(`https://apply.workable.com/api/v1/widget/accounts/${feed.board}?details=true`);
  return {jobs:rows(result.jobs).map((r:any)=>canonical(r.shortcode??r.id,r.title,r.description??r.full_description,r.url??r.shortlink,[r.location?.city,r.location?.country].filter(Boolean).join(', '),r.telecommuting===true,r.published_on??r.created_at)),next:null};
 }
 const position=cursor?z.object({query:z.number().int().min(0).max(2),offset:z.number().int().min(0)}).parse(JSON.parse(cursor)):{query:0,offset:0};
 const query=['engineer','developer','automation'][position.query];
 const jobs:unknown[]=[];let total=0,count=0;
 if(feed.provider==='workday'){
  const base=workdayBase(feed),result=await publicJSON(base+'/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appliedFacets:{},limit:10,offset:position.offset,searchText:query})});
  const listings=rows(result.jobPostings);total=z.number().int().min(0).parse(result.total);count=listings.length;
  jobs.push(...await details(listings.filter(r=>target(r.title)),async r=>{const path=z.string().regex(/^\/job\/[a-zA-Z0-9_\-/%().,]+$/).parse(r.externalPath);
   let detail;try{detail=await publicJSON(base+path,{},8000);}catch(error){if((error as Error).message==='UPSTREAM_404')return null;throw error;}const info=detail.jobPostingInfo;if(!info)throw Error('INVALID_JOB_DETAIL');
   const place=[info.location,...(info.additionalLocations??[]),info.country?.descriptor].filter(x=>typeof x==='string').join(', ');
   return canonical(info.jobReqId??path,info.title,info.jobDescription,`https://${feed.host}/${feed.site}${path}`,place,/remote/i.test(info.remoteType??'')&&!/hybrid/i.test(info.remoteType??''),info.startDate);
  }));
 }else if(feed.provider==='smartrecruiters'){
  const base=`https://api.smartrecruiters.com/v1/companies/${feed.board}/postings`,result=await publicJSON(`${base}?destination=PUBLIC&limit=10&offset=${position.offset}&q=${query}`);
  const listings=rows(result.content);total=z.number().int().min(0).parse(result.totalFound);count=listings.length;
  jobs.push(...await details(listings.filter(r=>target(r.name)),async r=>{const id=z.string().regex(/^[a-zA-Z0-9_-]+$/).parse(r.id);let detail;try{detail=await publicJSON(base+'/'+id,{},8000);}catch(error){if((error as Error).message==='UPSTREAM_404')return null;throw error;}
   const content=Object.values(detail.jobAd?.sections??{}).map((s:any)=>[s.title,s.text].filter(Boolean).join('\n')).join('\n');
   return canonical(id,detail.name,content,detail.postingUrl,[detail.location?.city,detail.location?.country].filter(Boolean).join(', '),detail.location?.remote===true,detail.releasedDate);
  }));
 }else throw Error('UNSUPPORTED_PROVIDER');
 if(count===0&&position.offset<total)throw Error('EMPTY_PAGE_BEFORE_TOTAL');
 return {jobs,next:position.offset+count<total?JSON.stringify({...position,offset:position.offset+count}):position.query<2?JSON.stringify({query:position.query+1,offset:0}):null};
}
