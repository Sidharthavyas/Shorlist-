import { unzipSync, strFromU8 } from 'fflate';
import { groupedEntries, referencePdf, RESUME_TEMPLATE } from './resume-layout';
import { referenceDocx } from './resume-docx';
import { spatialResumeText, formattedPdf } from './resume-extract';
import { Hono } from 'hono';
import type { Env } from './env';
import { OWNER } from './env';
import { hash, now } from './store';
import { skills } from './domain';
import { resumeDraft, mergeResumeDraft } from './profile-import';

export interface Profile {name:string;email:string;phone?:string;location?:string;linkedin?:string;github?:string;portfolio?:string;headline?:string;professional_summary?:string;skill_groups?:string[];skills:string[];education:string[];experience:string[];projects:string[];verified_bullets:string[];}
export function tailor(profile:Profile, jobSkills:string[]) {
  if(!profile.name?.trim() || !profile.email?.trim() || !(profile.verified_bullets?.length || profile.projects?.length || profile.experience?.length)) throw new Error('PROFILE_INCOMPLETE');
  const rank=(text:string)=>skills(text).filter(x=>jobSkills.includes(x)).length;
  const sort=(list:string[])=>[...(list ?? [])].sort((a,b)=>rank(b)-rank(a));
  return {name:profile.name,subtitle:[profile.headline,profile.location].filter(Boolean).join(' | '),contact:[profile.phone,profile.email,profile.linkedin,profile.github,profile.portfolio].filter(Boolean).map(x=>x!.replace(/^https?:\/\//,'')).join(' | '),sections:[
    {title:'Professional Summary',lines:profile.professional_summary?[profile.professional_summary]:[]},
    {title:'Experience',lines:groupedEntries(profile.experience ?? [])},
    {title:'Projects',lines:sort(groupedEntries(profile.projects ?? []))},
    {title:'Selected Achievements',lines:sort(profile.verified_bullets)},
    {title:'Technical Skills',lines:profile.skill_groups?.length?profile.skill_groups:[(profile.skills ?? []).join(', ')].filter(Boolean)},
    {title:'Education',lines:profile.education ?? []}
  ].filter(s=>s.lines.length)};
}
export const renderPdf=referencePdf;
export const renderDocx=referenceDocx;

export async function generateResume(env:Env,taskId:string) {
  const task=await env.DB.prepare("UPDATE tasks SET state='RUNNING',lease_until=?,attempts=attempts+1 WHERE id=? AND (state='PENDING' OR (state='RUNNING' AND lease_until<?)) RETURNING *").bind(new Date(Date.now()+120000).toISOString(),taskId,now()).first<{entity_id:string;entity_revision:number;idempotency_key:string;attempts:number}>();
  if(!task)return;
  try {
    const version=await env.DB.prepare('SELECT * FROM resume_versions WHERE idempotency_key=? AND user_id=?').bind(task.idempotency_key,OWNER).first<{id:string;profile_revision:number;job_revision:number}>();
    const job=await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(task.entity_id).first<{normalized_json:string;company:string;title:string;revision:number}>();
    const p=await env.DB.prepare('SELECT * FROM profiles WHERE user_id=?').bind(OWNER).first<{data_json:string;revision:number}>();
    if(!job||!version||!p||p.revision!==version.profile_revision||job.revision!==version.job_revision)throw new Error('STALE_INPUT');
    const profile=JSON.parse(p.data_json) as Profile;const content=tailor(profile,JSON.parse(job.normalized_json).skills ?? []);
    const pdf=await renderPdf(content),docx=renderDocx(content);
    const path=`resumes/${new Date().getUTCFullYear()}/${String(new Date().getUTCMonth()+1).padStart(2,'0')}/${job.company.replace(/[^a-z0-9-]/gi,'-')}/${version.id}`;
    await Promise.all([env.FILES.put(`${path}.pdf`,pdf,{httpMetadata:{contentType:'application/pdf'}}),env.FILES.put(`${path}.docx`,docx,{httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}})]);
    const original:Record<string,string[]>={'Professional Summary':profile.professional_summary?[profile.professional_summary]:[],'Technical Skills':profile.skill_groups?.length?profile.skill_groups:[profile.skills.join(', ')],Skills:profile.skills,Experience:groupedEntries(profile.experience ?? []),Projects:groupedEntries(profile.projects ?? []),'Selected Achievements':profile.verified_bullets,Education:profile.education};
    const diff={strategy:'Selection and ordering of verified facts only',sections:content.sections.map(s=>({title:s.title,before:original[s.title] ?? [],after:s.lines,reordered:JSON.stringify(original[s.title])!==JSON.stringify(s.lines)})),fabricated_claims:0};
    await env.DB.batch([
      env.DB.prepare("UPDATE resume_versions SET state='READY',pdf_key=?,docx_key=?,content_hash=?,content_json=?,changes_json=? WHERE id=?").bind(`${path}.pdf`,`${path}.docx`,await hash(JSON.stringify(content)),JSON.stringify(content),JSON.stringify(diff),version.id),
      env.DB.prepare("UPDATE tasks SET state='READY',updated_at=?,result_json=? WHERE id=?").bind(now(),JSON.stringify({resume_version_id:version.id}),taskId),
      env.DB.prepare('UPDATE outbox SET completed_at=? WHERE task_id=?').bind(now(),taskId)
    ]);
  } catch(error) {
    const code=error instanceof Error && ['PROFILE_INCOMPLETE','STALE_INPUT'].includes(error.message)?error.message:'RENDER_FAILED';
    const state=code==='RENDER_FAILED' && task.attempts<3?'PENDING':'FAILED';
    await env.DB.batch([env.DB.prepare('UPDATE tasks SET state=?,error_code=?,updated_at=? WHERE id=?').bind(state,code,now(),taskId),env.DB.prepare('UPDATE resume_versions SET state=? WHERE idempotency_key=? AND user_id=?').bind(state,task.idempotency_key,OWNER)]);
    throw error;
  }
}
export const resumes=new Hono<{Bindings:Env}>();
resumes.post('/profile/import-resume',async c=>{
  const input=await c.req.json() as {resume_version_id?:string};
  if(input.resume_version_id!==undefined&&(typeof input.resume_version_id!=='string'||input.resume_version_id.length>200))return c.json({error:{code:'INVALID_INPUT',message:'Choose a valid master resume.'}},400);
  const row=await c.env.DB.prepare(`SELECT v.id,v.content_json,v.original_key FROM resume_versions v JOIN resumes r ON r.id=v.resume_id WHERE r.user_id=? AND r.kind='MASTER' AND r.deleted_at IS NULL ${input.resume_version_id?'AND v.id=?':''} ORDER BY v.created_at DESC,v.id LIMIT 1`).bind(OWNER,...(input.resume_version_id?[input.resume_version_id]:[])).first<{id:string;content_json:string;original_key:string}>();
  if(!row)return c.json({error:{code:'NO_MASTER_RESUME',message:'Upload a PDF or DOCX master resume first.'}},422);
  const content=JSON.parse(row.content_json);
  if(!content.formatted_text&&row.original_key?.endsWith('.pdf')){try{const original=await c.env.FILES.get(row.original_key);if(original)content.formatted_text=await formattedPdf(new Uint8Array(await original.arrayBuffer()));}catch{/* Existing extracted text remains available for review. */}}
  if(!content.extracted_text?.trim())return c.json({error:{code:'NO_EXTRACTED_TEXT',message:content.parse_error ?? 'No readable text was extracted. Try a text-based PDF or DOCX, or enter profile details manually.'}},422);
  const profile=await c.env.DB.prepare('SELECT data_json,revision FROM profiles WHERE user_id=?').bind(OWNER).first<{data_json:string;revision:number}>();
  const draft=mergeResumeDraft(JSON.parse(profile?.data_json ?? '{}'),resumeDraft(content.formatted_text ?? content.extracted_text));
  return c.json({data:{draft:{...draft,revision:profile?.revision ?? 1},source_version_id:row.id,source_filename:content.filename,extracted_text:content.extracted_text,verification_required:true}});
});
resumes.get('/resumes',async c=>c.json({data:(await c.env.DB.prepare('SELECT r.*,v.id version_id,v.version,v.state,v.pdf_key,v.docx_key,v.original_key,v.changes_json,j.company,j.title FROM resumes r JOIN resume_versions v ON v.resume_id=r.id LEFT JOIN jobs j ON j.id=r.job_id WHERE r.user_id=? AND r.deleted_at IS NULL ORDER BY r.created_at DESC').bind(OWNER).all()).results}));
resumes.post('/profile/uploads',async c=>{
  const form=await c.req.formData(),file=form.get('file');
  if(!(file instanceof File)||file.size>3.5*1024*1024||!file.size)return c.json({error:{code:'INVALID_FILE',message:'Upload a PDF or DOCX under 3.5 MB.'}},400);
  const bytes=new Uint8Array(await file.arrayBuffer());const pdf=strFromU8(bytes.slice(0,5))==='%PDF-',docx=bytes[0]===0x50&&bytes[1]===0x4b&&file.name.toLowerCase().endsWith('.docx');
  if(!pdf&&!docx)return c.json({error:{code:'INVALID_FILE',message:'The file must be a PDF or DOCX.'}},400);
  const digest=await hash([...bytes].join(',')),exists=await c.env.DB.prepare('SELECT id FROM resume_versions WHERE user_id=? AND idempotency_key=?').bind(OWNER,`master:${digest}`).first();
  if(exists)return c.json({data:exists});
  const id=crypto.randomUUID(),v=crypto.randomUUID(),key=`profile/${id}/master-resume.${pdf?'pdf':'docx'}`;
  let extracted='';
  let formatted='';
  let parseError:string|null=null;
  if(pdf) {
    try {
      const {getDocumentProxy,extractText}=await import('unpdf');
      const proxy=await getDocumentProxy(bytes.slice());
      const release=async()=>{if('destroy' in proxy && typeof proxy.destroy==='function')await proxy.destroy();};
      if(proxy.numPages>20){await release();parseError='Resume exceeds the 20-page extraction limit.';}
      else {
        const result=await extractText(proxy,{mergePages:true});extracted=(Array.isArray(result.text)?result.text.join('\n'):result.text).slice(0,100000);
        const pages=[];
        for(let n=1;n<=proxy.numPages;n++){const page=await proxy.getPage(n);const text=await page.getTextContent();pages.push(spatialResumeText(text.items.filter((x):x is typeof x & {str:string;transform:number[];fontName:string;height:number;width:number}=>'str' in x)));}
        formatted=pages.map(p=>p.formatted).join('\n').slice(0,150000);await release();
      }
    } catch {parseError='Text extraction failed. For scanned or encrypted PDFs, enter and verify profile facts manually.';}
  }
  if(docx) {
    const entries=unzipSync(bytes,{filter:entry=>entry.name==='word/document.xml' && entry.originalSize<2*1024*1024});
    const document=entries['word/document.xml'];if(!document)return c.json({error:{code:'INVALID_DOCX',message:'DOCX is missing its document or is too large to parse.'}},400);
    extracted=strFromU8(document).replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  }
  await c.env.FILES.put(key,bytes,{httpMetadata:{contentType:pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}});
  await c.env.DB.batch([c.env.DB.prepare("INSERT INTO resumes(id,user_id,kind,created_at) VALUES(?,?,'MASTER',?)").bind(id,OWNER,now()),c.env.DB.prepare("INSERT INTO resume_versions(id,resume_id,user_id,version,state,original_key,content_hash,content_json,idempotency_key,created_at) VALUES(?,?,?,1,'READY',?,?,?,?,?)").bind(v,id,OWNER,key,digest,JSON.stringify({filename:file.name,extracted_text:extracted,formatted_text:formatted||undefined,parse_error:parseError,suggested_skills:skills(extracted),verified:false}),`master:${digest}`,now())]);
  return c.json({data:{id,resume_version_id:v,extracted_text:extracted,verification_required:true,message:pdf?'PDF stored. Enter and verify facts in your profile before tailoring.':'DOCX text extracted. Verify facts in your profile before tailoring.'}},201);
});
resumes.post('/jobs/:id/resume-tasks',async c=>{
  // Recommendation eligibility controls discovery, not owner-requested tailoring.
  // The background renderer uses the same catalog lookup and revision checks.
  const job=await c.env.DB.prepare('SELECT id,revision FROM jobs WHERE id=?').bind(c.req.param('id')).first<{id:string;revision:number}>();
  if(!job)return c.json({error:{code:'NOT_FOUND',message:'Job not found.'}},404);
  const profile=await c.env.DB.prepare('SELECT data_json,revision FROM profiles WHERE user_id=?').bind(OWNER).first<{data_json:string;revision:number}>();
  try{tailor(JSON.parse(profile?.data_json ?? '{}'),[]);}catch{return c.json({error:{code:'PROFILE_INCOMPLETE',message:'Add your name, email and verified projects, experience, or achievements in Settings first.'}},422);}
  const key=`tailor:${job.id}:${job.revision}:${profile!.revision}:${RESUME_TEMPLATE}`;
  const prior=await c.env.DB.prepare('SELECT * FROM tasks WHERE user_id=? AND idempotency_key=?').bind(OWNER,key).first<{id:string;state:string}>();
  if(prior) {
    if(prior.state==='FAILED'){await c.env.DB.prepare("UPDATE tasks SET state='PENDING',error_code=NULL WHERE id=?").bind(prior.id).run();c.executionCtx.waitUntil(generateResume(c.env,prior.id));}
    return c.json({data:{task_id:prior.id,state:prior.state,message:prior.state==='READY'?'This version is already in your resume library.':'Resume generation is queued.'}},202);
  }
  const id=await hash(`resume:${key}`),v=await hash(`version:${key}`),task=await hash(`task:${key}`),t=now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO resumes(id,user_id,job_id,kind,created_at) VALUES(?,?,?,'TAILORED',?)").bind(id,OWNER,job.id,t),
    c.env.DB.prepare("INSERT OR IGNORE INTO resume_versions(id,resume_id,user_id,version,state,profile_revision,job_revision,template_version,idempotency_key,created_at) VALUES(?,?,?,1,'PENDING',?,?,?,?,?)").bind(v,id,OWNER,profile!.revision,job.revision,RESUME_TEMPLATE,key,t),
    c.env.DB.prepare("INSERT OR IGNORE INTO tasks(id,user_id,kind,entity_id,entity_revision,idempotency_key,state,created_at,updated_at) VALUES(?,?,'TAILOR_RESUME',?,?,?,'PENDING',?,?)").bind(task,OWNER,job.id,job.revision,key,t,t),
    c.env.DB.prepare('INSERT OR IGNORE INTO outbox(id,task_id,payload_json,available_at) VALUES(?,?,?,?)').bind(task,task,JSON.stringify({kind:'TAILOR_RESUME',task_id:task,entity_id:job.id,entity_revision:job.revision,settings_revision:1}),t)
  ]);
  await c.env.TASKS.send({kind:'TAILOR_RESUME',task_id:task});
  return c.json({data:{task_id:task,resume_version_id:v,message:'Resume generation started. Your PDF and DOCX will appear in Resumes.'}},202);
});
resumes.get('/tasks/:id',async c=>{const task=await c.env.DB.prepare('SELECT id,kind,state,result_json,error_code FROM tasks WHERE id=? AND user_id=?').bind(c.req.param('id'),OWNER).first();return task?c.json({data:task}):c.json({error:{code:'NOT_FOUND',message:'Task not found.'}},404);});
resumes.get('/resume-versions/:id/compare',async c=>{const v=await c.env.DB.prepare('SELECT changes_json,content_json FROM resume_versions WHERE id=? AND user_id=?').bind(c.req.param('id'),OWNER).first<{changes_json:string;content_json:string}>();return v?c.json({data:{changes:JSON.parse(v.changes_json),content:JSON.parse(v.content_json)}}):c.json({error:{code:'NOT_FOUND',message:'Resume not found.'}},404);});
resumes.get('/resume-versions/:id/files/:format',async c=>{
  const format=c.req.param('format');if(!['pdf','docx','original'].includes(format))return c.json({error:{code:'INVALID_FORMAT',message:'Use pdf, docx or original.'}},400);
  const row=await c.env.DB.prepare("SELECT v.* FROM resume_versions v JOIN resumes r ON r.id=v.resume_id WHERE v.id=? AND v.user_id=? AND r.deleted_at IS NULL AND v.state='READY'").bind(c.req.param('id'),OWNER).first<Record<string,string>>();
  const key=row?.[`${format}_key`];if(!key)return c.json({error:{code:'NOT_FOUND',message:'File not available yet.'}},404);
  const object=await c.env.FILES.get(key);if(!object)return c.json({error:{code:'NOT_FOUND',message:'File not found.'}},404);
  return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType ?? 'application/octet-stream','Content-Disposition':`attachment; filename="resume.${key.endsWith('.pdf')?'pdf':'docx'}"`,'Cache-Control':'private, no-store'}});
});
resumes.delete('/resumes/:id',async c=>{
  await c.env.DB.prepare('UPDATE resumes SET deleted_at=? WHERE id=? AND user_id=?').bind(now(),c.req.param('id'),OWNER).run();return c.json({data:{deleted:true}});
});
