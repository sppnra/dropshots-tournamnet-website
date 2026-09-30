const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');

test('registration API and relational database complete flow',async t=>{
  const {PGlite}=await import('@electric-sql/pglite');
  const {createPGlitePool}=await import('./pglite-pool.mjs');
  const {RegistrationService}=await import('../server/registration-service.mjs');
  const {createApiHandler}=await import('../server/api-handler.mjs');
  const db=new PGlite();t.after(()=>db.close());
  for(const file of fs.readdirSync(path.join(__dirname,'../netlify/database/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(__dirname,'../netlify/database/migrations',file),'utf8'));
  const pool=createPGlitePool(db),service=new RegistrationService(pool);
  const settings={enabled:true,capacity:2,closeDate:null,allowPartnerNeeded:true,autoWaitlist:true};
  const catalogue={id:'t_test',name:'Test Open',date:'2026-10-24',venue:'Test hall',revision:0,events:[
    {id:'e_singles',name:'Singles',type:'singles',format:'roundrobin',registration:{...settings}},
    {id:'e_doubles',name:'Doubles',type:'doubles',format:'groups2',registration:{...settings}},
    {id:'e_closed',name:'Closed',type:'singles',format:'knockout',registration:{...settings,enabled:false}},
    {id:'e_expired',name:'Expired',type:'singles',format:'knockout',registration:{...settings,closeDate:'2020-01-01'}}
  ]};
  const p=n=>({name:`Player ${n}`,email:`p${n}@example.test`,phone:`07123000${String(n).padStart(3,'0')}`});
  const input=(n,eventId='e_singles',extra={})=>({tournamentId:'t_test',eventId,requestKey:randomUUID(),needsPartner:false,player1:p(n),consent:true,...extra});
  let first,pairA,pairB;
  await t.test('publish and public catalogue expose open events and no contact details',async()=>{
    assert.equal((await service.publish(catalogue)).revision,1);
    const data=await service.catalogue();assert.equal(data.tournaments.length,1);
    assert.deepEqual(data.tournaments[0].events.map(e=>e.id).sort(),['e_doubles','e_singles']);
    assert.ok(!JSON.stringify(data).includes('email'));
    await assert.rejects(service.publish(catalogue),/changed on another device/);
  });
  await t.test('singles registration persists centrally and retries reuse the same row',async()=>{
    const body=input(1);first=(await service.submit(body)).registration;
    assert.equal(first.status,'pending');assert.equal(first.entry_name,'Player 1');
    assert.equal((await service.submit(body)).registration.id,first.id);
    assert.equal((await pool.query('select count(*)::integer as n from registrations')).rows[0].n,1);
    assert.ok(!JSON.stringify(first).includes('@'));
    await assert.rejects(service.submit(input(1)),/already registered/);
  });
  await t.test('confirmation creates an Entry exactly once and API Entries contain names only',async()=>{
    await service.status(first.id,{status:'confirmed'});await service.status(first.id,{status:'confirmed'});
    const entries=(await service.entries('t_test')).entries;assert.equal(entries.length,1);assert.equal(entries[0].p1,'Player 1');
    assert.ok(!JSON.stringify(entries).includes('@'));assert.ok(!JSON.stringify(entries).includes(p(1).phone));
    const list=await service.list({tournament:'t_test',status:'confirmed',search:'Player 1'});
    assert.equal(list.registrations[0].player1_email,p(1).email);assert.equal(list.counts.confirmed,1);
  });
  await t.test('capacity counts confirmed entries; full submissions waitlist and confirmation serializes',async()=>{
    const second=(await service.submit(input(2))).registration;await service.status(second.id,{status:'confirmed'});
    const waiting=(await service.submit(input(3))).registration;assert.equal(waiting.status,'waitlisted');
    await assert.rejects(service.status(waiting.id,{status:'confirmed'}),/Event is full/);
    assert.equal((await service.entries('t_test')).entries.length,2);
    await service.status(first.id,{status:'withdrawn'});await service.status(waiting.id,{status:'confirmed'});
    assert.equal((await service.entries('t_test')).entries.length,2);
  });
  await t.test('partner-needed registrations pair atomically into one doubles entry',async()=>{
    pairA=(await service.submit(input(11,'e_doubles',{needsPartner:true}))).registration;
    pairB=(await service.submit(input(12,'e_doubles',{needsPartner:true}))).registration;
    assert.equal(pairA.status,'needs_partner');await service.pair({ids:[pairA.id,pairB.id]});await service.pair({ids:[pairA.id,pairB.id]});
    const entries=(await service.entries('t_test')).entries.filter(e=>e.event_id==='e_doubles');
    assert.equal(entries.length,1);assert.equal(entries[0].name,'Player 11 / Player 12');
    const rows=(await service.list({event:'e_doubles',status:'confirmed'})).registrations;
    assert.equal(rows.length,2);assert.equal(rows[0].local_entry_id,rows[1].local_entry_id);
    await assert.rejects(service.submit(input(12,'e_doubles',{needsPartner:true})),/already registered/);
  });
  await t.test('full-team doubles share player records across events and missing partner rolls back',async()=>{
    await assert.rejects(service.submit(input(13,'e_doubles')),/partner details/);
    const team=(await service.submit(input(13,'e_doubles',{player2:p(14),teamName:'Court Crew'}))).registration;
    assert.equal(team.entry_name,'Court Crew');await service.status(team.id,{status:'confirmed'});
    const extra=(await service.submit(input(15,'e_doubles',{needsPartner:true}))).registration;
    await assert.rejects(service.pair({ids:[extra.id,pairA.id]}),/Both players/);
    assert.equal((await service.list({event:'e_doubles',status:'needs_partner'})).registrations.length,1);
    assert.equal((await service.entries('t_test')).entries.filter(x=>x.event_id==='e_doubles').length,2);
    // The same player's immutable record is reused for a different event.
    await service.submit(input(13));
    assert.equal((await pool.query('select count(*)::integer as n from players where email=$1',[p(13).email])).rows[0].n,1);
  });
  await t.test('waitlist-off rejects full-event submissions; admin may explicitly override capacity',async()=>{
    await service.publish({...catalogue,revision:1,events:catalogue.events.map(e=>e.id==='e_singles'?{...e,registration:{...e.registration,autoWaitlist:false}}:e)});
    await assert.rejects(service.submit(input(20)),/waitlist is closed/);
    const existing=(await service.list({status:'waitlisted',event:'e_singles'})).registrations[0];
    await service.status(existing.id,{status:'confirmed',overrideCapacity:true});
    assert.equal((await service.entries('t_test')).entries.filter(e=>e.event_id==='e_singles').length,3);
  });
  await t.test('paired withdrawal releases one place; deletion removes registration',async()=>{
    await service.status(pairA.id,{status:'withdrawn'});
    assert.equal((await service.list({event:'e_doubles',status:'withdrawn'})).registrations.length,2);
    assert.equal((await service.entries('t_test')).entries.filter(x=>x.event_id==='e_doubles').length,1);
    await service.remove(pairA.id);assert.equal((await service.list({event:'e_doubles',status:'withdrawn'})).registrations.length,1);
  });
  await t.test('server rejects closed events, forged statuses, invalid contacts and no consent',async()=>{
    await assert.rejects(service.submit(input(30,'e_closed')),/closed/);
    await assert.rejects(service.submit(input(31,'e_expired')),/closed/);
    await assert.rejects(service.submit(input(32,'e_singles',{consent:false})),/agree/);
    await assert.rejects(service.submit(input(33,'e_singles',{player1:{...p(33),email:'bad'}})),/valid player 1 email/);
    await assert.rejects(service.status(first.id,{status:'admin'}),/Invalid/);
    const forged=(await service.submit(input(34,'e_doubles',{needsPartner:true,status:'confirmed',local_entry_id:'hacked'}))).registration;
    assert.equal(forged.status,'needs_partner');
  });
  await t.test('anonymous and non-organizers cannot read or change registrations; CSRF blocked',async()=>{
    const request=(route,method='GET',body=null,origin='https://site.test')=>new Request(`https://site.test/api/${route}`,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const anon=createApiHandler({service,getUser:async()=>null}),member=createApiHandler({service,getUser:async()=>({roles:['member']})}),admin=createApiHandler({service,getUser:async()=>({id:'admin',email:'admin@test',roles:['organizer']})});
    assert.equal((await anon(request('admin/registrations'))).status,401);
    assert.equal((await member(request('admin/catalogue','POST',catalogue))).status,403);
    assert.equal((await admin(request(`admin/registrations/${first.id}`,'PATCH',{status:'confirmed'},'https://evil.test'))).status,403);
    const publicData=await (await anon(request('tournaments'))).json();assert.ok(!JSON.stringify(publicData).includes(p(1).email));
    assert.equal((await admin(request('admin/session'))).status,200);
    assert.equal((await anon(request('admin/entries?tournament=t_test'))).status,401);
  });
});
