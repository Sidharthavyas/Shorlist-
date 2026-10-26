import ts from 'typescript';
import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
mkdirSync('work/web-test',{recursive:true});
for(const file of ['use-data.ts','setup-controls.tsx']){
 const output=ts.transpileModule(readFileSync('apps/web/src/'+file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 writeFileSync('work/web-test/'+file.replace(/\.tsx?$/,'.js'),output);
}
const files=readdirSync('tests/web').filter(f=>f.endsWith('.test.mjs')).map(f=>'tests/web/'+f);
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});process.exit(result.status??1);
