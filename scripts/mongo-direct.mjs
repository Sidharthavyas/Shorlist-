import {MongoClient} from 'mongodb';
// Atlas SRV lookups can time out on this Windows network. Resolve public DNS
// over HTTPS while keeping TLS verification and the Atlas hostnames intact.
export async function mongoDirect(uri){
 const u=new URL(uri.replace('mongodb+srv://','https://'));
 async function resolve(name,type){const r=await fetch('https://dns.google/resolve?'+new URLSearchParams({name,type}),{signal:AbortSignal.timeout(8000)});const p=await r.json();return (p.Answer??[]).filter(x=>x.type===Number(type)).map(x=>x.data);}
 const [srv,txt]=await Promise.all([resolve('_mongodb._tcp.'+u.hostname,33),resolve(u.hostname,16)]);if(!srv.length)throw Error('NO_DATABASE_HOSTS');
 const hosts=srv.map(x=>{const p=x.split(' ');return p[3].replace(/\.$/,'')+':'+p[2];}),options=new URLSearchParams(txt.join('').replaceAll('"',''));options.set('tls','true');
 const lookup=(hostname,opts,callback)=>resolve(hostname,1).then(addresses=>{if(!addresses.length)throw Error('NO_ADDRESS');opts?.all?callback(null,addresses.map(address=>({address,family:4}))):callback(null,addresses[0],4);}).catch(callback);
 const client=new MongoClient('mongodb://'+u.username+':'+u.password+'@'+hosts.join(',')+'/shortlist?'+options,{serverSelectionTimeoutMS:10000,connectTimeoutMS:8000,lookup});
 try{await client.connect();return client;}catch(error){await client.close();throw error;}
}
