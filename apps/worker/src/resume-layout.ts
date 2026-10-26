import { PDFDocument, type PDFFont, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as fonts from './fonts/data';

export interface ResumeContent {name:string;contact:string;subtitle?:string;sections:{title:string;lines:string[]}[];}
// Matches the supplied Carlito/Letter reference. Coordinates and spacing are points.
export const RESUME_TEMPLATE='carlito-letter-v2';
const margin=32.4, width=547.2, leading=11.466;
export const datedHeading=(line:string)=>line.match(/^(.*?)\s+((?:Graduated\s+)?(?:\d{1,2}\/)?(?:19|20)\d{2}(?:\s*[–—-]\s*(?:(?:\d{1,2}\/)?(?:19|20)\d{2}|Present|Current))?)\s*$/i);
// Keep the title, employer, dates, bullets and technology line together when ranking.
export function groupedEntries(lines:string[]) {
  const result:string[]=[];let grouped=false;
  for(const value of lines ?? []) {
    if(value.includes('\n')){result.push(value);grouped=false;continue;}
    if(datedHeading(value.replace(/\*\*/g,''))){result.push(value);grouped=true;}
    else if(grouped)result[result.length-1]+='\n'+value;
    else result.push(value);
  }
  return result;
}
export type TextRun={text:string;bold?:boolean;italic?:boolean};
export function runs(text:string,bold=false,italic=false):TextRun[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(s=>({text:s.startsWith('**')?s.slice(2,-2):s,bold:bold||s.startsWith('**'),italic}));
}
export function rowStyle(line:string,index:number,section:string) {
  line=line.replace(/\*\*/g,'');
  const date=datedHeading(line.replace(/\*\*/g,''));
  const bullet=/^[•●\-]\s*/.test(line);
  const label=line.match(/^([^:]{1,40}:)(.*)$/);
  return {date,bullet,label,title:!!date&&(section==='Experience'||section==='Projects'),italic:section==='Experience'&&index===1&&!bullet&&!date};
}
export async function referencePdf(content:ResumeContent) {
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  // Embed complete fonts: fontkit subsetting drops Carlito glyph outlines in some readers.
  const options={features:{liga:false,clig:false,calt:false,kern:false}};
  const [regular,bold,italic]=await Promise.all([doc.embedFont(decode(fonts.regular),options),doc.embedFont(decode(fonts.bold),options),doc.embedFont(decode(fonts.italic),options)]);
  let page=doc.addPage([612,792]),y=746.4;
  const face=(r:TextRun):PDFFont=>r.bold?bold:r.italic?italic:regular;
  const measure=(rs:TextRun[],size:number)=>rs.reduce((n,r)=>n+face(r).widthOfTextAtSize(r.text,size),0);
  function ensure(height:number){if(y-height<32.4){page=doc.addPage([612,792]);y=750;}}
  function line(rs:TextRun[],size:number,x:number){for(const r of rs){page.drawText(r.text,{x,y,size,font:face(r),color:rgb(0,0,0)});x+=face(r).widthOfTextAtSize(r.text,size);}}
  function wrap(rs:TextRun[],size:number,max:number){
    const rows:TextRun[][]=[];let row:TextRun[]=[];
    for(const r of rs)for(const token of r.text.match(/\s+|[^\s-]+-?|-/g) ?? []){
      let next={...r,text:token};if(!row.length&&/^\s+$/.test(token))continue;
      if(measure([...row,next],size)>max&&row.length){while(row.length&&/^\s+$/.test(row.at(-1)!.text))row.pop();rows.push(row);row=[];if(/^\s+$/.test(token))continue;}
      // A URL or identifier longer than a line must wrap too.
      if(measure([next],size)>max){for(const char of token){next={...r,text:char};if(measure([...row,next],size)>max&&row.length){rows.push(row);row=[];}row.push(next);}}
      else row.push(next);
    }
    if(row.length)rows.push(row);return rows;
  }
  function paragraph(rs:TextRun[],size=9.8,bullet=false,center=false){
    const x=bullet?45.4:margin,max=bullet?width-13:width;
    const rows=wrap(rs,size,max);for(let i=0;i<rows.length;i++){ensure(leading);if(bullet&&i===0)line([{text:'•'}],size,38.3);line(rows[i],size,center?(612-measure(rows[i],size))/2:x);y-=leading;}
  }
  paragraph(runs(content.name.toUpperCase(),true),19,false,true);y=730.5;
  if(content.subtitle){paragraph(runs(content.subtitle,true),10.5,false,true);y-=1.5;}
  paragraph(runs(content.contact),9.2,false,true);y-=5;
  for(const section of content.sections){
    ensure(30);line(runs(section.title.toUpperCase(),true),10.5,margin);y-=3.8;
    page.drawLine({start:{x:margin,y},end:{x:579.6,y},thickness:.75,color:rgb(0,0,0)});y-=10;
    for(const entry of section.lines){
      const lines=entry.split('\n').filter(Boolean);ensure(Math.min(lines.length*leading,45));
      for(let i=0;i<lines.length;i++){
        const text=lines[i],style=rowStyle(text.replace(/\*\*/g,''),i,section.title);
        if(style.date){
          const title=style.date[1],date=style.date[2],size=9.8,dateWidth=bold.widthOfTextAtSize(date,size);
          const decorated=section.title==='Education'&&title.includes(' — ')?[...runs(title.split(' — ')[0],true),...runs(' — '+title.split(' — ').slice(1).join(' — '))]:runs(title,style.title);
          const left=wrap(decorated,size,width-dateWidth-12);
          for(let j=0;j<left.length;j++){ensure(leading);line(left[j],size,margin);if(j===0)line(runs(date,true),size,579.6-dateWidth);y-=leading;}
        }else if(style.label){const label=text.indexOf(':')+1;paragraph([...runs(text.slice(0,label).replace(/\*\*/g,''),true),...runs(text.slice(label).replace(/^\*\*/,''))],/^Tech:/i.test(text.replace(/\*\*/g,''))?9.4:9.8);}
        else paragraph(runs(text.replace(/^[•●\-]\s*/,''),false,style.italic),9.8,style.bullet);
      }
      if(section.title==='Experience'||section.title==='Projects')y-=2.5;
    }
    y-=6;
  }
  doc.setTitle(`${content.name} Resume`);doc.setAuthor(content.name);doc.setSubject(RESUME_TEMPLATE);return doc.save();
}
