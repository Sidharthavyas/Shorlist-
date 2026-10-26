import { mf } from './preview-api.mjs';
import { preview } from 'vite';
try {
 const health=await fetch('http://127.0.0.1:8787/api/v1/health');
 if(!health.ok)throw new Error(`API startup health check failed (HTTP ${health.status}).`);
 const server=await preview({configFile:'vite.config.ts',configLoader:'runner'});
 server.printUrls();
 console.log('Frontend and API are ready. Keep this terminal open; press Ctrl+C to stop both.');
 const close=async()=>{await new Promise(resolve=>server.httpServer.close(resolve));await mf.dispose();process.exit(0);};
 process.once('SIGTERM',close);
} catch(error) {
 await mf.dispose();
 console.error(`Local startup failed: ${error instanceof Error?error.message:String(error)}`);
 process.exitCode=1;
}
