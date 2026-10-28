import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {SignJWT,decodeJwt} from 'jose';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {storageRequest} from '../server/mongo-storage.mjs';
const origin='https://shortlist.example.test',secret='test-proxy-secret-'.repeat(3),session='test-session-secret-'.repeat(3);
const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
process.env.MONGO_STORAGE_SECRET='test-mongo-storage-'.repeat(3);
const stored=new Map();
const collection={updateOne:async(filter,update)=>stored.set(filter._id,update.$set),findOne:async filter=>stored.get(filter._id),deleteOne:async filter=>stored.delete(filter._id)};
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:readFileSync('work/worker-build/index.js','utf8'),compatibilityDate:'2026-10-23',d1Databases:['DB'],queueProducers:{TASKS:'session-tasks'},bindings:{APP_ENV:'production',APP_ORIGIN:origin,OWNER_EMAIL:'owner@example.test',DEPLOYMENT_PROXY_SECRET:secret,OWNER_SESSION_SECRET:session,OWNER_PASSWORD_HASH:await hash('fixture-password'),MONGO_STORAGE_URL:origin+'/api/storage',MONGO_STORAGE_SECRET:process.env.MONGO_STORAGE_SECRET},outboundService:async request=>{const response=await storageRequest(request,async()=>collection);if(!response.ok)console.error("Fixture storage response",response.status,await response.clone().text());return response;},serviceBindings:{ASSETS:()=>new Response('assets')}}));
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const call=(path,options={})=>mf.dispatchFetch(origin+path,{redirect:'manual',...options,headers:{'X-Shortlist-Proxy-Token':secret,...options.headers}});
const login=(password='fixture-password',from=origin)=>call('/api/auth/login',{method:'POST',headers:{Origin:from,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password}).toString()});
try{
 const db=await mf.getD1Database('DB');for(const file of ['0001_initial.sql','0002_runtime.sql','0003_owner_session.sql'])await db.exec(readFileSync('migrations/'+file,'utf8').replace(/--[^\n]*/g,'').replace(/\r?\n/g,' '));
 assert.equal((await mf.dispatchFetch(origin+'/api/v1/health')).status,401);pass('direct Worker requests cannot bypass Vercel transport authentication');
 assert.equal((await call('/api/v1/health')).status,401);pass('transport authentication does not grant an owner session');
 const loginForm=await call('/api/auth/login');assert.equal(loginForm.status,200);assert.equal(loginForm.headers.get('Referrer-Policy'),'same-origin');pass('owner sign-in form preserves browser Origin without leaking cross-origin referrers');
 assert.equal((await login('fixture-password','null')).status,403);pass('opaque origins are rejected rather than bypassing login protection');
 assert.equal((await call('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'password=fixture-password'})).status,403);pass('login without an Origin is rejected');
 assert.equal((await login('fixture-password','https://attacker.test')).status,403);pass('login rejects cross-site requests');
 assert.equal((await login('wrong-password')).status,401);pass('wrong owner password is rejected');
 const signedIn=await login();assert.equal(signedIn.status,303);const cookie=signedIn.headers.get('Set-Cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);pass('correct owner password establishes a secure session');
 assert.match(cookie,/Max-Age=31536000(?:;|$)/);const claims=decodeJwt(cookie.split(';')[0].split('=')[1]);assert.equal(claims.exp-claims.iat,365*24*60*60);pass('browser cookie and signed session both last exactly one year');
 const headers={Cookie:cookie.split(';')[0]};assert.equal((await call('/api/v1/health',{headers})).status,200);pass('authenticated owner can use the deployed API');
 const profile=await(await call('/api/v1/profile',{headers})).json();assert.equal(profile.data.email,'owner@example.test');pass('production initializes a real empty owner profile without samples');
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage().drawText('Test Candidate - Backend Engineer',{font,x:50,y:700});const bytes=await pdf.save();
 const upload=new FormData();upload.set('file',new File([bytes],'fixture.pdf',{type:'application/pdf'}));
 const multipart=new Request(origin,{method:'POST',body:upload});const uploaded=await call('/api/v1/profile/uploads',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':multipart.headers.get('Content-Type')},body:await multipart.arrayBuffer()});assert.equal(uploaded.status,201);assert.equal(stored.size,1);pass('authenticated Worker uploads a PDF through the MongoDB storage adapter without R2');
 const imported=await call('/api/v1/profile/import-resume',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(imported.status,200);assert.equal((await imported.json()).data.verification_required,true);pass('MongoDB-backed resume can be read and imported without automatically verifying facts');
 assert.equal((await call('/api/v1/health',{headers:{Cookie:headers.Cookie+'tampered'}})).status,401);pass('tampered owner session is rejected');
 const jwt=await new SignJWT({email:'other@example.test'}).setProtectedHeader({alg:'HS256'}).setSubject('primary-owner').setIssuer('shortlist-owner').setAudience('shortlist-api').setExpirationTime('1h').sign(new TextEncoder().encode(session));
 assert.equal((await call('/api/v1/health',{headers:{Cookie:'__Host-shortlist_session='+jwt}})).status,401);pass('a session for a different owner is rejected');
 assert.equal((await call('/api/v1/settings',{method:'PATCH',headers:{...headers,Origin:'https://attacker.test','Content-Type':'application/json'},body:'{}'})).status,403);pass('authenticated mutations still enforce the frontend origin');
 const logout=await call('/api/auth/logout',{method:'POST',headers:{...headers,Origin:origin}});assert.equal(logout.status,303);assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);pass('owner can clear the browser session');
 await db.prepare('DELETE FROM owner_login_attempts').run();for(let n=0;n<20;n++)assert.equal((await login('bad')).status,401);
 assert.equal((await login()).status,429);pass('persistent login attempt limits survive individual requests');
 console.log(`${checks} owner session checks passed.`);
}finally{await mf.dispose();}






