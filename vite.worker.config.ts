import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    outDir:'work/worker-build',emptyOutDir:true,target:'es2022',minify:false,
    lib:{entry:'apps/worker/src/index.ts',formats:['es'],fileName:()=> 'index.js'},
    rollupOptions:{output:{inlineDynamicImports:true}}
  }
});
