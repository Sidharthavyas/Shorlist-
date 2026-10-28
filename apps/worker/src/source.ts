import { z } from 'zod';
import type { NormalizedJob } from '../../../contracts/domain';
import { plain, safeUrl, skills } from './domain';

const wire = z.object({
  public_slug:z.string().min(1), external_id:z.string().optional(), source:z.string().optional(),
  title:z.string().min(1), company:z.string().nullish(), description:z.string().default(''),
  url:z.string(), location:z.string().default(''), work_mode:z.string().optional(),
  countries:z.array(z.string()).default([]), regions:z.array(z.string()).default([]), skills:z.array(z.string()).default([]),
  posted_at:z.string().nullable().optional(), closed_at:z.string().nullable().optional(),
  experience_years:z.number().nullable().optional(), experience_years_min:z.number().nullable().optional(), experience_years_max:z.number().nullable().optional(),
  seniority:z.string().nullable().optional(),
  salary_min:z.number().nullable().optional(),salary_max:z.number().nullable().optional(),salary_currency:z.string().nullable().optional(),salary_period:z.string().nullable().optional(),
  enrichment:z.object({requirements:z.array(z.object({text:z.string(),priority:z.string()})).default([]),seniority:z.string().optional(),employment_type:z.string().optional()}).optional()
});
export function normalize(raw: unknown, now = new Date().toISOString()): NormalizedJob {
  const r = wire.parse(raw), description = plain(r.description);
  const text = `${r.location} ${description}`;
  const mode = r.work_mode?.toLowerCase();
  const remote = mode === 'remote' || /\bremote\b/i.test(r.location);
  const worldwide = remote && /worldwide|anywhere in the world|remote.{0,15}global|global.{0,15}remote/i.test(text);
  const india = remote && (r.countries.includes('in') || /\bindia\b/i.test(r.location));
  return {
    external_id:r.public_slug,public_slug:r.public_slug,source:'freehire',company:r.company?.trim()||'Company not provided',title:r.title,description,
    requirements:r.enrichment?.requirements.filter(x=>x.priority==='required').map(x=>x.text) ?? [],
    preferred_qualifications:r.enrichment?.requirements.filter(x=>x.priority==='preferred').map(x=>x.text) ?? [],
    location:r.location, remote_type:mode==='hybrid'?'HYBRID':mode==='onsite'||mode==='on_site'?'ONSITE':worldwide?'WORLDWIDE_REMOTE':india?'INDIA_REMOTE':remote?'REMOTE':'UNKNOWN',
    allowed_countries:r.countries.length?r.countries:null,job_url:`https://freehire.me/jobs/${encodeURIComponent(r.public_slug)}`,
    apply_url:safeUrl(r.url),posted_at:r.posted_at ?? null,first_seen_at:now,
    experience_min:r.experience_years_min ?? r.experience_years ?? null,experience_max:r.experience_years_max ?? r.experience_years ?? null,
    skills:skills(`${r.skills.join(' ')} ${description} ${r.enrichment?.requirements.map(x=>x.text).join(' ') ?? ''}`),salary:r.salary_currency?{min:r.salary_min ?? null,max:r.salary_max ?? null,currency:r.salary_currency,period:r.salary_period ?? 'unknown'}:null,
    employment_type:r.enrichment?.employment_type ?? null,seniority:r.seniority ?? r.enrichment?.seniority ?? null,availability:r.closed_at?'CLOSED':'OPEN'
  };
}
export class UpstreamError extends Error { constructor(public status:number,public retryAfter:number) { super(`FreeHire returned ${status}`); } }
export async function fetchPage(key: string|undefined, offset: number, days: number) {
  const url = new URL('https://freehire.me/api/v1/agent/jobs/search');
  url.search = new URLSearchParams({open_within_days:String(days),limit:'20',offset:String(offset),category:'backend,frontend,fullstack,mobile',work_mode:'remote',experience_years_max:'2',experience_include_unspecified:'true'}).toString();
  const response = await fetch(url,{headers:key?{Authorization:`Bearer ${key}`}:{},signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new UpstreamError(response.status,Math.max(60,Number(response.headers.get('Retry-After'))||60));
  const page = z.object({data:z.array(z.unknown()),meta:z.object({total:z.number(),limit:z.number(),offset:z.number()})}).parse(await response.json());
  return {...page,rate_remaining:response.headers.has('X-RateLimit-Remaining')?Number(response.headers.get('X-RateLimit-Remaining')):null,rate_reset:response.headers.get('X-RateLimit-Reset')};
}

