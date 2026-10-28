import test from 'node:test';
import assert from 'node:assert/strict';
import {accountRequest,accountSession} from '../../server/accounts.mjs';
const origin='https://shortlist-six-gold.vercel.app';
function database(){const accounts=new Map(),attempts=new Map();return {accounts,collection(name){return name==='accounts'?{async insertOne(a){if([...accounts.values()].some(x=>x.email===a.email))throw Object.assign(Error('duplicate'),{code:11000});accounts.set(a._id,a);},async findOne({email}){return [...accounts.values()].find(x=>x.email===email)??null;}}:{async findOneAndUpdate({_id}){const count=(attempts.get(_id)||0)+1;attempts.set(_id,count);return {count};}};}};}
const request=(path,body,headers={})=>new Request(origin+'/api/auth/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(body)});
test('signup and login produce distinct private accounts, secure cookies, salted hashes and generic errors',async()=>{
 const previous={...process.env};process.env.OWNER_SESSION_SECRET='fixture-session-key-that-is-long-enough';process.env.OWNER_EMAIL='owner@fixture.test';process.env.APP_ORIGIN=origin;
 const db=database(),get=async()=>db;
 try{
  const alice=await accountRequest(request('signup',{name:'Alice',email:'alice@fixture.test',password:'unique-password-alice'}),get);assert.equal(alice.status,303);const ac=alice.headers.get('Set-Cookie');assert.match(ac,/HttpOnly; Secure; SameSite=Strict; Max-Age=31536000/);
  const bob=await accountRequest(request('signup',{name:'Bob',email:'bob@fixture.test',password:'unique-password-bob'}),get);assert.equal(bob.status,303);assert.notEqual(ac,bob.headers.get('Set-Cookie'));
  const session=await accountSession(new Request(origin,{headers:{Cookie:ac.split(';')[0]}}));assert.equal(session.name,'Alice');assert.equal(session.admin,false);assert.match(session.id,/^account_/);
  assert.notEqual([...db.accounts.values()][0].passwordHash,'unique-password-alice');assert.notEqual([...db.accounts.values()][0].salt,[...db.accounts.values()][1].salt);
  assert.equal((await accountRequest(request('login',{email:'alice@fixture.test',password:'wrong'}),get)).status,401);
  assert.equal((await accountRequest(request('login',{email:'alice@fixture.test',password:'unique-password-alice'}),get)).status,303);
  assert.equal((await accountRequest(request('signup',{name:'Alice',email:'alice@fixture.test',password:'another-long-password'}),get)).status,409);
  assert.equal((await accountRequest(request('signup',{name:'Bad',email:'owner@fixture.test',password:'another-long-password'}),get)).status,409);
 }finally{for(const key of ['OWNER_SESSION_SECRET','OWNER_EMAIL','APP_ORIGIN'])previous[key]===undefined?delete process.env[key]:process.env[key]=previous[key];}
});
test('account mutations reject foreign origins, weak passwords and tampered sessions',async()=>{
 process.env.OWNER_SESSION_SECRET='fixture-session-key-that-is-long-enough';const db=database();try{
 assert.equal((await accountRequest(request('signup',{name:'Test',email:'test@fixture.test',password:'short'}),async()=>db)).status,400);
 assert.equal((await accountRequest(request('login',{password:'anything'},{Origin:'https://foreign.test'}),async()=>db)).status,403);
 assert.equal(await accountSession(new Request(origin,{headers:{Cookie:'__Host-shortlist_session=forged'}})),null);
 }finally{delete process.env.OWNER_SESSION_SECRET;}
});
