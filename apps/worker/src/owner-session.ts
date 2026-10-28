import { SignJWT, jwtVerify } from 'jose';
import type { Context } from 'hono';
import type { Env } from './env';
import { hash } from './store';

const cookieName='__Host-shortlist_session';
const sessionSeconds=365*24*60*60;
const encoder=new TextEncoder();
const sessionKey=(env:Env)=>encoder.encode(env.OWNER_SESSION_SECRET!);
async function equalSecret(a:string,b:string){
  const [x,y]=await Promise.all([hash(a),hash(b)]);
  let difference=0;for(let i=0;i<x.length;i++)difference|=x.charCodeAt(i)^y.charCodeAt(i);
  return difference===0;
}
const loginPage=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — Shortlist</title><style>body{font:16px system-ui;background:#f7f8f6;color:#203129;margin:0;display:grid;min-height:100vh;place-items:center}main{background:white;border:1px solid #dde4dc;border-radius:20px;padding:36px;max-width:380px;margin:20px}h1{font-size:28px}input,button{box-sizing:border-box;width:100%;padding:14px;border-radius:8px;margin-top:12px}input{border:1px solid #a9b8aa}button{background:#24583d;color:white;border:0;font:inherit;cursor:pointer}p{line-height:1.6;color:#536158}</style><main><h1>Your private workspace.</h1><p>Enter your owner password to open Shortlist. You stay signed in for one year unless you sign out or clear your browser cookies.</p><form method="post" action="/api/auth/login"><label>Owner password<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><button type="submit">Sign in</button></form></main></html>`;

// This mode is opt-in. Access JWT authentication remains available when no proxy
// secret is configured. The transport secret never grants an owner session.
export async function proxyAuthorized(request:Request,env:Env){
  return !!env.DEPLOYMENT_PROXY_SECRET&&env.DEPLOYMENT_PROXY_SECRET.length>=32&&await equalSecret(request.headers.get('X-Shortlist-Proxy-Token')??'',env.DEPLOYMENT_PROXY_SECRET);
}
export async function ownerSession(c:Context<{Bindings:Env;Variables:{requestId:string}}>) {
  const env=c.env;
  if(!env.DEPLOYMENT_PROXY_SECRET)return null;
  if(env.APP_ENV!=='production'||!env.OWNER_EMAIL||!env.OWNER_SESSION_SECRET||env.OWNER_SESSION_SECRET.length<32||!env.OWNER_PASSWORD_HASH)
    return c.json({error:{code:'AUTH_NOT_CONFIGURED',message:'Owner authentication is not configured.'}},503);
  if(!await proxyAuthorized(c.req.raw,env))
    return c.json({error:{code:'UNAUTHORIZED',message:'Use the Shortlist dashboard.'}},401);
  const path=new URL(c.req.url).pathname;
  if(!['GET','HEAD','OPTIONS'].includes(c.req.method)&&c.req.header('Origin')!==env.APP_ORIGIN)
    return c.json({error:{code:'ORIGIN_REJECTED',message:'Request origin is not allowed.'}},403);
  if(path==='/api/auth/login'){
    if(c.req.method==='GET')return c.html(loginPage);
    if(c.req.method!=='POST')return c.text('Method not allowed',405);
    if(!c.req.header('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return c.text('Invalid login form.',400);
    // Reserve a global attempt atomically before verifying the password. This is
    // persistent across isolates and bounds guessing even when IPs change.
    const windowStart=Math.floor(Date.now()/900000)*900000;
    const attempt=await env.DB.prepare('INSERT INTO owner_login_attempts(window_start,attempts) VALUES(?,1) ON CONFLICT(window_start) DO UPDATE SET attempts=attempts+1 WHERE attempts<20 RETURNING attempts').bind(windowStart).first();
    if(!attempt){c.header('Retry-After',String(Math.ceil((windowStart+900000-Date.now())/1000)));return c.text('Too many sign-in attempts. Try again in 15 minutes.',429);}
    await env.DB.prepare('DELETE FROM owner_login_attempts WHERE window_start<?').bind(windowStart-3600000).run();
    const body=await c.req.text();if(body.length>2048)return c.text('Login form is too large.',413);
    const password=new URLSearchParams(body).get('password')??'';
    if(!password||!await equalSecret(await hash(password),env.OWNER_PASSWORD_HASH))return c.html(loginPage.replace('<form','<p role="alert">Incorrect password. Please try again.</p><form'),401);
    const issuedAt=Math.floor(Date.now()/1000);
    const token=await new SignJWT({email:env.OWNER_EMAIL}).setProtectedHeader({alg:'HS256'}).setSubject('primary-owner').setIssuer('shortlist-owner').setAudience('shortlist-api').setIssuedAt(issuedAt).setExpirationTime(issuedAt+sessionSeconds).sign(sessionKey(env));
    c.header('Set-Cookie',`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${sessionSeconds}`);
    return c.redirect('/',303);
  }
  const token=c.req.header('Cookie')?.split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1)??'';
  try{
    const {payload}=await jwtVerify(token,sessionKey(env),{algorithms:['HS256'],issuer:'shortlist-owner',audience:'shortlist-api'});
    if(payload.sub!=='primary-owner'||payload.email!==env.OWNER_EMAIL)throw Error('Invalid owner');
    if(path==='/api/auth/logout'){
      if(c.req.method!=='POST')return c.text('Method not allowed',405);
      c.header('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
      return c.redirect('/api/auth/login',303);
    }
    return {subject:payload.sub,email:env.OWNER_EMAIL};
  }catch{
    if(c.req.method==='GET'&&c.req.header('Accept')?.includes('text/html'))return c.redirect('/api/auth/login',303);
    return c.json({error:{code:'AUTH_REQUIRED',message:'Sign in to your private Shortlist workspace.'}},401);
  }
}

