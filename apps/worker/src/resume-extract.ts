type Item={str:string;transform:number[];fontName:string;height:number;width:number};
export async function formattedPdf(bytes:Uint8Array){
  const {getDocumentProxy}=await import('unpdf');const proxy=await getDocumentProxy(bytes.slice());
  try{if(proxy.numPages>20)return '';const pages=[];for(let n=1;n<=proxy.numPages;n++){const page=await proxy.getPage(n);const text=await page.getTextContent();pages.push(spatialResumeText(text.items.filter((x):x is typeof x & Item=>'str' in x)).formatted);}return pages.join('\n').slice(0,150000);}
  finally{if('destroy' in proxy&&typeof proxy.destroy==='function')await proxy.destroy();}
}
// PDFs can paint bullets and right-column dates after the entire body. Reading
// drawing order loses their association with the entry, so reconstruct visual rows.
export function spatialResumeText(items:Item[]){
  const visible=items.filter(x=>x.str.trim()).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4]);
  const counts=new Map<string,number>();for(const i of visible)counts.set(i.fontName,(counts.get(i.fontName)??0)+i.str.length);
  const body=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];
  const name=visible.reduce<Item|undefined>((a,b)=>!a||b.height>a.height?b:a,undefined);
  const bold=name?.fontName!==body?name?.fontName:undefined;
  const rows:Item[][]=[];
  for(const item of visible){const row=rows.find(r=>Math.abs(r[0].transform[5]-item.transform[5])<1.5);if(row)row.push(item);else rows.push([item]);}
  const plain:string[]=[],formatted:string[]=[];
  for(const row of rows){
    row.sort((a,b)=>a.transform[4]-b.transform[4]);let text='',styled='';let previous:Item|undefined;
    for(const item of row){const gap=previous?item.transform[4]-(previous.transform[4]+previous.width):0;
      const space=previous&&gap>.8&&!text.endsWith(' ')&&!item.str.startsWith(' ')?' ':'';
      text+=space+item.str;styled+=space+(item.fontName===bold?`**${item.str}**`:item.str);previous=item;
    }
    plain.push(text.trim());formatted.push(styled.trim());
  }
  return {plain:plain.join('\n'),formatted:formatted.join('\n')};
}
