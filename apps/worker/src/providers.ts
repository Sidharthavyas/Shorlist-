import { z } from 'zod';
import type { NormalizedJob } from '../../../contracts/domain';
import { plain, safeUrl, skills } from './domain';

export const providers=['himalayas','jobicy','remotive','greenhouse','lever','ashby'] as const;
export type Provider=typeof providers[number];
export interface Feed {id:string;name:string;provider:Provider;board?:string;company?:string;interval:number;}
export const INITIAL_FEEDS:Feed[]=[
  {id:'himalayas',name:'Himalayas',provider:'himalayas',interval:1440},
  {id:'jobicy',name:'Jobicy',provider:'jobicy',interval:360},
  {id:'remotive',name:'Remotive',provider:'remotive',interval:360},
  {id:'greenhouse:stripe',name:'Stripe · Greenhouse',provider:'greenhouse',board:'stripe',company:'Stripe',interval:360},
  {id:'ashby:supabase',name:'Supabase · Ashby',provider:'ashby',board:'supabase',company:'Supabase',interval:360},
  {id:'ashby:linear',name:'Linear · Ashby',provider:'ashby',board:'linear',company:'Linear',interval:360},
  {id:'ashby:posthog',name:'PostHog · Ashby',provider:'ashby',board:'posthog',company:'PostHog',interval:360},
  {id:'greenhouse:canonical',name:'Canonical · Greenhouse',provider:'greenhouse',board:'canonical',company:'Canonical',interval:360},
  {id:'lever:palantir',name:'Palantir · Lever',provider:'lever',board:'palantir',company:'Palantir',interval:360}
];
export class FeedError extends Error {constructor(public code:string,public retryAfter=300){super(code);}}
const strings=z.array(z.string());
const object=(raw:unknown)=>z.record(z.string(),z.unknown()).parse(raw);
const text=(r:Record<string,unknown>,key:string,fallback='')=>typeof r[key]==='string'?r[key] as string:fallback;
const list=(r:Record<string,unknown>,key:string)=>strings.parse(r[key]??[]);
const date=(value:unknown)=>{if(value===null||value===undefined||value==='')return null;const n=typeof value==='number'?value<1e12?value*1000:value:String(value);const d=new Date(n);if(!Number.isFinite(d.getTime()))throw new FeedError('INVALID_JOB_DATE');return d.toISOString();};
const required=(r:Record<string,unknown>,key:string)=>z.string().min(1).parse(r[key]);
const link=(value:string)=>{const url=safeUrl(value);if(!url)throw new FeedError('INVALID_JOB_URL');return url;};
export function geography(place:string,remote:boolean,mode=''):Pick<NormalizedJob,'location'|'remote_type'|'allowed_countries'>{
  const india=/\bindia\b/i.test(place)||/^IN$/.test(place),world=/\b(worldwide|anywhere|global|world)\b/i.test(place);
  const countryMatches=[...place.matchAll(/\b(USA|United States|US|Canada|United Kingdom|UK|Germany|France|Australia|Brazil|Mexico|India)\b/gi)].map(m=>m[1].toLowerCase());
  return {location:place,remote_type:/hybrid/i.test(mode)?'HYBRID':/^(?:onsite|on.?site)$/i.test(mode)?'ONSITE':remote?world?'WORLDWIDE_REMOTE':india?'INDIA_REMOTE':'REMOTE':/remote/i.test(place)?world?'WORLDWIDE_REMOTE':india?'INDIA_REMOTE':'REMOTE':'UNKNOWN',allowed_countries:countryMatches.length?countryMatches:null};
}
export function normalizeFeed(feed:Feed,raw:unknown,discovered=new Date().toISOString()):NormalizedJob|null{
  const r=object(raw);let id='',title='',company=feed.company??'',description='',jobUrl='',applyUrl='',posted:string|null=null,seniority:string|null=null,employment:string|null=null,geo:ReturnType<typeof geography>=geography('',false),expiry:string|null=null,timezoneCompatible:boolean|undefined;
  if(feed.provider==='himalayas'){
    id=required(r,'guid');title=required(r,'title');company=required(r,'companyName');description=required(r,'description');jobUrl=link(id);applyUrl=required(r,'applicationLink');posted=date(r.pubDate);expiry=date(r.expiryDate);employment=text(r,'employmentType');
    const countries=list(r,'locationRestrictions'),zones=z.array(z.union([z.number(),z.string()])).parse(r.timezoneRestrictions??[]);
    const indiaZone=(value:string|number)=>typeof value==='number'?value===5.5:/^(?:(?:UTC|GMT)\s*)?\+?0?5(?::30|\.5)$/i.test(value);
    timezoneCompatible=zones.length?zones.some(indiaZone):undefined;
    geo={location:countries.join(', ')||(timezoneCompatible===true?'Worldwide (timezone restrictions checked)':'Remote'),allowed_countries:countries.length?countries:null,remote_type:countries.some(x=>/^(?:in|india)$/i.test(x))?'INDIA_REMOTE':countries.length?'REMOTE':timezoneCompatible===true?(zones.length>=20?'WORLDWIDE_REMOTE':'INDIA_REMOTE'):'REMOTE'};
    seniority=Array.isArray(r.seniority)?list(r,'seniority').join(', '):text(r,'seniority');
  }else if(feed.provider==='jobicy'){
    id=String(z.union([z.string().min(1),z.number()]).parse(r.id));title=required(r,'jobTitle');company=required(r,'companyName');description=required(r,'jobDescription');jobUrl=applyUrl=required(r,'url');posted=date(r.pubDate);seniority=text(r,'jobLevel');employment=list(r,'jobType').join(', ');geo=geography(required(r,'jobGeo'),true);
  }else if(feed.provider==='remotive'){
    id=String(z.union([z.string().min(1),z.number()]).parse(r.id));title=required(r,'title');company=required(r,'company_name');description=required(r,'description');jobUrl=applyUrl=required(r,'url');posted=date(r.publication_date);employment=text(r,'job_type');geo=geography(text(r,'candidate_required_location'),true);
  }else if(feed.provider==='greenhouse'){
    id=String(z.union([z.string().min(1),z.number()]).parse(r.id));title=required(r,'title');description=required(r,'content');jobUrl=applyUrl=required(r,'absolute_url');posted=date(r.first_published??r.updated_at);geo=geography(text(object(r.location),'name'),false);
  }else if(feed.provider==='lever'){
    id=required(r,'id');title=required(r,'text');const categories=object(r.categories??{});
    const lists=z.array(z.object({text:z.string(),content:z.string()})).parse(r.lists??[]);
    description=[text(r,'descriptionPlain')||text(r,'description'),...lists.map(x=>x.text+'\n'+plain(x.content)),text(r,'additionalPlain')||text(r,'additional')].join('\n');
    jobUrl=required(r,'hostedUrl');applyUrl=text(r,'applyUrl',jobUrl);posted=date(r.createdAt);employment=text(categories,'commitment');geo=geography([text(categories,'location'),...list(categories,'allLocations')].filter(Boolean).join(', '),r.workplaceType==='remote',text(r,'workplaceType'));if(text(r,'country')&&!geo.allowed_countries)geo.allowed_countries=[text(r,'country')];
  }else{
    if(r.isListed===false)return null;
    title=required(r,'title');jobUrl=required(r,'jobUrl');id=text(r,'id',jobUrl);applyUrl=text(r,'applyUrl',jobUrl);description=text(r,'descriptionPlain')||required(r,'descriptionHtml');posted=date(r.publishedAt);employment=text(r,'employmentType');const secondary=z.array(z.object({location:z.string()})).parse(r.secondaryLocations??[]);geo=geography([text(r,'location'),...secondary.map(x=>x.location)].filter(Boolean).join(', '),r.isRemote===true||r.workplaceType==='Remote',text(r,'workplaceType'));
    if(r.address){const address=object(object(r.address).postalAddress??{});if(text(address,'addressCountry')&&geo.remote_type!=='WORLDWIDE_REMOTE')geo.allowed_countries=[text(address,'addressCountry')];}
  }
  const cleaned=plain(description);
  return {external_id:id,public_slug:null,source:feed.id,company:company||'Company not provided',title,description:cleaned,requirements:[],preferred_qualifications:[],...geo,timezone_compatible:timezoneCompatible,job_url:link(jobUrl),apply_url:link(applyUrl),posted_at:posted,first_seen_at:discovered,experience_min:null,experience_max:null,skills:skills(title+' '+cleaned),salary:null,employment_type:employment||null,seniority,availability:expiry&&Date.parse(expiry)<=Date.now()?'EXPIRED':'OPEN'};
}
export async function fetchFeed(feed:Feed,cursor:string|null):Promise<{jobs:unknown[];next:string|null}>{
  if(feed.board&&!/^[a-zA-Z0-9_-]{1,100}$/.test(feed.board))throw new FeedError('INVALID_BOARD');
  let url:URL;
  if(feed.provider==='himalayas'){
    const position=cursor?z.object({query:z.number().int().min(0).max(2),page:z.number().int().min(1)}).parse(JSON.parse(cursor)):{query:0,page:1};
    url=new URL('https://himalayas.app/jobs/api/search');url.search=new URLSearchParams({q:['engineer','developer','SDE'][position.query],country:'IN',sort:'recent',page:String(position.page)}).toString();
  }
  else if(feed.provider==='jobicy'){url=new URL('https://jobicy.com/api/jobs');url.searchParams.set('industry','engineering');url.searchParams.set('count','100');if(cursor)url.searchParams.set('cursor',cursor);}
  else if(feed.provider==='remotive')url=new URL('https://remotive.com/api/remote-jobs?category=software-dev');
  else if(feed.provider==='greenhouse')url=new URL(`https://boards-api.greenhouse.io/v1/boards/${feed.board}/jobs?content=true`);
  else if(feed.provider==='lever')url=new URL(`https://api.lever.co/v0/postings/${feed.board}?mode=json&limit=100&skip=${Number(cursor)||0}`);
  else url=new URL(`https://api.ashbyhq.com/posting-api/job-board/${feed.board}`);
  const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok){const retry=response.headers.get('Retry-After');const delay=Number(retry)||Math.ceil((Date.parse(retry??'')-Date.now())/1000)||300;throw new FeedError(`UPSTREAM_${response.status}`,Math.max(60,delay));}
  const payload:unknown=await response.json();
  if(feed.provider==='lever'){const jobs=z.array(z.unknown()).parse(payload);return {jobs,next:jobs.length===100?String((Number(cursor)||0)+jobs.length):null};}
  const result=z.object({jobs:z.array(z.unknown()),nextCursor:z.string().nullable().optional(),hasMore:z.boolean().optional(),success:z.boolean().optional()}).parse(payload);
  if(result.success===false)throw new FeedError('UPSTREAM_REJECTED');
  if(result.hasMore&&!result.nextCursor)throw new FeedError('MISSING_CONTINUATION');
  if(result.nextCursor&&result.nextCursor===cursor)throw new FeedError('REPEATED_CURSOR');
  if(feed.provider==='himalayas'){
    const position=cursor?JSON.parse(cursor):{query:0,page:1};
    return {jobs:result.jobs,next:result.jobs.length?JSON.stringify({...position,page:position.page+1}):position.query<2?JSON.stringify({query:position.query+1,page:1}):null};
  }
  return {jobs:result.jobs,next:result.nextCursor??null};
}
