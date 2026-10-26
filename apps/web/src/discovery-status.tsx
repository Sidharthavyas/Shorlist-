import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe2, FileText } from 'lucide-react';
export function DiscoveryStatus() {
 const [state,setState]=useState<any>(null);
 useEffect(()=>{let active=true;const load=async()=>{try{const r=await fetch('/api/v1/summary');if(r.ok){const result=await r.json() as any;if(active)setState(result.data);}}catch{}};load();const timer=setInterval(load,4000);window.addEventListener('refresh-data',load);return()=>{active=false;clearInterval(timer);window.removeEventListener('refresh-data',load);};},[]);
 if(!state)return null;
 const sources=state.sources??[state.source].filter(Boolean),running=sources.some((s:any)=>s.lease_token||s.cursor),errors=sources.filter((s:any)=>s.last_error_code).length;
 const completed=sources.filter((s:any)=>s.last_completed_at).length;
 return <div className="setup-status"><section><Globe2 size={18}/><div><strong>{running?'Checking jobs across your sources…':completed?'Latest discovery results':'Fetch real opportunities'}</strong><p>{state.jobs.total?`${state.jobs.total} real jobs stored · ${state.jobs.eligible} eligible · ${state.review_count} need review. ${completed}/${sources.length} feeds completed${errors?' · '+errors+' need attention':''}.`:'Click Sync real jobs. Demo jobs are hidden, and resume upload is not required for discovery.'}</p>{state.review_count>0&&<Link to="/review">Optional: view uncertain listings →</Link>}</div></section><section><FileText size={18}/><div><strong>{state.onboarding?.profile_ready?'Verified profile ready':state.onboarding?.has_uploaded_resume?'Resume uploaded — profile needs verification':'Set up your resume profile'}</strong><p>{state.onboarding?.profile_ready?'You can generate a factual resume from an eligible job.':state.onboarding?.has_uploaded_resume?'Import your uploaded resume, review the details, then save your verified profile.':'Upload a master resume, or enter your verified details manually.'}</p><Link to="/settings?tab=profile">{state.onboarding?.profile_ready?'Edit verified profile':'Import & verify profile'} →</Link></div></section></div>;
}
