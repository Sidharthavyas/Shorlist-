import defaults from '../../../config/defaults.json';
import type { ExperienceAnalysis, NormalizedJob } from '../../../contracts/domain';

export const DEFAULTS = defaults;
export type Settings = typeof defaults;
export function plain(value: string): string {
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/(?:p|li|div|h\d)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, x => ({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x] ?? x)).replace(/&#(\d+);/g, (_,n) => String.fromCodePoint(Math.min(0x10ffff,Number(n)))).trim();
}
export function safeUrl(input: string | null | undefined): string | null {
  try { const u = new URL(input ?? ''); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function canonicalUrl(input: string | null): string | null {
  const valid = safeUrl(input); if (!valid) return null;
  const u = new URL(valid); u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(k)) u.searchParams.delete(k);
  u.searchParams.sort(); return u.href.replace(/\/$/, '');
}
export const roleAllowed = (title: string, settings: Settings = DEFAULTS): boolean => {
  if (settings.excluded_title_terms.some(term => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(title))) return false;
  return settings.preferred_roles.some(role => title.toLowerCase().includes(role.toLowerCase())) || /\b(software|back.?end|front.?end|full.?stack|web|application|api|java|python|node\.?js|react|mobile|ios|swift|ai|llm|rag|platform|automation|integration)\b.*\b(engineer|developer|sde)\b|\bsde\s*[-–]?(?:[12]|i{1,2})?\b/i.test(title);
};

export function experience(job: Pick<NormalizedJob,'title'|'seniority'|'description'|'requirements'|'preferred_qualifications'|'experience_min'|'experience_max'>, cap = 2, settings: Settings = DEFAULTS): ExperienceAnalysis {
  cap = Math.min(2, cap);
  const evidence: ExperienceAnalysis['evidence'] = [];
  const result = (classification: ExperienceAnalysis['classification'], reason: string, min: number|null = null, max: number|null = null): ExperienceAnalysis => ({ classification, min_years:min, max_years:max, confidence: classification === 'REVIEW_REQUIRED' ? 0.5 : 0.96, reason, evidence, parser_version:'deterministic-1' });
  if (!roleAllowed(job.title,settings) || /\b(senior|staff|principal|lead|director|manager)\b/i.test(job.seniority ?? '')) return result('NOT_ELIGIBLE','Title or seniority is outside the configured development roles.');
  if ((job.experience_min ?? 0) > cap || (job.experience_max ?? 0) > cap) return result('NOT_ELIGIBLE','Structured experience exceeds the hard maximum.',job.experience_min,job.experience_max);
  let known = job.experience_max !== null || job.experience_min !== null;
  let min = job.experience_min ?? 0, max = job.experience_max ?? job.experience_min ?? 0;
  let ambiguous = false;
  const sections = [
    ...job.requirements.map(text => ({text,field:'requirements',preferred:false})),
    ...job.preferred_qualifications.map(text => ({text,field:'preferred_qualifications',preferred:true})),
    ...plain(job.description).split(/\n|[.;](?=\s)/).map(text => ({text,field:'description',preferred:false}))
  ];
  for (const section of sections) {
    const text = section.text.toLowerCase().replace(/[–—−]/g,'-').replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, x => String(['zero','one','two','three','four','five','six','seven','eight','nine','ten'].indexOf(x)));
    if (/no (?:prior )?(?:professional |industry |work )?experience (?:is )?(?:required|necessary)|fresh (?:graduates|graduates are)|freshers|no prior industry experience required/i.test(text)) { known = true; evidence.push({field:section.field,quote:section.text,mandatory:true}); }
    const preferred = section.preferred || /preferred|nice.to.have|bonus|advantage|plus but not required/.test(text);
    const patterns = /\b(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?)\s*)?(\+|or more)?\s*(years?|yrs?|months?)\b/g;
    for (const m of text.matchAll(patterns)) {
      // Experience numbers require an experience/development context, not degree or company age.
      const context = text.slice(Math.max(0,m.index!-65),m.index!+m[0].length+100);
      if(section.field==='description' && /\b(?:we|our company|our team)\b.{0,40}(?:have|has|bring|with|over)/.test(text.slice(0,m.index!)) && !/you|candidate|required|minimum qualification/.test(context))continue;
      if (section.field==='description' && !/experience|professional|development|engineering|worked|working/.test(context) && !/^\s*(?:(?:minimum|at least|up to|over)\s*)?\d/.test(text) && !preferred && !skills(context).length) continue;
      if (/degree|graduation|founded|company.{0,20}(?:history|operat)|history|business/.test(context) && !/years?\s+(?:of\s+)?(?:professional\s+|relevant\s+)?experience/.test(context)) continue;
      const divisor = m[4].startsWith('month') ? 12 : 1;
      const lo = Number(m[1])/divisor, hi = Number(m[2] ?? m[1])/divisor, plus = Boolean(m[3]) || /(?:at least|minimum|more than|over)\s*$/.test(text.slice(Math.max(0,m.index!-20),m.index!));
      evidence.push({field:section.field,quote:section.text,mandatory:!preferred});
      if (!preferred && (hi > cap || lo > cap || (plus && lo >= cap))) return result('NOT_ELIGIBLE',`Required experience exceeds ${cap} years or has an open-ended ${cap}+ requirement.`,lo,hi);
      if (preferred && (hi > cap || plus)) { ambiguous = true; continue; }
      known = true; min = Math.max(min,lo); max = Math.max(max,hi);
    }
  }
  if (ambiguous) return result('REVIEW_REQUIRED','Preferred experience is above the cap or open-ended; review the original requirements.',min,max);
  if (!known) return result('REVIEW_REQUIRED','No clear numeric or no-experience requirement was found.');
  return result('ELIGIBLE',`The available experience evidence fits the ${cap}-year maximum.`,min,max);
}

