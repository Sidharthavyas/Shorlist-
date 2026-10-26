/* Packaged script, run only in the active tab after the user opens the helper. */
(()=>{
 'use strict';
 if(globalThis.ShortlistAutofill?.version==='1.0.0')return;
 const clean=value=>typeof value==='string'?value.replace(/\*\*/g,'').trim().slice(0,12000):'';
 const normalize=value=>String(value??'').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().replace(/[_\-./:()[\]*]+/g,' ').replace(/\s+/g,' ').trim();
 const fields={full_name:'Full name',first_name:'First name',last_name:'Last name',email:'Email',phone:'Phone',phone_country_code:'Phone country code',phone_national:'National phone number',location:'Location',city:'City',country:'Country',state:'State / region',postal_code:'Postal code',address:'Street address',linkedin:'LinkedIn',github:'GitHub',portfolio:'Portfolio',current_company:'Current company',current_title:'Current job title',school:'School / college',degree:'Degree',graduation_year:'Graduation year',skills:'Skills',summary:'Professional summary'};
 function profile(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Choose a Shortlist profile JSON file.');
  const p=input.profile??input;if(typeof p!=='object'||!p)throw Error('Profile is missing.');
  const result={};for(const key of Object.keys(fields))result[key]=clean(p[key]);
  result.full_name ||= clean(p.name);const names=result.full_name.split(/\s+/);result.first_name ||= names[0]??'';result.last_name ||= names.length>1?names.slice(1).join(' '):'';
  result.email=clean(p.email);if(!result.full_name||!/^\S+@\S+\.\S+$/.test(result.email))throw Error('Your profile needs a name and a valid email.');
  result.phone=clean(p.phone);result.location=clean(p.location);result.linkedin=clean(p.linkedin);result.github=clean(p.github);result.portfolio=clean(p.portfolio);
  for(const key of ['linkedin','github','portfolio'])if(result[key]){if(!/^https?:\/\//i.test(result[key]))result[key]='https://'+result[key];try{if(!['http:','https:'].includes(new URL(result[key]).protocol))result[key]='';}catch{result[key]='';}}
  result.skills=Array.isArray(p.skills)?p.skills.map(clean).filter(Boolean).join(', '):clean(p.skills);
  result.summary=clean(p.professional_summary)||clean(p.summary);
  const place=result.location.split(',').map(x=>x.trim());if(place.length>=2){result.city ||= place[0];result.country ||= place.at(-1);}
  const code=result.phone.match(/^(\+\d{1,3})\s+(.+)$/);if(code){result.phone_country_code ||= code[1];result.phone_national ||= code[2];}
  const education=Array.isArray(p.education)?clean(p.education[0]):'';const school=education.split(/\s+[—–]\s+/);
  if(school.length>1){result.school ||= school[0];result.degree ||= school.slice(1).join(' — ').replace(/\s+Graduated\s+.*$/i,'').trim();}
  result.graduation_year ||= education.match(/Graduated\s+(?:\d{1,2}\/)?((?:19|20)\d{2})/i)?.[1]??'';
  const work=Array.isArray(p.experience)?p.experience.map(clean).filter(Boolean):[];
  const heading=work[0]?.split('\n')??[];
  if(/(?:Present|Current)\s*$/i.test(heading[0]??'')){
   result.current_title ||= heading[0].replace(/\s+(?:\d{1,2}\/)?(?:19|20)\d{2}\s*[–—-]\s*(?:Present|Current)\s*$/i,'').trim();
   const employer=heading[1]??work[1];if(employer&&!/^[•-]/.test(employer))result.current_company ||= employer.split(' · ')[0];
  }
  return result;
 }
 const sensitive=/\b(password|passcode|captcha|gender|sex|ethnicity|race|religion|disability|veteran|date of birth|birth date|dob|age|salary|compensation|authorization|authorisation|sponsor|citizenship|nationality|visa|consent|agree|privacy|referee|reference name|emergency|demographic|social security|ssn)\b/;
 function metadata(el){
  const doc=el.ownerDocument;
  const labelled=(el.getAttribute('aria-labelledby')??'').split(/\s+/).map(id=>doc.getElementById(id)?.textContent??'').join(' ');
  const labels=Array.from(el.labels??[]).map(l=>l.textContent??'').join(' ');
  return {text:normalize([labels,el.getAttribute('aria-label'),labelled,el.name,el.id,el.placeholder,el.closest('fieldset')?.querySelector('legend')?.textContent].filter(Boolean).join(' ')),label:clean(labels||el.getAttribute('aria-label')||labelled||el.placeholder||el.name||el.id).slice(0,180)};
 }
 function identify(el){
  const meta=metadata(el),s=meta.text,type=el.type?.toLowerCase()??'';
  if(sensitive.test(s)||/\b(desired|expected|previous|referral|extension)\b/.test(s)||['password','hidden','checkbox','radio','submit','button','reset','image','range','color','date','datetime-local'].includes(type))return null;
  if(type==='file')return /\b(resume|cv|curriculum vitae)\b/.test(s)&&!/(cover letter|additional|supporting)/.test(s)?'resume':null;
  const auto=normalize(el.autocomplete?.split(/\s+/).at(-1));
  const autoKeys={'given name':'first_name','family name':'last_name',name:'full_name',email:'email',tel:'phone','tel country code':'phone_country_code','tel national':'phone_national','address level2':'city','address level1':'state','street address':'address','address line1':'address','postal code':'postal_code','country name':'country',country:'country',organization:'current_company','organization title':'current_title'};
  if(autoKeys[auto])return autoKeys[auto];
  const rules=[['first_name',/\b(first name|firstname|given name|fname)\b/],['last_name',/\b(last name|lastname|family name|surname|lname)\b/],['linkedin',/\blinked\s?in\b/],['github',/\bgit\s?hub\b/],['portfolio',/\b(portfolio|personal (?:website|site)|website url|website|personal url)\b/],['phone_country_code',/\b(dial(?:ing)? code|phone country code|country code)\b/],['phone',/\b(phone|telephone|mobile(?: number)?|contact number)\b/],['email',/\be ?mail\b/],['current_company',/\b(current (?:company|employer|organization)|company name|employer name)\b/],['current_title',/\b(current (?:job )?title|current position|job title)\b/],['school',/\b(school|college|university|institution)\b/],['graduation_year',/\b(graduation year|year of graduation|graduating year)\b/],['degree',/\b(degree|qualification)\b/],['postal_code',/\b(postal|zip|pin) code\b/],['city',/\bcity\b/],['state',/\b(state|province|region)\b/],['country',/\bcountry\b/],['address',/\b(street address|address line 1|address line1)\b/],['location',/\b(current location|location|where (?:are you|do you) (?:based|live))\b/],['skills',/\b(skills|technologies|tech stack)\b/],['summary',/\b(professional summary|summary|about yourself|about you|bio)\b/],['full_name',/\b(full name|fullname|applicant name|candidate name|your name)\b/]];
  const candidates=el.tagName==='TEXTAREA'?rules.filter(([key])=>['summary','skills','address','location'].includes(key)):rules;
  return candidates.find(([,pattern])=>pattern.test(s))?.[0]??(el.tagName!=='TEXTAREA'&&/^name(?: name)*$/.test(s)?'full_name':null);
 }
 function controls(root=document,seen=new Set()){
  if(seen.has(root))return [];seen.add(root);const out=Array.from(root.querySelectorAll('input,textarea,select'));
  for(const node of root.querySelectorAll('*')){if(node.shadowRoot)out.push(...controls(node.shadowRoot,seen));if(node.tagName==='IFRAME'){try{if(node.contentDocument)out.push(...controls(node.contentDocument,seen));}catch{}}}
  return out;
 }
 function editable(el,file=false){
  if(!el.isConnected||el.disabled||el.readOnly||el.closest('[inert]'))return false;
  if((file?el.parentElement:el)?.closest('[hidden],[aria-hidden="true"]'))return false;
  const form=el.closest('form');if(form&&/newsletter|subscribe|search/i.test([form.id,form.name,form.getAttribute('action'),form.getAttribute('aria-label')].filter(Boolean).join(' ')))return false;
  const view=el.ownerDocument.defaultView,style=view.getComputedStyle(el);
  if(!file&&(style.display==='none'||style.visibility==='hidden'||!el.getClientRects().length))return false;
  // File controls are often visually hidden behind the site's upload button.
  return true;
 }
 function empty(el){if(el.type==='file')return !el.files?.length;if(el.tagName==='SELECT'){const selected=el.selectedOptions?.[0];return !el.value||/^(select|choose|please select|please choose|--|—)/i.test(selected?.textContent?.trim()??'');}return !el.value?.trim();}
 function selectedValue(el,key,value){
  if(el.tagName!=='SELECT')return value;
  const choices=[normalize(value)];if(key==='country'){const codes={india:'in','united states':'us','united states of america':'us',canada:'ca','united kingdom':'gb',australia:'au'};if(codes[normalize(value)])choices.push(codes[normalize(value)]);}
  return Array.from(el.options).find(o=>!o.disabled&&choices.some(v=>normalize(o.textContent)===v||normalize(o.value)===v))?.value??null;
 }
 const plans=new Map();let undo=[];
 function preview(input,resume=null){
  const data=profile(input);plans.clear();const result=[];let unmatched=0,occupied=0;
  for(const el of controls()){
   const key=identify(el);if(!key){unmatched++;continue;}if(!editable(el,key==='resume'))continue;if(!empty(el)){occupied++;continue;}
   const value=key==='resume'?resume:data[key];if(!value)continue;
   const selected=key==='resume'?value:selectedValue(el,key,value);if(selected===null)continue;
   if(key!=='resume'&&(el.maxLength>0&&selected.length>el.maxLength))continue;
   const token=crypto.randomUUID(),label=metadata(el).label||fields[key]||'Resume';
   plans.set(token,{el,key,value:selected,prior:el.value,resume:key==='resume'});result.push({token,key,label,value:key==='resume'?value.name:selected});
  }
  return {fields:result,occupied,unmatched};
 }
 function setValue(el,value){
  let proto=Object.getPrototypeOf(el),setter;while(proto&&!setter){setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;proto=Object.getPrototypeOf(proto);}
  if(setter)setter.call(el,value);else el.value=value;
  const view=el.ownerDocument.defaultView;el.dispatchEvent(new view.Event('input',{bubbles:true,composed:true}));el.dispatchEvent(new view.Event('change',{bubbles:true,composed:true}));
 }
 function setFile(el,resume){
  const view=el.ownerDocument.defaultView,bytes=Uint8Array.from(atob(resume.base64),c=>c.charCodeAt(0)),file=new view.File([bytes],resume.name,{type:resume.type});
  if(el.accept){const accepts=el.accept.split(',').map(s=>s.trim().toLowerCase());if(!accepts.some(a=>a.startsWith('.')?file.name.toLowerCase().endsWith(a):a.endsWith('/*')?file.type.startsWith(a.slice(0,-1)):a===file.type))throw Error('Resume type not accepted by this field.');}
  const transfer=new view.DataTransfer();transfer.items.add(file);el.files=transfer.files;el.dispatchEvent(new view.Event('input',{bubbles:true}));el.dispatchEvent(new view.Event('change',{bubbles:true}));
 }
 function fill(tokens){
  const completed=[],errors=[];undo=[];
  for(const token of tokens){const item=plans.get(token);if(!item)continue;const {el,key,value,resume}=item;
   if(!editable(el,resume)||!empty(el)||identify(el)!==key)continue;
   try{if(resume)setFile(el,value);else setValue(el,value);undo.push({...item,filled:resume?value.name:el.value});completed.push(metadata(el).label||fields[key]||'Resume');}catch(error){errors.push({field:metadata(el).label,message:error.message});}
  }
  plans.clear();return {filled:completed,errors};
 }
 function undoLast(){let restored=0;for(const item of undo){const {el,resume}=item;if(!el.isConnected)continue;if(resume){if(el.files?.length===1&&el.files[0].name===item.filled){el.files=new el.ownerDocument.defaultView.DataTransfer().files;el.dispatchEvent(new el.ownerDocument.defaultView.Event('change',{bubbles:true}));restored++;}}else if(el.value===item.filled){setValue(el,item.prior);restored++;}}undo=[];return restored;}
 globalThis.ShortlistAutofill={version:'1.0.0',fields,profile,identify,preview,fill,undoLast};
})();
