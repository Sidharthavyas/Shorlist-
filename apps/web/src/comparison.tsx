type Comparison={extracted_text?:string;changes?:{sections?:{title:string;before:string[];after:string[];reordered:boolean}[]};content?:{extracted_text?:string;parse_error?:string;sections?:{title:string;lines:string[]}[]}};
export function ResumeComparison({value}:{value:Comparison}) {
 const extracted=value.extracted_text ?? value.content?.extracted_text;
 if(extracted)return <div><h4 className="comparison-title">Extracted from your original</h4><p className="helper">Review this text against the original before adding facts to your verified profile.</p><div className="draft-text">{extracted}</div></div>;
 if(value.content?.parse_error)return <p>{value.content.parse_error}</p>;
 const sections=value.changes?.sections;
 if(Array.isArray(sections)&&sections.length&&typeof sections[0]==='object')return <div className="comparison-sections">{sections.map(s=><section key={s.title}><h4>{s.title}<span>{s.reordered?'Reordered for this role':'Unchanged'}</span></h4><div className="comparison-columns"><div><small>Your verified profile</small>{s.before.map((line,i)=><p key={i}>{line}</p>)}</div><div><small>Tailored version</small>{s.after.map((line,i)=><p key={i}>{line}</p>)}</div></div></section>)}</div>;
 return <div>{value.content?.sections?.map(s=><section key={s.title}><h4>{s.title}</h4>{s.lines.map((line,i)=><p key={i}>{line}</p>)}</section>)}<p className="helper">This version uses your verified profile facts.</p></div>;
}