export function location(job: NormalizedJob, settings: Settings = DEFAULTS): {status:string; reason:string} {
  if(job.timezone_compatible===false)return {status:'INCOMPATIBLE',reason:'The published timezone restrictions exclude India (UTC+05:30).'};
  if (job.remote_type === 'ONSITE') return {status:settings.location.onsite ? 'COMPATIBLE':'INCOMPATIBLE',reason:'On-site preference'};
  if (job.remote_type === 'HYBRID') return {status:settings.location.hybrid ? 'COMPATIBLE':'INCOMPATIBLE',reason:'Hybrid preference'};
  const countries = job.allowed_countries?.map(x=>x.toLowerCase());
  if (countries?.length && !countries.some(x=>['in','ind','india','worldwide','anywhere','global'].includes(x))) return {status:'INCOMPATIBLE',reason:'Remote role is restricted to other countries.'};
  if (job.remote_type === 'WORLDWIDE_REMOTE' && settings.location.worldwide_remote) return {status:'COMPATIBLE',reason:'Explicit worldwide remote eligibility.'};
  if ((job.remote_type === 'INDIA_REMOTE' || countries?.some(x=>['in','ind','india'].includes(x))) && settings.location.india_remote && job.remote_type !== 'UNKNOWN') return {status:'COMPATIBLE',reason:'Remote role explicitly accepts India.'};
  return {status:'REVIEW_REQUIRED',reason:'Remote geographic eligibility is not explicit.'};
}

