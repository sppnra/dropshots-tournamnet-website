const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
test('Team Cup registration, secure shared scoring, groups and knockout complete flow',async t=>{
  const {PGlite}=await import('@electric-sql/pglite');const {createPGlitePool}=await import('./pglite-pool.mjs');
  const {RegistrationService}=await import('../server/registration-service.mjs');const {createApiHandler}=await import('../server/api-handler.mjs');
  const db=new PGlite();t.after(()=>db.close());const dir=path.join(__dirname,'../netlify/database/migrations');for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(dir,file),'utf8'));
  const pool=createPGlitePool(db),registration=new RegistrationService(pool),service=registration.teamCup,organizer={id:'organizer',email:'organizer@example.test',roles:['organizer']};
  const publicApi=createApiHandler({service:registration,getUser:async()=>null}),adminApi=createApiHandler({service:registration,getUser:async()=>organizer});
  const tid=(await service.create()).id;const view=()=>service.view(tid,true);
  const body=n=>({tournamentId:tid,requestKey:randomUUID(),teamName:`Team ${String(n).padStart(2,'0')}`,consent:true,members:[1,2,3,4].map(i=>({name:`T${n} Player ${i}`,email:`t${n}p${i}@example.test`,phone:'07123456789',category:i<3?'men':'women',shirtSize:'M'}))});
  const request=(route,data,token)=>new Request('http://localhost/api/'+route,{method:data?'POST':'GET',headers:{...(data?{origin:'http://localhost','content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});
  let s,first,token;
  await t.test('real preset, four-player registration, approval limit and public contact privacy',async()=>{
    s=await view();assert.equal(s.name,'Dropshot Folks Badminton Team Cup 2026');assert.equal(s.config.capacity,18);s.config.capacity=12;await service.configure({tournamentId:tid,version:s.version,config:s.config});assert.equal(s.config.fee_per_person,22);assert.equal(s.event_date,'2026-10-18');
    const input=body(1);const r=await service.register(input);assert.equal(r.team.status,'pending');assert.equal((await service.register(input)).team.id,r.team.id);
    await assert.rejects(service.register({...body(100),members:body(100).members.slice(0,3)}),/four/);
    await service.teamStatus({tournamentId:tid,teamId:r.team.id,status:'confirmed',user:organizer});
    for(let n=2;n<=12;n++){const r=await service.register(body(n));await service.teamStatus({tournamentId:tid,teamId:r.team.id,status:'confirmed',user:organizer});}
    const extra=await service.register(body(13));assert.equal(extra.team.status,'waitlisted');await assert.rejects(service.teamStatus({tournamentId:tid,teamId:extra.team.id,status:'confirmed'}),/Capacity 12/);
    const publicData=JSON.stringify(await service.view(tid));for(const secret of ['@example.test','07123456789','shirt_size','category','request_key','referee_token','sort_code'])assert.ok(!publicData.includes(secret),secret);
  });
  await t.test('groups create exactly three discipline matches per tie',async()=>{
    s=await view();s.config.rules.group={points:11,bestOf:1};s.config.thirdPlace=true;await service.configure({tournamentId:tid,version:s.version,config:s.config});
    s=await view();await service.draw({tournamentId:tid,version:s.version});s=await view();assert.equal(s.groups.length,3);assert.equal(s.ties.length,18);assert.equal(s.matches.length,54);
    for(const tie of s.ties)assert.deepEqual(s.matches.filter(m=>tie.matchIds.includes(m.id)).map(m=>m.discipline).sort(),['MD','WD','XD']);
    first=s.matches.find(m=>m.discipline==='MD');const tie=s.ties.find(t=>t.id===first.tieId);
    const lineup=Object.fromEntries(['a','b'].map(side=>[side,s.teams.find(t=>t.id===tie[side]).members.filter(p=>p.category==='men').map(p=>p.id)]));
    await service.updateMatch({matchId:first.id,version:first.version,action:'setup',court:1,lineup},organizer);s=await view();first=s.matches.find(m=>m.id===first.id);
    await assert.rejects(service.updateMatch({matchId:first.id,version:first.version,action:'correct',a:20,b:20},organizer),/game cap/);
    token=(await service.token({matchId:first.id,action:'generate'},organizer)).token;
  });
  await t.test('token opens only assigned match; invalid and admin routes are rejected',async()=>{
    const result=await service.referee(token);assert.equal(result.match.id,first.id);assert.equal(Object.keys(result).includes('teams'),false);assert.ok(!JSON.stringify(result).includes('@example.test'));
    assert.equal((await publicApi(request('referee',null,'invalid'))).status,403);
    assert.equal((await publicApi(request('admin/team-cup?tournament='+tid))).status,401);
    const other=s.matches.find(m=>m.id!==first.id);
    assert.equal((await publicApi(request('referee',{matchId:other.id,version:0,action:'point',side:'a'},token))).status,403);
    assert.equal((await publicApi(request('referee',{version:first.version,action:'setup',court:2,lineup:first.lineup},token))).status,403);
    const forged=await publicApi(request('admin/payment-settings?tournament='+tid));assert.equal(forged.status,401);
  });
  await t.test('referee adds a point and undo restores the exact game',async()=>{
    let response=await publicApi(request('referee',{action:'point',side:'a',version:first.version},token));assert.equal(response.status,200);
    let data=await service.referee(token);assert.equal(data.match.games[0].a,1);
    response=await publicApi(request('referee',{action:'undo',version:data.match.version},token));assert.equal(response.status,200);data=await service.referee(token);assert.equal(data.match.games[0].a,0);assert.equal(data.match.status,'pending');
  });
  await t.test('two devices cannot overwrite a score with the same version',async()=>{
    const m=(await service.referee(token)).match;
    const results=await Promise.allSettled([service.updateMatch({matchId:m.id,version:m.version,action:'point',side:'a'},null,token),service.updateMatch({matchId:m.id,version:m.version,action:'point',side:'b'},null,token)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
    const current=(await service.referee(token)).match;assert.equal(current.games[0].a+current.games[0].b,1);
  });
  await t.test('court and player overlap are blocked centrally',async()=>{
    s=await view();first=s.matches.find(m=>m.id===first.id);const firstTie=s.ties.find(t=>t.id===first.tieId);
    const other=s.matches.find(m=>m.discipline==='MD'&&m.tieId!==first.tieId&&s.ties.some(t=>t.id===m.tieId&&(t.a===firstTie.a||t.b===firstTie.a)));
    const tie=s.ties.find(t=>t.id===other.tieId),lineup=Object.fromEntries(['a','b'].map(side=>[side,s.teams.find(t=>t.id===tie[side]).members.filter(p=>p.category==='men').map(p=>p.id)]));
    await service.updateMatch({matchId:other.id,version:other.version,action:'setup',court:2,lineup},organizer);
    await assert.rejects(service.updateMatch({matchId:other.id,version:other.version+1,action:'point',side:'a'},organizer),/Court or player/);
  });
  await t.test('completed matches update tie score; two wins clinch and all three finish standings',async()=>{
    let m=(await service.referee(token)).match;
    while(m.status!=='completed'){await service.updateMatch({matchId:m.id,version:m.version,action:'point',side:'a'},null,token);m=(await service.referee(token)).match;}
    s=await view();let tie=s.ties.find(t=>t.id===first.tieId);assert.equal(tie.winsA,1);
    const wd=s.matches.find(m=>m.tieId===tie.id&&m.discipline==='WD');await service.updateMatch({matchId:wd.id,version:wd.version,action:'award',side:'a'},organizer);
    s=await view();tie=s.ties.find(t=>t.id===tie.id);assert.equal(tie.winner,tie.a);assert.notEqual(tie.status,'completed');
    const xd=s.matches.find(m=>m.tieId===tie.id&&m.discipline==='XD');await service.updateMatch({matchId:xd.id,version:xd.version,action:'award',side:'b'},organizer);
    s=await view();tie=s.ties.find(t=>t.id===tie.id);assert.equal(tie.status,'completed');assert.equal(tie.winsA,2);assert.equal(tie.winsB,1);
    const row=s.standings.flatMap(g=>g.rows).find(r=>r.id===tie.a);assert.equal(row.played,1);assert.equal(row.won,1);assert.equal(row.matchesWon,2);assert.equal(row.matchesLost,1);
    assert.equal((await publicApi(request('referee',{action:'point',side:'a',version:m.version},token))).status,409);
    assert.equal((await service.referee(token)).match.status,'completed');
  });
  await t.test('regenerated/disabled links invalidate old tokens',async()=>{
    const old=token;token=(await service.token({matchId:first.id,action:'generate'},organizer)).token;await assert.rejects(service.referee(old),e=>e.status===403);
    await service.token({matchId:first.id,action:'disable'},organizer);await assert.rejects(service.referee(token),e=>e.status===403);
  });
  await t.test('group qualifiers feed knockout with real byes, semifinal winners feed final',async()=>{
    s=await view();for(const m of s.matches.filter(m=>m.status!=='completed'))await service.updateMatch({matchId:m.id,version:m.version,action:'award',side:'a'},organizer);
    s=await view();const quarters=s.ties.filter(t=>t.round==='Quarter-final');assert.equal(quarters.length,4);assert.equal(quarters.filter(t=>t.bye).length,2);assert.equal(s.ties.filter(t=>t.round==='Semi-final').length,2);
    // Correct the last group result while knockout has not started; rebuild safely.
    let groupMatch=s.matches.find(m=>m.id===first.id);await service.updateMatch({matchId:groupMatch.id,version:groupMatch.version,action:'undo'},organizer);
    s=await view();assert.equal(s.ties.some(t=>t.phase==='knockout'),false);groupMatch=s.matches.find(m=>m.id===first.id);await service.updateMatch({matchId:groupMatch.id,version:groupMatch.version,action:'award',side:'a'},organizer);
    s=await view();const rebuiltQuarters=s.ties.filter(t=>t.round==='Quarter-final');
    for(const tie of rebuiltQuarters.filter(t=>!t.bye)){s=await view();for(const m of s.matches.filter(m=>tie.matchIds.includes(m.id)))await service.updateMatch({matchId:m.id,version:m.version,action:'award',side:'a'},organizer);}
    s=await view();const semis=s.ties.filter(t=>t.round==='Semi-final');assert.ok(semis.every(t=>t.a&&t.b&&t.matchIds.length===3));
    for(const tie of semis){s=await view();for(const m of s.matches.filter(m=>tie.matchIds.includes(m.id)))await service.updateMatch({matchId:m.id,version:m.version,action:'award',side:'a'},organizer);}
    s=await view();const final=s.ties.find(t=>t.round==='Final');assert.ok(final.a&&final.b);assert.equal(final.matchIds.length,3);assert.equal(s.ties.find(t=>t.round==='Third place').matchIds.length,3);
    for(const m of s.matches.filter(m=>final.matchIds.includes(m.id)))await service.updateMatch({matchId:m.id,version:m.version,action:'award',side:'b'},organizer);
    s=await view();assert.equal(s.champion,final.b);
    groupMatch=s.matches.find(m=>m.id===first.id);await assert.rejects(service.updateMatch({matchId:groupMatch.id,version:groupMatch.version,action:'undo'},organizer),/downstream/);
  });
  await t.test('public snapshots never leak tokens or private members; audit is organizer-only',async()=>{
    const publicData=JSON.stringify(await service.view(tid));for(const secret of ['referee_token','token_hash','token_text','@example.test','shirt_size','phone','account_number'])assert.ok(!publicData.includes(secret),secret);
    assert.equal((await publicApi(request('admin/team-cup/audit?match='+first.id))).status,401);
    const response=await adminApi(request('admin/team-cup/audit?match='+first.id));assert.equal(response.status,200);assert.ok((await response.json()).events.some(e=>e.action==='undo'));
  });
});

test('2/3/4 groups support different qualifier counts without premature bye progression',async()=>{
  const {newCup,newTie,fillMatches,progress}=await import('../server/team-cup-engine.mjs');
  for(const [groupCount,qualifiers] of [[2,2],[3,1],[3,2],[4,1],[4,2]]){
    const cup=newCup(),matches=[],teams=[];cup.config.groupCount=groupCount;cup.config.qualifiers=qualifiers;
    for(let i=0;i<groupCount;i++){const ids=[];for(let n=0;n<3;n++){const id=randomUUID();ids.push(id);teams.push({id,name:`G${i} T${n}`,status:'confirmed'});}cup.groups.push({id:String(i),name:String(i),teams:ids});for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++){const tie=newTie(cup,matches,{phase:'group',round:'Group',group:String(i),a:ids[a],b:ids[b]});fillMatches(cup,tie,matches);}}
    for(const m of matches){m.status='completed';m.winner='a';}progress(cup,teams,matches);
    const qualified=new Set(cup.ties.filter(t=>t.phase==='knockout').flatMap(t=>[t.a,t.b]).filter(Boolean));assert.equal(qualified.size,groupCount*qualifiers);
    assert.equal(cup.ties.find(t=>t.round==='Final').status,'pending');assert.equal(cup.ties.find(t=>t.round==='Final').winner,null);
  }
});
