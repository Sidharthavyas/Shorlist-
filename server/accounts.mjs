import {MongoClient} from 'mongodb';
import {randomUUID,randomBytes,scrypt as derive,createHash,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {SignJWT,jwtVerify} from 'jose';
const scrypt=promisify(derive),cookieName='__Host-shortlist_session',seconds=31536000;
let connection,indexes;
async function database(){
 if(!process.env.MONGODB_URI)throw Error('ACCOUNTS_NOT_CONFIGURED');
 connection??=new MongoClient(process.env.MONGODB_URI,{maxPoolSize:5,serverSelectionTimeoutMS:8000}).connect().catch(error=>{connection=undefined;throw error;});
 const db=(await connection).db(process.env.MONGODB_DATABASE||'shortlist');
 indexes??=Promise.all([db.collection('accounts').createIndex({email:1},{unique:true}),db.collection('account_attempts').createIndex({expiresAt:1},{expireAfterSeconds:0})]).catch(error=>{indexes=undefined;throw error;});await indexes;return db;
}
const key=()=>new TextEncoder().encode(process.env.OWNER_SESSION_SECRET||'');
const equal=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
const html=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function accountPage(signup=false,error=''){
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${signup?'Create account':'Sign in'} — Shortlist</title><style>body{font:16px system-ui;background:#f7f8f6;color:#203129;margin:0;display:grid;min-height:100vh;place-items:center}main{background:white;border:1px solid #dde4dc;border-radius:20px;padding:36px;max-width:420px;margin:20px}h1{font-size:28px}label{display:block;margin-top:14px}input,button{box-sizing:border-box;width:100%;padding:14px;border-radius:8px;margin-top:8px}input{border:1px solid #a9b8aa}button{background:#24583d;color:white;border:0;font:inherit;cursor:pointer}p{line-height:1.6;color:#536158}a{color:#24583d}</style><main><h1>${signup?'Your next chapter.':'Welcome back.'}</h1><p>${signup?'Create your own private profile, resumes and application tracker.':'Sign in to your personal Shortlist workspace.'} You stay signed in for one year unless you sign out or clear your browser cookies.</p>${error?`<p role="alert">${html(error)}</p>`:''}<form method="post" action="/api/auth/${signup?'signup':'login'}">${signup?'<label>Your name<input name="name" autocomplete="name" required maxlength="100"></label>':''}<label>Email${signup?'':' (owner can leave blank)'}<input name="email" type="email" autocomplete="username" maxlength="254" ${signup?'required':''}></label><label>Password<input name="password" type="password" autocomplete="${signup?'new-password':'current-password'}" required ${signup?'minlength="12"':''} maxlength="200"></label><button>${signup?'Create account':'Sign in'}</button></form><p>${signup?'Already have an account? <a href="/api/auth/login">Sign in</a>':'New here? <a href="/api/auth/signup">Create your account</a>'}</p></main></html>`;
}
const page=(signup,error='',status=200)=>new Response(accountPage(signup,error),{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
export async function accountSession(request){
 const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(!token||key().length<32)return null;
 try{const {payload}=await jwtVerify(token,key(),{algorithms:['HS256'],issuer:'shortlist-owner',audience:'shortlist-api'});if(payload.sub==='primary-owner'&&payload.email===process.env.OWNER_EMAIL)return {id:payload.sub,email:payload.email,name:'Owner',admin:true};if(payload.member===true&&/^account_[a-f0-9-]{36}$/.test(payload.sub??'')&&typeof payload.email==='string')return {id:payload.sub,email:payload.email,name:typeof payload.name==='string'?payload.name:'Member',admin:false};}catch{}return null;
}
export async function accountRequest(request,getDatabase=database){
 const path=new URL(request.url).pathname,signup=path.endsWith('/signup');
 if(!process.env.OWNER_SESSION_SECRET||key().length<32)return page(signup,'Account setup is unavailable.',503);
 if(request.method==='GET'&&['/api/auth/login','/api/auth/signup'].includes(path))return page(signup);
 if(path==='/api/auth/session'&&request.method==='GET'){const session=await accountSession(request);return Response.json({data:session},{status:session?200:401,headers:{'Cache-Control':'private, no-store'}});}
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 if(request.headers.get('Origin')!==(process.env.APP_ORIGIN||'https://shortlist-six-gold.vercel.app'))return Response.json({error:{code:'ORIGIN_REJECTED',message:'Request origin is not allowed.'}},{status:403});
 if(path==='/api/auth/logout')return new Response(null,{status:303,headers:{Location:'/api/auth/login','Set-Cookie':`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,'Cache-Control':'no-store'}});
 if(!['/api/auth/login','/api/auth/signup'].includes(path))return new Response('Not found',{status:404});
 if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return page(signup,'Invalid form.',400);
 const text=await request.text();if(text.length>4096)return page(signup,'Form is too large.',413);
 const form=new URLSearchParams(text),email=(form.get('email')||'').trim().toLowerCase(),password=form.get('password')||'',name=(form.get('name')||'').trim();
 if(password.length>200||!password||signup&&(!name||name.length>100||password.length<12||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254))return page(signup,'Enter a name, valid email and password of at least 12 characters.',400);
 try{
  const db=await getDatabase(),window=Math.floor(Date.now()/900000),ip=request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()||'unknown';
  for(const bucket of ['ip:'+ip,'email:'+email]){const _id=createHash('sha256').update(bucket+':'+window).digest('hex');const attempt=await db.collection('account_attempts').findOneAndUpdate({_id},{$inc:{count:1},$setOnInsert:{expiresAt:new Date((window+2)*900000)}},{upsert:true,returnDocument:'after'});if(attempt.count>20)return page(signup,'Too many attempts. Try again in 15 minutes.',429);}
  const accounts=db.collection('accounts');let account;
  const ownerEmail=(process.env.OWNER_EMAIL||'').toLowerCase();
  if(!signup&&(!email||email===ownerEmail)&&process.env.OWNER_PASSWORD_HASH&&equal(createHash('sha256').update(password).digest('hex'),process.env.OWNER_PASSWORD_HASH))account={_id:'primary-owner',email:process.env.OWNER_EMAIL,name:'Owner',admin:true};
  else if(signup){
   if(email===ownerEmail)return page(true,'This email cannot be registered. Sign in instead.',409);
   const salt=randomBytes(16).toString('hex'),hash=Buffer.from(await scrypt(password,salt,64)).toString('hex');
   account={_id:'account_'+randomUUID(),email,name,salt,passwordHash:hash,createdAt:new Date()};
   try{await accounts.insertOne(account);}catch(error){if(error.code===11000)return page(true,'This email cannot be registered. Sign in instead.',409);throw error;}
  }else{
   account=await accounts.findOne({email});const salt=account?.salt||'unregistered-account',derived=Buffer.from(await scrypt(password,salt,64));
   if(!account||!equal(derived.toString('hex'),account.passwordHash))return page(false,'Email or password is incorrect.',401);
  }
  const issuedAt=Math.floor(Date.now()/1000),token=await new SignJWT({email:account.email,name:account.name,...(!account.admin?{member:true}:{})}).setProtectedHeader({alg:'HS256'}).setSubject(account._id).setIssuer('shortlist-owner').setAudience('shortlist-api').setIssuedAt(issuedAt).setExpirationTime(issuedAt+seconds).sign(key());
  return new Response(null,{status:303,headers:{Location:'/','Set-Cookie':`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`,'Cache-Control':'private, no-store','Referrer-Policy':'same-origin'}});
 }catch{console.error(JSON.stringify({event:'account_service_unavailable'}));return page(signup,'Account service is temporarily unavailable. Please try again.',503);}
}
