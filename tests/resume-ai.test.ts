import test from 'node:test';
import assert from 'node:assert/strict';
import {aiStatus,writingFacts,applyRewrites,requestWriting} from '../apps/worker/src/resume-ai';
import type {Env} from '../apps/worker/src/env';
import type {ResumeContent} from '../apps/worker/src/resume-layout';
const baseline:ResumeContent={name:'Alice Candidate',contact:'alice@example.test | +91 9876543210',sections:[{title:'Professional Summary',lines:['Built Python APIs.']},{title:'Experience',lines:['Backend Engineer | Example Employer | 2024–Present\n• Built Python services that reduced processing time by 20%.']},{title:'Technical Skills',lines:['Python, PostgreSQL']},{title:'Education',lines:['Example College 2024']}]};
const env={RESUME_AI_PROVIDER:'gemini',GEMINI_API_KEY:'fixture-secret-key',RESUME_AI_MODEL:'fixture-model',RESUME_AI_DATA_POLICY:'approved'} as Env;
test('AI edits only fact-linked writing and preserves headings, dates, contacts and skills sections',()=>{
 const facts=writingFacts(baseline);assert.equal(facts.length,2);const result=applyRewrites(baseline,{rewrites:[{fact_id:facts[1].id,text:'Developed Python services that reduced processing time by 20%.'}]});
 assert.equal(result.content.name,baseline.name);assert.equal(result.content.contact,baseline.contact);assert.deepEqual(result.content.sections[2],baseline.sections[2]);assert.deepEqual(result.content.sections[3],baseline.sections[3]);assert.ok(result.content.sections[1].lines[0].startsWith('Backend Engineer | Example Employer | 2024–Present\n• Developed'));assert.equal(result.changes.length,1);assert.ok(baseline.sections[1].lines[0].includes('• Built'));
});
test('new metrics, technologies, leadership, companies, headers and malformed output are rejected',()=>{
 const fact_id=writingFacts(baseline)[1].id;
 for(const [text,reason] of [['Built Python services that reduced processing time by 90%.','UNSUPPORTED_NUMBER'],['Built Python services using AWS.','UNSUPPORTED_SKILL'],['Led Python services.','UNSUPPORTED_CLAIM'],['Built Python services for Google.','UNSUPPORTED_PROPER_NOUN'],['Built Python services.\nNew heading','INVALID_REWRITE_FORMAT']] as const)assert.throws(()=>applyRewrites(baseline,{rewrites:[{fact_id,text}]}),new RegExp(reason));
 assert.throws(()=>applyRewrites(baseline,{rewrites:[{fact_id:'s1.e0.l0',text:'Changed employer'}]}),/UNKNOWN_OR_DUPLICATE/);
 assert.throws(()=>applyRewrites(baseline,{rewrites:[{fact_id,text:'Built Python services.'},{fact_id,text:'Built Python services.'}]}),/DUPLICATE/);
 assert.throws(()=>applyRewrites(baseline,{rewrites:[],extra:'not allowed'}));
});
test('provider configuration and account data policy are required before any API call',async()=>{
 assert.equal(aiStatus({} as Env).enabled,false);let calls=0;
 await assert.rejects(requestWriting({...env,RESUME_AI_DATA_POLICY:undefined},baseline,{title:'Backend Engineer',description:'Python'},async()=>{calls++;throw Error('Unexpected call');}),/DATA_POLICY_NOT_CONFIGURED/);assert.equal(calls,0);
});
test('Gemini receives bounded fact JSON without identity/contact headers and returns validated rewrites',async()=>{
 let calls=0;
 const result=await requestWriting(env,baseline,{title:'Backend Engineer',description:'Build Python APIs. Contact recruiter@example.test.'},async(url,options)=>{
  calls++;assert.ok(!String(url).includes(env.GEMINI_API_KEY!));const body=JSON.parse(String(options?.body)),input=body.contents[0].parts[0].text;assert.ok(!input.includes('Alice Candidate'));assert.ok(!input.includes('alice@example.test'));assert.ok(!input.includes('9876543210'));assert.ok(!input.includes('recruiter@example.test'));assert.ok(body.generationConfig.responseJsonSchema);
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({rewrites:[{fact_id:'s0.e0.l0',text:'Developed Python APIs.'}]})}]}}]});
 });assert.equal(calls,1);assert.equal(result.provider,'gemini');assert.equal(result.rewrites[0].text,'Developed Python APIs.');
});
test('quota errors and incomplete responses never become usable AI content',async()=>{
 await assert.rejects(requestWriting(env,baseline,{title:'Backend',description:'Python'},async()=>new Response('quota',{status:429})),/AI_RATE_LIMITED/);
 await assert.rejects(requestWriting(env,baseline,{title:'Backend',description:'Python'},async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]})),/AI_INCOMPLETE_RESPONSE/);
});
test('Grok uses server-side authentication and the same strict output validation',async()=>{
 const result=await requestWriting({...env,RESUME_AI_PROVIDER:'grok',XAI_API_KEY:'fixture-grok-key'},baseline,{title:'Backend',description:'Python'},async(url,options)=>{assert.equal(String(url),'https://api.x.ai/v1/chat/completions');const body=JSON.parse(String(options?.body));assert.equal(body.response_format.type,'json_schema');return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({rewrites:[]})}}]});});assert.equal(result.provider,'grok');
});

test('Groq uses its own key, endpoint and namespaced model with strict output validation',async()=>{
 const config={...env,RESUME_AI_PROVIDER:'groq',RESUME_AI_MODEL:'openai/gpt-oss-20b',GROQ_API_KEY:'fixture-groq-key'};
 assert.equal(aiStatus({...config,GROQ_API_KEY:undefined}).reason,'API_KEY_MISSING');
 const result=await requestWriting(config,baseline,{title:'Backend',description:'Python'},async(url,options)=>{
  assert.equal(String(url),'https://api.groq.com/openai/v1/chat/completions');assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer fixture-groq-key');
  const body=JSON.parse(String(options?.body));assert.equal(body.model,'openai/gpt-oss-20b');assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.max_completion_tokens,4096);assert.equal(body.max_tokens,undefined);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({rewrites:[{fact_id:'s0.e0.l0',text:'Developed Python APIs.'}]})}}]});
 });assert.equal(result.provider,'groq');assert.equal(result.rewrites.length,1);
 await assert.rejects(requestWriting(config,baseline,{title:'Backend',description:'Python'},async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({rewrites:[{fact_id:'s0.e0.l0',text:'Built Python APIs using AWS.'}]})}}]})),/UNSUPPORTED_SKILL/);
 await assert.rejects(requestWriting({...config,RESUME_AI_MODEL:'../bad/model'},baseline,{title:'Backend',description:'Python'}),/INVALID_MODEL/);
});
