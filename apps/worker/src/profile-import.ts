import { skills } from './domain';

const headings:Record<string,string>={
  education:'education',academics:'education','academic qualifications':'education',
  experience:'experience','work experience':'experience','professional experience':'experience',internships:'experience','internship experience':'experience',
  projects:'projects','personal projects':'projects','academic projects':'projects','selected projects':'projects',
  skills:'skills','technical skills':'skills','technical expertise':'skills','technologies':'skills',
  achievements:'verified_bullets','awards and achievements':'verified_bullets',
  certifications:'other',certificates:'other',summary:'professional_summary','professional summary':'professional_summary',objective:'other',links:'other',interests:'other','positions of responsibility':'other'
};
export function resumeDraft(text:string) {
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const groups:Record<string,string[]>={education:[],experience:[],projects:[],skills:[],verified_bullets:[],professional_summary:[]};
  let section='other';
  for(const line of lines){
    const key=line.replace(/\*\*/g,'').toLowerCase().replace(/^[\s•\-]+|[\s:]+$/g,'').replace(/&/g,'and');
    if(headings[key]){section=headings[key];continue;}
    if(groups[section])groups[section].push(line);
  }
  const first=(lines[0] ?? '').replace(/\*\*/g,'');
  const name=/^[\p{L}][\p{L}\s.'-]{1,100}$/u.test(first)&&!headings[first.toLowerCase()]?first:'';
  const email=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  const contact=lines.slice(0,12).join(' ');
  const phone=contact.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3,5}\)?[\s.-]?){2,4}\d{2,5}/g)?.find(x=>x.replace(/\D/g,'').length>=10&&x.replace(/\D/g,'').length<=15) ?? '';
  const url=(host:string)=>text.match(new RegExp(`(?:https?:\\/\\/)?(?:www\\.)?${host}\\/[^\\s|<>]+`,'i'))?.[0]?.replace(/[.,;)]+$/,'') ?? '';
  const normalizeLink=(value:string)=>value&&!value.startsWith('http')?'https://'+value:value;
  const detected=skills(text);
  const sectionSkills=groups.skills.flatMap(line=>line.replace(/\*\*/g,'').replace(/^[\p{L}\s&/]+:\s*/u,'').split(/[,|;]/)).map(x=>x.trim()).filter(x=>x.length>0&&x.length<=80);
  const role=lines[1]?.includes('|')&&!lines[1].includes('@')?lines[1].replace(/\*\*/g,'').split('|').map(x=>x.trim()):[];
  const joinWrapped=(input:string[])=>{const out:string[]=[];for(const line of input){const plain=line.replace(/\*\*/g,'');if(out.length&&!/^(?:[•●-]\s|Tech:)/i.test(plain)&&!/(?:\d{1,2}\/)?(?:19|20)\d{2}(?:\s*[–—-]\s*(?:(?:\d{1,2}\/)?(?:19|20)\d{2}|Present))?$/i.test(plain)&&(/^[•●-]\s/.test(out.at(-1)!)||/^Tech:/.test(out.at(-1)!.replace(/\*\*/g,''))))out[out.length-1]+=(out.at(-1)!.endsWith('-')?'':' ')+line;else out.push(line);}return out;};
  const portfolio=lines.slice(0,3).join(' | ').split('|').map(x=>x.trim()).find(x=>/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?$/i.test(x)&&!/(?:linkedin|github)\.com/i.test(x))??'';
  return {name,email,phone,linkedin:normalizeLink(url('linkedin\\.com')),github:normalizeLink(url('github\\.com')),headline:role[0]??'',professional_summary:groups.professional_summary.reduce((text,line)=>text?text+(text.endsWith('-')?'':' ')+line:line,''),skill_groups:groups.skills.filter(x=>x.includes(':')).slice(0,30),location:role.slice(1).join(' | '),portfolio:normalizeLink(portfolio),skills:[...new Set([...detected,...sectionSkills])].slice(0,100),education:groups.education.slice(0,20),experience:joinWrapped(groups.experience).slice(0,30),projects:joinWrapped(groups.projects).slice(0,30),verified_bullets:groups.verified_bullets.slice(0,100)};
}
export function mergeResumeDraft(current:Record<string,unknown>,draft:ReturnType<typeof resumeDraft>) {
  const merged={...current};
  for(const [key,value]of Object.entries(draft)){
    const existing=current[key];
    if(existing===undefined||existing===null||existing===''||(Array.isArray(existing)&&existing.length===0)||(key==='email'&&existing==='owner@example.test'))merged[key]=value;
  }
  return merged;
}
