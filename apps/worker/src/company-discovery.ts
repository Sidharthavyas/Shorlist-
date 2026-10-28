export interface CompanyInput {id:string;name:string;url:string;}
export interface BoardMatch {provider:string;board:string;site?:string;host?:string;url:string;}
export function publicUrl(value:string,base?:string){
 try{const u=new URL(value,base);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!u.hostname.includes('.')||/^[\d.]+$/.test(u.hostname)||/[:\[\]]/.test(u.hostname)||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(u.hostname))return null;return u;}catch{return null;}
}
export function boardsIn(value:string):BoardMatch[]{
 const found=new Map<string,BoardMatch>();const decoded=value.replace(/\\u002f/gi,'/').replace(/\\\//g,'/').replace(/&amp;|&#38;/g,'&').replace(/&quot;|&#34;/g,'"');
 const urls=decoded.match(/https?:\/\/[^\s<>"'\\)]+/gi)??[];
 for(const raw of urls){const u=publicUrl(raw);if(!u)continue;const pieces=u.pathname.split('/').filter(Boolean);let provider='',board='',site:string|undefined,host:string|undefined;
  if(/^(?:(?:job-)?boards(?:\.eu)?|job-boards)\.greenhouse\.io$/.test(u.hostname)){provider='greenhouse';board=pieces[0]==='embed'?u.searchParams.get('for')??'':pieces[0]??'';if(u.hostname.includes('.eu.'))host='boards-api.greenhouse.io';}
  else if(/^boards-api(?:\.eu)?\.greenhouse\.io$/.test(u.hostname)&&pieces[0]==='v1'&&pieces[1]==='boards'){provider='greenhouse';board=pieces[2]??'';host=u.hostname;}
  else if(/^api(?:\.eu)?\.lever\.co$/.test(u.hostname)&&pieces[0]==='v0'&&pieces[1]==='postings'){provider='lever';board=pieces[2]??'';host=u.hostname;}
  else if(u.hostname==='api.ashbyhq.com'&&pieces[0]==='posting-api'&&pieces[1]==='job-board'){provider='ashby';board=pieces[2]??'';}
  else if(/^jobs(?:\.eu)?\.lever\.co$/.test(u.hostname)){provider='lever';board=pieces[0]??'';if(u.hostname.includes('.eu.'))host='api.eu.lever.co';}
  else if(u.hostname==='jobs.ashbyhq.com'){provider='ashby';board=pieces[0]??'';}
  else if(/^(?:careers|jobs)\.smartrecruiters\.com$/.test(u.hostname)){provider='smartrecruiters';board=pieces[0]??'';}
  else if(/^(?:apply|jobs)\.workable\.com$/.test(u.hostname)){provider='workable';board=pieces[0]??'';}
  else if(u.hostname.endsWith('.recruitee.com')){provider='recruitee';board=u.hostname.split('.')[0];}
  else {const workday=u.hostname.match(/^([a-z0-9_-]+)\.wd\d+\.myworkdayjobs\.com$/i);if(workday){provider='workday';board=workday[1];site=pieces[/^[a-z]{2}-[a-z]{2}$/i.test(pieces[0]??'')?1:0];host=u.hostname;}}
  if(provider&&/^[a-zA-Z0-9_-]{1,100}$/.test(board)&&(!site||/^[a-zA-Z0-9_-]{1,100}$/.test(site))&&(provider!=='workday'||site)){const match={provider,board,site,host,url:u.href};found.set(provider+':'+board+':'+(site??''),match);}
 }
 return [...found.values()];
}
export function jobPostings(html:string):Record<string,unknown>[] {
 const rows:Record<string,unknown>[]=[];
 const visit=(value:unknown,depth=0)=>{if(depth>8||rows.length>=1000||!value||typeof value!=='object')return;if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}const node=value as Record<string,unknown>;if([node['@type']].flat().includes('JobPosting'))rows.push(node);else for(const key of ['@graph','itemListElement','item','mainEntity'])visit(node[key],depth+1);};
 for(const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{visit(JSON.parse(script[1]));}catch{}}
 return rows;
}
export function careerLinks(html:string,base:string){
 const root=new URL(base),links=new Map<string,string>();
 for(const tag of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  const u=publicUrl(tag[1].replace(/&amp;/g,'&'),base);if(!u)continue;const label=tag[2].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  if(u.hostname===root.hostname&&(/jobs?|careers?|openings?|positions?/i.test(u.pathname)||/open positions|view jobs|current openings/i.test(label))&&u.href!==root.href){u.hash='';links.set(u.href,label);}
 }
 return [...links].slice(0,60).map(([url,title])=>({url,title}));
}
export async function careerPage(value:string,fetcher:typeof fetch=fetch){
 let u=publicUrl(value);if(!u)throw Error('INVALID_CAREERS_URL');
 for(let i=0;i<5;i++){
  const r=await fetcher(u,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'Shortlist-Personal-Job-Discovery/1.0'},redirect:'manual',signal:AbortSignal.timeout(12000)});
  if([301,302,303,307,308].includes(r.status)){const next=publicUrl(r.headers.get('Location')??'',u.href);await r.body?.cancel();if(!next)throw Error('INVALID_REDIRECT');u=next;continue;}
  if(!r.ok){await r.body?.cancel();throw Error('HTTP_'+r.status);}
  const reader=r.body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];
  if(reader){try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>5*1024*1024)throw Error('PAGE_TOO_LARGE');chunks.push(part.value);}}finally{await reader.cancel();}}
  const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  return {url:u.href,html:new TextDecoder().decode(data)};
 }
 throw Error('TOO_MANY_REDIRECTS');
}
export async function discoverCompany(company:CompanyInput,fetcher:typeof fetch=fetch){
 const checkedAt=new Date().toISOString();
 try{
  const first=await careerPage(company.url,fetcher);let boards=boardsIn(first.url+' '+first.html),postings=jobPostings(first.html);const pages=[first];
  if(!boards.length&&!postings.length){const links=careerLinks(first.html,first.url).filter(link=>/jobs|positions|openings|opportunit|search/i.test(link.title+' '+link.url)).slice(0,2);
   for(const link of links){try{const page=await careerPage(link.url,fetcher);pages.push(page);boards.push(...boardsIn(page.url+' '+page.html));postings.push(...jobPostings(page.html));if(boards.length||postings.length)break;}catch{}}
  }
  return {companyId:company.id,checkedAt,status:boards.length?'BOARD_FOUND':postings.length?'STRUCTURED_JOBS':'MANUAL',boards:boards.slice(0,5),jobPage:postings.length?pages.find(page=>jobPostings(page.html).length)?.url:null,jobCount:postings.length,error:null};
 }catch(error){return {companyId:company.id,checkedAt,status:'BLOCKED',boards:[],jobPage:null,jobCount:0,error:error instanceof Error&&/^(HTTP_\d+|PAGE_TOO_LARGE|TOO_MANY_REDIRECTS|INVALID_[A-Z_]+)$/.test(error.message)?error.message:'FETCH_FAILED'};}
}
