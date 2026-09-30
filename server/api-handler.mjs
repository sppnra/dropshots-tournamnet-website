import {HttpError,check} from './validation.mjs';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
export function createApiHandler({service,getUser}){
  return async request=>{
    try{
      const url=new URL(request.url),method=request.method;
      const route=url.pathname.replace(/^\/api\/?|^\/\.netlify\/functions\/registration-api\/?/,'').replace(/\/$/,'');
      const query=Object.fromEntries(url.searchParams);
      check(['GET','POST','PATCH','DELETE'].includes(method),'Method not allowed',405);
      if(method!=='GET'){
        check(request.headers.get('origin')===url.origin,'Request origin is not allowed',403);
        check((request.headers.get('content-type')||'').startsWith('application/json'),'Send JSON data',415);
        check(Number(request.headers.get('content-length')||0)<=40000,'Request is too large',413);
      }
      let user=null;
      if(route.startsWith('admin/')){
        user=await getUser();
        check(user,'Organizer sign-in required',401);
        check(user.roles?.some(role=>['organizer','admin'].includes(role)),'This account needs the organizer role',403);
        if(route==='admin/session'&&method==='GET')return json({user:{id:user.id,email:user.email}});
      }
      let body={};
      if(method!=='GET'){
        const raw=await request.text();check(raw.length<=40000,'Request is too large',413);
        try{body=JSON.parse(raw);}catch{throw new HttpError(400,'Invalid JSON');}
        check(body&&typeof body==='object'&&!Array.isArray(body),'Send a JSON object');
      }
      const db=typeof service==='function'?service():service;
      if(route==='tournaments'&&method==='GET')return json(await db.catalogue(false,query.tournament||null));
      if(route==='capacity'&&method==='GET'){
        check(query.tournament,'Tournament is required');
        const data=await db.catalogue(false,query.tournament);return json({events:data.tournaments[0]?.events||[]});
      }
      if(route==='registrations'&&method==='POST')return json(await db.submit(body),201);
      if(route==='admin/catalogue'&&method==='GET')return json(await db.catalogue(true));
      if(route==='admin/catalogue'&&method==='POST'){
        const result=await db.publish(body);
        const diagnostic=await db.diagnostics(result.id);
        console.info('Registration publish',JSON.stringify({tournament_id:result.id,revision:result.revision,tournament_found:diagnostic.tournament_found,event_ids:diagnostic.events.map(e=>e.id),reason:diagnostic.reason}));
        return json({...result,diagnostic});
      }
      if(route==='admin/catalogue-diagnostic'&&method==='GET')return json(await db.diagnostics(query.tournament));
      if(route==='admin/payment-settings'&&method==='GET')return json(await db.payments.settings(query.tournament));
      if(route==='admin/payment-settings'&&method==='POST')return json(await db.payments.saveSettings(body));
      if(route==='admin/payment-stats'&&method==='GET')return json(await db.payments.stats(query.tournament));
      const paymentRoute=route.match(/^admin\/registrations\/([a-f0-9-]+)\/(payment|retry-email)$/i);
      if(paymentRoute&&method==='POST')return json(paymentRoute[2]==='payment'?await db.payments.markReceived(paymentRoute[1],body,user):await db.payments.retry(paymentRoute[1],body.kind));
      if(route==='admin/registrations'&&method==='GET')return json(await db.list(query));
      if(route==='admin/entries'&&method==='GET')return json(await db.entries(query.tournament));
      if(route==='admin/pair'&&method==='POST')return json(await db.pair(body));
      const match=route.match(/^admin\/registrations\/([a-f0-9-]+)$/i);
      if(match&&method==='PATCH')return json(await db.status(match[1],body));
      if(match&&method==='DELETE')return json(await db.remove(match[1]));
      throw new HttpError(404,'API endpoint not found');
    }catch(error){
      if(error instanceof HttpError)return json({error:error.message},error.status);
      // Never send SQL errors, credentials, or personal details to visitors.
      if(error.code==='23505')return json({error:'This entry or request already exists. Refresh and try again.'},409);
      console.error('Registration API failure',{code:error.code||'UNAVAILABLE'});
      return json({error:'Registration service is unavailable. The organizer may need to enable Netlify Database and deploy its migration.'},503);
    }
  };
}
