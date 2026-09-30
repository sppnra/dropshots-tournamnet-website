const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
test('manual bank transfer approval, email reliability and private payment records',async t=>{
  const {PGlite}=await import('@electric-sql/pglite');const {createPGlitePool}=await import('./pglite-pool.mjs');
  const {RegistrationService}=await import('../server/registration-service.mjs');const {createApiHandler}=await import('../server/api-handler.mjs');
  const db=new PGlite();t.after(()=>db.close());
  const migrations=path.join(__dirname,'../netlify/database/migrations');
  await db.exec(fs.readFileSync(path.join(migrations,'202609300001_registration.sql'),'utf8'));
  // Upgrade an already deployed schema containing an existing confirmed entry.
  await db.exec(`insert into tournaments(id,name) values('t_legacy','Existing');
    insert into events(id,tournament_id,name,event_type,capacity) values('e_legacy','t_legacy','Legacy Singles','singles',10);
    insert into players(id,tournament_id,name,email,phone) values('00000000-0000-4000-8000-000000000001','t_legacy','Legacy','legacy@example.test','07123456789');
    insert into event_entries(id,event_id,player_id,active) values('en_legacy','e_legacy','00000000-0000-4000-8000-000000000001',true);
    insert into registrations(id,request_key,tournament_id,event_id,player_id,entry_id,status) values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','t_legacy','e_legacy','00000000-0000-4000-8000-000000000001','en_legacy','confirmed');`);
  await db.exec(fs.readFileSync(path.join(migrations,'202609300002_payments.sql'),'utf8'));
  const pool=createPGlitePool(db),sent=[];let failures=new Set();
  const email={send:async(message,key)=>{if(failures.has(message.to.email))throw new Error('Simulated rejection');sent.push({message,key});return {messageId:randomUUID()};}};
  const service=new RegistrationService(pool,email);
  const settings={enabled:true,capacity:20,closeDate:null,allowPartnerNeeded:true,autoWaitlist:true,entryFee:'20.00',paymentRequired:true};
  const catalogue={id:'t_pay',name:'Payment Test Tournament',date:'2026-10-24',venue:'Test hall',revision:0,events:[
    {id:'e_paid',name:'Paid Doubles',type:'doubles',format:'groups2',registration:{...settings}},
    {id:'e_singles_pay',name:'Paid Singles',type:'singles',format:'knockout',registration:{...settings,entryFee:'12.00'}},
    {id:'e_free',name:'Free Singles',type:'singles',format:'roundrobin',registration:{...settings,paymentRequired:false}}
  ]};
  await service.publish(catalogue);
  await service.payments.saveSettings({tournamentId:'t_pay',revision:0,bank_account_name:'Dropshot Folks',bank_name:'Test Bank',sort_code:'12-34-56',account_number:'12345678',payment_reference_prefix:'DF',payment_instructions:'Use the reference. <script>not HTML</script>'});
  const player=n=>({name:`Player ${n}`,email:`player${n}@example.test`,phone:'07123456789'});
  const input=(n,eventId='e_singles_pay',extra={})=>({tournamentId:'t_pay',eventId,requestKey:randomUUID(),needsPartner:false,consent:true,player1:player(n),...extra});
  const row=async id=>(await service.list({tournament:'t_pay'})).registrations.find(r=>r.id===id);
  let first,pair1,pair2;
  await t.test('additive migration preserves existing data and never bills legacy confirmations',async()=>{
    await pool.query("update events set payment_required=true,entry_fee=99 where id='e_legacy'");
    await service.status('00000000-0000-4000-8000-000000000002',{status:'confirmed'});
    const legacy=(await service.list({tournament:'t_legacy'})).registrations[0];assert.equal(legacy.payment_status,'not_required');assert.equal(legacy.payment_reference,null);assert.equal(sent.length,0);
  });
  await t.test('initial registration creates no payment or email',async()=>{
    first=(await service.submit(input(1))).registration;assert.equal(first.status,'pending');assert.equal(sent.length,0);assert.equal((await row(first.id)).payment_status,'not_required');
  });
  await t.test('approval snapshots fee, reserves roster, creates one stable reference and sends once',async()=>{
    await service.status(first.id,{status:'confirmed'});const r=await row(first.id);assert.equal(r.payment_status,'pending');assert.equal(Number(r.payment_amount),12);assert.ok(/^DF-[A-F0-9]{13}$/.test(r.payment_reference));assert.ok(r.approved_at);assert.ok(r.approval_email_sent_at);assert.equal(sent.length,1);
    await Promise.all([service.status(first.id,{status:'confirmed'}),service.status(first.id,{status:'confirmed'})]);
    assert.equal(sent.length,1);assert.equal((await row(first.id)).payment_reference,r.payment_reference);assert.equal((await service.entries('t_pay')).entries.length,1);
    assert.ok(sent[0].message.text.includes('12345678'));assert.ok(!sent[0].message.html.includes('<script>'));assert.ok(!sent[0].message.html.includes('/admin'));
  });
  await t.test('doubles approval privately emails each player and snapshots whole-team fee',async()=>{
    const r=(await service.submit(input(2,'e_paid',{player2:player(3),teamName:'Team Test'}))).registration;
    await service.status(r.id,{status:'confirmed'});assert.equal(sent.length,3);assert.deepEqual(sent.slice(1).map(x=>x.message.to.email).sort(),[player(2).email,player(3).email]);assert.equal(Number((await row(r.id)).payment_amount),20);
  });
  await t.test('free event stays not_required and sends no bank instructions',async()=>{
    const r=(await service.submit(input(4,'e_free'))).registration;await service.status(r.id,{status:'confirmed'});assert.equal((await row(r.id)).payment_status,'not_required');assert.equal(sent.length,3);
  });
  await t.test('mark payment received is idempotent, records trusted actor/history, receipt sends once',async()=>{
    await service.payments.markReceived(first.id,{sendEmail:true},{id:'organizer',email:'organizer@example.test'});const r=await row(first.id);
    assert.equal(r.payment_status,'paid');assert.ok(r.payment_received_at);assert.equal(r.payment_received_by,'organizer@example.test');assert.ok(r.payment_email_sent_at);assert.equal(sent.length,4);
    await service.payments.markReceived(first.id,{sendEmail:true},{id:'other'});assert.equal(sent.length,4);assert.equal((await row(first.id)).payment_received_by,r.payment_received_by);assert.equal((await pool.query('select count(*)::integer as n from payment_audit')).rows[0].n,1);
  });
  await t.test('fee changes do not rewrite approved amounts/references',async()=>{
    catalogue.revision=1;catalogue.events[1].registration.entryFee='25.00';await service.publish(catalogue);
    await service.status(first.id,{status:'confirmed'});assert.equal(Number((await row(first.id)).payment_amount),12);assert.equal(sent.length,4);
  });
  await t.test('approval failure preserves confirmed entry and pending payment; retry keeps identity and snapshot',async()=>{
    const r=(await service.submit(input(5))).registration;failures.add(player(5).email);
    const response=await service.status(r.id,{status:'confirmed'});assert.match(response.warning,/approved/);const before=await row(r.id);assert.equal(before.status,'confirmed');assert.equal(before.payment_status,'pending');assert.equal(before.approval_email_status,'failed');
    failures.clear();await service.payments.retry(r.id,'approval');const after=await row(r.id);assert.equal(after.payment_id,before.payment_id);assert.equal(after.payment_reference,before.payment_reference);assert.equal(after.approval_email_status,'sent');assert.equal(Number(after.payment_amount),25);assert.equal(sent.length,5);
    await service.payments.retry(r.id,'approval');assert.equal(sent.length,5);
  });
  await t.test('receipt failure preserves paid state and retry never resets timestamps',async()=>{
    const r=(await service.list({tournament:'t_pay',search:'Player 5'})).registrations[0];failures.add(player(5).email);
    const response=await service.payments.markReceived(r.id,{sendEmail:true},{id:'organizer'});assert.match(response.warning,/Payment received/);const before=await row(r.id);assert.equal(before.payment_status,'paid');assert.equal(before.payment_email_status,'failed');
    failures.clear();await service.payments.retry(r.id,'payment');const after=await row(r.id);assert.equal(new Date(after.payment_received_at).getTime(),new Date(before.payment_received_at).getTime());assert.equal(after.payment_reference,before.payment_reference);assert.equal(after.payment_email_status,'sent');assert.equal(sent.length,6);
  });
  await t.test('needs-partner pairing creates a shared team payment and totals never double count',async()=>{
    pair1=(await service.submit(input(6,'e_paid',{needsPartner:true}))).registration;pair2=(await service.submit(input(7,'e_paid',{needsPartner:true}))).registration;
    await service.pair({ids:[pair1.id,pair2.id]});const a=await row(pair1.id),b=await row(pair2.id);assert.equal(a.payment_id,b.payment_id);assert.equal(a.payment_reference,b.payment_reference);assert.equal(sent.length,8);
    await service.pair({ids:[pair1.id,pair2.id]});assert.equal(sent.length,8);
    assert.deepEqual((await service.payments.stats('t_pay')).stats,{pending:2,paid:2,expected:77,received:37,outstanding:40});
    await service.payments.markReceived(pair2.id,{sendEmail:false},{id:'organizer'});assert.equal((await row(pair1.id)).payment_status,'paid');assert.equal(sent.length,8);
    await service.status(pair1.id,{status:'withdrawn'});assert.equal((await row(pair1.id)).payment_status,'paid');assert.equal((await service.payments.stats('t_pay')).stats.expected,57);
  });
  await t.test('partial doubles failures retry only the failed recipient',async()=>{
    const r=(await service.submit(input(8,'e_paid',{player2:player(9)}))).registration;failures.add(player(9).email);
    await service.status(r.id,{status:'confirmed'});assert.equal(sent.length,9);failures.clear();await service.payments.retry(r.id,'approval');assert.equal(sent.length,10);assert.equal(sent.filter(s=>s.message.to.email===player(8).email).length,1);
  });
  await t.test('public API excludes bank details, email states and payment administration; forged fields ignored',async()=>{
    const handler=createApiHandler({service,getUser:async()=>null});
    for(const endpoint of ['tournaments?tournament=t_pay','capacity?tournament=t_pay']){
      const response=await handler(new Request('http://localhost/api/'+endpoint));const data=await response.text();for(const secret of ['12345678','sort_code','payment_reference','payment_received','approval_email','@example.test'])assert.ok(!data.includes(secret),secret);
    }
    for(const endpoint of ['payment-settings','payment-stats','catalogue-diagnostic'])assert.equal((await handler(new Request('http://localhost/api/admin/'+endpoint+'?tournament=t_pay'))).status,401);
    for(const action of ['payment','retry-email'])assert.equal((await handler(new Request(`http://localhost/api/admin/registrations/${first.id}/${action}`,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:'{}'}))).status,401);
    const forged=(await service.submit(input(10,'e_free',{payment_status:'paid',payment_reference:'forged'}))).registration;assert.ok(!JSON.stringify(forged).includes('payment'));assert.equal((await row(forged.id)).payment_status,'not_required');
    await assert.rejects(service.payments.markReceived(forged.id,{sendEmail:true},{id:'organizer'}),/No payment/);
  });
  await t.test('uncertain delivery outside the dedupe window blocks blind resend',async()=>{
    const {EmailError}=await import('../server/email.mjs');const original=email.send;
    email.send=async()=>{throw new EmailError('Timeout',true);};
    const r=(await service.submit(input(12))).registration;await service.status(r.id,{status:'confirmed'});assert.equal((await row(r.id)).approval_email_status,'uncertain');
    email.send=original;const before=sent.length;
    await pool.query("update payment_email_outbox set idempotency_started_at=now()-interval '20 minutes' where payment_id=$1",[(await row(r.id)).payment_id]);
    const result=await service.payments.retry(r.id,'approval');assert.ok(result.warning);assert.equal(sent.length,before);assert.equal((await row(r.id)).payment_status,'pending');
  });
  await t.test('missing bank settings do not roll back approval and can be fixed before retry',async()=>{
    await pool.query("update tournament_payment_settings set account_number='' where tournament_id='t_pay'");
    const r=(await service.submit(input(11))).registration;const response=await service.status(r.id,{status:'confirmed'});assert.ok(response.warning);assert.equal((await row(r.id)).payment_status,'pending');
    await pool.query("update tournament_payment_settings set account_number='12345678' where tournament_id='t_pay'");await service.payments.retry(r.id,'approval');assert.ok((await row(r.id)).approval_email_sent_at);
  });
});

