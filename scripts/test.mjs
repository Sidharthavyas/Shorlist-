import ts from 'typescript';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// TypeScript's JS transpiler avoids a native bundler requirement in unit tests.
const root='work/runtime';
function compile(dir) {
 for(const item of readdirSync(dir,{withFileTypes:true})) {
  const source=path.join(dir,item.name), target=path.join(root,source);
  if(item.isDirectory()) {compile(source);continue;}
  if(!source.endsWith('.ts'))continue;
  mkdirSync(path.dirname(target),{recursive:true});
  let code=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,esModuleInterop:true}}).outputText;
  code=code.replace(/(from\s*['"])(\.[^'"]+)(['"])/g,(_,a,p,b)=>p.endsWith('.json')?`${a}${p}${b} with { type: 'json' }`:`${a}${p.endsWith('.js')?p:p+'.js'}${b}`);
  writeFileSync(target.replace(/\.ts$/,'.js'),code);
 }
}
for(const dir of ['apps/worker','contracts','tests'])compile(dir);
cpSync('config',`${root}/config`,{recursive:true});
if(process.argv.includes('--seed')) {
 const r=spawnSync(process.execPath,[`${root}/tests/make-seed.js`],{stdio:'inherit'});process.exit(r.status ?? 1);
}
const entries=readdirSync('tests').filter(x=>x.endsWith('.test.ts')).map(x=>`tests/${x}`);
const r=spawnSync(process.execPath,['--test',...entries.map(x=>`${root}/${x.replace('.ts','.js')}`)],{stdio:'inherit'});
process.exit(r.status ?? 1);
