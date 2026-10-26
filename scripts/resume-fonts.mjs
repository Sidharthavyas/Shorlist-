import {readFileSync,writeFileSync} from 'node:fs';
let source='// Carlito (SIL OFL); generated from the adjacent TTF files. Keep font data local to the Worker.\n';
for(const [key,file] of [['regular','Regular'],['bold','Bold'],['italic','Italic']]) source+=`export const ${key} = ${JSON.stringify(readFileSync(`apps/worker/src/fonts/Carlito-${file}.ttf`).toString('base64'))};\n`;
writeFileSync('apps/worker/src/fonts/data.ts',source);
