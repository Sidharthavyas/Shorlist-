import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk={...await exportJWK(publicKey),kid:'test-key',alg:'RS256',use:'sig'};
const issuer='https://test.cloudflareaccess.com';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:readFileSync('work/worker-build/index.js','utf8'),compatibilityDate:'2026-10-23',d1Databases:['DB'],r2Buckets:['FILES'],queueProducers:{TASKS:'auth-tasks'},
 bindings:{APP_ENV:'production',APP_ORIGIN:'https://jobs.example.test',ACCESS_ISSUER:issuer,ACCESS_AUDIENCE:'test-audience',OWNER_EMAIL:'owner@example.test'},
 outboundService:async request=>new Response(JSON.stringify(request.url===`${issuer}/cdn-cgi/access/certs`?{keys:[jwk]}:{}),{headers:{'Content-Type':'application/json'}}),
 serviceBindings:{ASSETS:()=>new Response('private assets')}
}));
try {
 const db=await mf.getD1Database('DB');for(const file of ['migrations/0001_initial.sql','migrations/0002_runtime.sql','migrations/0004_durable_work.sql'])await db.exec(readFileSync(file,'utf8').replace(/--[^\n]*/g,'').replace(/\r?\n/g,' '));
 async function jwt(email='owner@example.test',aud='test-audience',expiry='5m') {return new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('access-owner').setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(expiry).sign(privateKey);}
 const request=token=>mf.dispatchFetch('https://jobs.example.test/api/v1/health',{headers:token?{'Cf-Access-Jwt-Assertion':token}:{}});
 assert.equal((await request()).status,401);console.log('PASS production rejects missing Access assertion');
 assert.equal((await request('not.a.jwt')).status,401);console.log('PASS production rejects malformed assertion');
 assert.equal((await request(await jwt('owner@example.test','wrong-audience'))).status,401);console.log('PASS Access audience is validated');
 assert.equal((await request(await jwt('owner@example.test','test-audience','-1h'))).status,401);console.log('PASS expired Access assertion is rejected');
 assert.equal((await request(await jwt('other@example.test'))).status,403);console.log('PASS authenticated non-owner is rejected');
 assert.equal((await request(await jwt())).status,200);console.log('PASS owner assertion with valid signature is accepted');
 const asset=await mf.dispatchFetch('https://jobs.example.test/assets/app.js');assert.equal(asset.status,401);console.log('PASS static asset paths cannot bypass authentication');
 console.log('7 production authentication checks passed with a mocked Access JWKS.');
} finally {await mf.dispose();}

