export default {
  async fetch(request) {
    const backend=process.env.SHORTLIST_BACKEND_URL;
    const secret=process.env.DEPLOYMENT_PROXY_SECRET;
    if(!backend||!secret)return Response.json({error:{code:'BACKEND_NOT_CONFIGURED',message:'The production backend is not connected yet.'}},{status:503});
    const upstream=new URL(backend);
    if(upstream.protocol!=='https:'||upstream.username||upstream.password||upstream.pathname!=='/')return Response.json({error:{code:'BACKEND_NOT_CONFIGURED',message:'Invalid backend configuration.'}},{status:503});
    const incoming=new URL(request.url);
    // Never resolve user-controlled paths against a URL: //host can change its
    // destination. Only API paths can reach this fixed server-side upstream.
    if(!incoming.pathname.startsWith('/api/'))return new Response('Not found',{status:404});
    upstream.pathname=incoming.pathname;upstream.search=incoming.search;
    const headers=new Headers();
    for(const name of ['accept','content-type','cookie','origin']){
      const value=request.headers.get(name);if(value)headers.set(name,value);
    }
    headers.set('X-Shortlist-Proxy-Token',secret);
    try{
      const body=['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer();
      if(body&&body.byteLength>4*1024*1024)return Response.json({error:{code:'TOO_LARGE',message:'Maximum hosted upload size is 4 MB.'}},{status:413});
      const result=await fetch(upstream,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(55000)});
      const outgoing=new Headers(result.headers);outgoing.set('Cache-Control','private, no-store');
      for(const name of ['content-length','content-encoding','transfer-encoding','connection'])outgoing.delete(name);
      return new Response(result.body,{status:result.status,headers:outgoing});
    }catch{
      return Response.json({error:{code:'BACKEND_UNAVAILABLE',message:'The backend is temporarily unavailable. Please try again.'}},{status:502,headers:{'Cache-Control':'no-store'}});
    }
  }
};