test('Brevo adapter uses only server credentials, immutable idempotency key and safe failures',async()=>{
  const {createEmailService,EmailError}=await import('../server/email.mjs');let request;
  const email=createEmailService({env:{EMAIL_API_KEY:'server-only-test-key',EMAIL_FROM:'sender@example.test'},fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({messageId:'accepted'}),{status:201});}});
  const message={to:{email:'player@example.test',name:'Player'},subject:'Approved',html:'<p>Approved</p>',text:'Approved'};
  await email.send(message,'00000000-0000-4000-8000-000000000004');assert.equal(request.options.headers['api-key'],'server-only-test-key');assert.equal(JSON.parse(request.options.body).headers.idempotencyKey,'00000000-0000-4000-8000-000000000004');assert.equal(JSON.parse(request.options.body).to.length,1);
  await assert.rejects(createEmailService({env:{}}).send(message,'key'),/Configure/);
  const failing=createEmailService({env:{EMAIL_API_KEY:'x',EMAIL_FROM:'sender@example.test'},fetchImpl:async()=>{throw new Error('private network details');}});
  await assert.rejects(failing.send(message,'key'),e=>e instanceof EmailError&&e.uncertain&&!e.message.includes('private'));
  const duplicate=createEmailService({env:{EMAIL_API_KEY:'x',EMAIL_FROM:'sender@example.test'},fetchImpl:async()=>new Response(JSON.stringify({code:'duplicate_parameter'}),{status:400})});assert.ok((await duplicate.send(message,'key')).messageId);
});