const aliases: Record<string,string[]> = {
  Python:['python'],FastAPI:['fastapi'], 'Node.js':['node.js','nodejs','node js'],Java:['java'],Spring:['spring framework','spring'], 'Spring Boot':['spring boot','spring-boot'],
  React:['react.js','reactjs','react'],JavaScript:['javascript'],TypeScript:['typescript'],Swift:['swift'],SwiftUI:['swiftui'],iOS:['ios'],
  'Next.js':['next.js','nextjs','next js'],Express:['express.js','expressjs','express js'],Kotlin:['kotlin'],'React Native':['react native'],Cloudflare:['cloudflare workers','cloudflare'],Webhooks:['webhook','webhooks'],n8n:['n8n'],Pabbly:['pabbly'],LangGraph:['langgraph'],Git:['git'],CI:['github actions','continuous integration'],
  HTML:['html','html5'],CSS:['css','css3'],Angular:['angular','angularjs'],Vue:['vue','vue.js','vuejs'],Svelte:['svelte'],Django:['django'],Flask:['flask'],'NestJS':['nestjs','nest.js'],PHP:['php'],Go:['golang','go programming','go language'],Rust:['rust'],Ruby:['ruby'],Rails:['ruby on rails'],GraphQL:['graphql'],Kafka:['kafka'],Kubernetes:['kubernetes','k8s'],'.NET':['.net','dotnet'],'C#':['c#','csharp'],'C++':['c++'],
  PostgreSQL:['postgresql','postgres'],MySQL:['mysql'],SQLite:['sqlite'],SQL:['sql'],MongoDB:['mongodb'],DynamoDB:['dynamodb'],Redis:['redis'],AWS:['aws','amazon web services'],Docker:['docker'],
  LLM:['llm','llms','large language model','large language models'],RAG:['rag','retrieval augmented generation','retrieval-augmented generation'],'Generative AI':['generative ai','genai'],Embeddings:['embeddings'], 'Vector search':['vector search'], 'REST APIs':['rest api','rest apis','restful'],Microservices:['microservices']
};
export function skills(text: string): string[] {
  return Object.entries(aliases).filter(([,names])=>names.some(name=>new RegExp(`(?:^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^a-z0-9])`,'i').test(text))).map(([name])=>name);
}
export const MATCH_ENGINE='patterns-2';
const families:Record<string,RegExp>={Backend:/\b(back.?end|api|fastapi|node\.?js|python|java|express|server.side)\b/i,Frontend:/\b(front.?end|react|next\.?js|javascript|typescript|ui engineer)\b/i,'Full stack':/\bfull.?stack\b/i,Automation:/\b(automation|integration|webhooks?|n8n|pabbly)\b/i,Mobile:/\b(mobile|ios|android|swift|kotlin|react native)\b/i,AI:/\b(ai|llm|rag|generative|langgraph|machine learning)\b/i,Software:/\b(software|sde|application|platform)\b/i};
export function rolePatterns(text:string){return Object.entries(families).filter(([,pattern])=>pattern.test(text)).map(([name])=>name);}
export function match(job: NormalizedJob, profileSkills: string[], settings: Settings = DEFAULTS, profileContext='') {
  const e = experience(job,settings.maximum_experience,settings), l = location(job,settings);
  if (e.classification !== 'ELIGIBLE' || l.status !== 'COMPATIBLE' || job.availability !== 'OPEN') return null;
  const wanted = skills(Object.values(settings.preferred_technologies).flat().join(' '));
  const matching = job.skills.filter(x=>wanted.includes(x));
  const profile = skills(profileSkills.join(' '));
  const missing = job.skills.filter(x=>!profile.includes(x));
  const age = Math.max(0,(Date.now()-Date.parse(job.posted_at ?? job.first_seen_at))/86400000);
  const role=rolePatterns(job.title),candidate=rolePatterns(profileContext+' '+profile.join(' '));
  const shared=role.filter(f=>candidate.includes(f)),verified=job.skills.filter(x=>profile.includes(x));
  const breakdown={role:shared.length?20:role.some(f=>rolePatterns(settings.preferred_roles.join(' ')).includes(f))?14:8,experience:15,stack:Math.round(30*matching.length/Math.max(1,job.skills.length)),location:5,resume:Math.round(25*verified.length/Math.max(1,job.skills.length)),freshness:age<=1?5:age<=3?3:age<=7?1:0};
  const pattern_evidence=[...role.map(pattern=>({pattern,field:'title',quote:job.title})),...verified.map(pattern=>({pattern,field:'verified_skill',quote:pattern}))];
  return {score:Object.values(breakdown).reduce((a,b)=>a+b,0),breakdown,matching_skills:matching,verified_matching_skills:verified,missing_skills:missing,role_patterns:role,shared_role_patterns:shared,pattern_evidence,engine_version:MATCH_ENGINE,reason:`${shared.length?shared.join(', ')+' role patterns match your profile. ':''}${verified.length} of ${job.skills.length} detected technologies match verified skills; ${matching.length} match search preferences. ${e.reason} ${l.reason}`};
}
