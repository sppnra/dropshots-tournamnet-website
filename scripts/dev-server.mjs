// Local demonstration only. This file is never deployed as a Netlify Function.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {RegistrationService} from '../server/registration-service.mjs';
import {createApiHandler} from '../server/api-handler.mjs';
import {createPGlitePool} from '../tests/pglite-pool.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const db=new PGlite();
for(const file of (await fs.readdir(path.join(root,'netlify/database/migrations'))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(path.join(root,'netlify/database/migrations',file),'utf8'));
// Never send real emails from the local demo, even if production env vars exist.
const service=new RegistrationService(createPGlitePool(db),{send:async(message,key)=>{console.log('LOCAL EMAIL PREVIEW ONLY',{kind:message.subject,key});return {messageId:`local-preview-${key}`};}});
await service.publish({id:'local-demo-tournament',name:'Dropshot Folks Local Demo',date:'2026-10-24',venue:'Local test hall',revision:0,events:[
  {id:'local-singles',name:'Singles',type:'singles',format:'roundrobin',registration:{enabled:true,capacity:2,closeDate:null,allowPartnerNeeded:false,autoWaitlist:true}},
  {id:'local-doubles',name:'Doubles',type:'doubles',format:'groups2',registration:{enabled:true,capacity:8,closeDate:null,allowPartnerNeeded:true,autoWaitlist:true}}
]});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const port=Number(process.env.PORT||8888);
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(url.pathname==='/__dev/organizer'){
      res.writeHead(302,{'Set-Cookie':'dropshot_dev_admin=1; HttpOnly; SameSite=Strict; Path=/','Location':'/'});res.end();return;
    }
    if(url.pathname==='/__dev/signout'){
      res.writeHead(302,{'Set-Cookie':'dropshot_dev_admin=; Max-Age=0; Path=/','Location':'/'});res.end();return;
    }
    if(url.pathname.startsWith('/api/')){
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>40000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
      const handler=createApiHandler({service,getUser:async()=>req.headers.cookie?.includes('dropshot_dev_admin=1')?{id:'local-organizer',email:'LOCAL-DEMO-ONLY',roles:['organizer']}:null});
      const result=await handler(request);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());return;
    }
    const file=url.pathname==='/register'?'/register.html':url.pathname==='/'?'/index.html':url.pathname;
    const resolved=path.resolve(root,'dist','.'+decodeURIComponent(file));
    if(!resolved.startsWith(path.join(root,'dist')+path.sep)){res.writeHead(403);res.end();return;}
    const content=await fs.readFile(resolved);res.writeHead(200,{'Content-Type':mime[path.extname(resolved)]||'application/octet-stream'});res.end(content);
  }catch(error){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Page not found. Run npm run build before npm run dev.');}
});
server.listen(port,'127.0.0.1',()=>{
  console.log(`LOCAL DEMO ONLY; data resets on restart.\nOrganizer: http://127.0.0.1:${port}/__dev/organizer\nPlayer: http://127.0.0.1:${port}/register?tournament=local-demo-tournament\nProduction uses Netlify Identity, never this demo login.`);
});
