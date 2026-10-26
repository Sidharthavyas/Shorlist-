import {readdirSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {zipSync} from 'fflate';
const source='extensions/shortlist-autofill',entries={};
for(const file of readdirSync(source))entries[file]=new Uint8Array(readFileSync(`${source}/${file}`));
const zip=zipSync(entries);mkdirSync('apps/web/public',{recursive:true});
writeFileSync('apps/web/public/shortlist-autofill.zip',zip);
writeFileSync('../shortlist-autofill-extension.zip',zip);
console.log('Packaged Shortlist Application Helper for Chrome / Edge.');
