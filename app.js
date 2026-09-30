const STORAGE_KEY = 'dropshot-folks-v1';
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const uid = (p='id') => `${p}_${Math.random().toString(36).slice(2,9)}${Date.now().toString(36).slice(-4)}`;
const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const clone = obj => JSON.parse(JSON.stringify(obj));
const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let remoteRegistrations = [];
let remoteRegistrationLoading = false;
let authUser = null;


function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmtDate(d){ if(!d) return 'Date TBC'; return new Date(`${d}T12:00:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
function formatName(f){ return ({roundrobin:'Round Robin',groups2:'2 Groups → Knockout',groups4:'4 Groups → Knockout',knockout:'Straight Knockout'})[f] || f; }
function eventTypeName(t){ return t==='doubles' ? 'Doubles' : 'Singles'; }
function defaultScoringRules(){ return {league:{points:21,bestOf:1},knockout:{points:21,bestOf:3},quarterFinal:{points:21,bestOf:3},semiFinal:{points:21,bestOf:3},final:{points:21,bestOf:3}}; }
function normalizeRule(rule,fallback={points:21,bestOf:3}){ return {points:+rule?.points||fallback.points,bestOf:+rule?.bestOf===1?1:3}; }
function ensureEventScoring(e){
  if(!e.scoringRules){ const pts=+e.points||21,bo=+e.bestOf===1?1:3;e.scoringRules={league:{points:pts,bestOf:bo},knockout:{points:pts,bestOf:bo},quarterFinal:{points:pts,bestOf:bo},semiFinal:{points:pts,bestOf:bo},final:{points:pts,bestOf:bo}}; }
  const d=defaultScoringRules();
  for(const k of Object.keys(d))e.scoringRules[k]=normalizeRule(e.scoringRules[k],d[k]);
  return e.scoringRules;
}
function stageKeyForMatch(m){ if(m.phase==='group'||m.phase==='roundrobin')return 'league'; if(m.round==='Final')return 'final'; if(m.round==='Semi Final')return 'semiFinal'; if(m.round==='Quarter Final')return 'quarterFinal'; return 'knockout'; }
function stageRule(e,m){ ensureEventScoring(e); return normalizeRule(m?.scoring,e.scoringRules[stageKeyForMatch(m)]||e.scoringRules.knockout); }
function scoringLabel(rule){ const r=normalizeRule(rule);return `${r.bestOf===1?'1 game':'Best of 3'} × ${r.points}`; }
function scoringSelect(prefix,rule){ const r=normalizeRule(rule);return `<div class="field"><label>Points</label><select id="${prefix}Points"><option value="21" ${r.points===21?'selected':''}>21</option><option value="15" ${r.points===15?'selected':''}>15</option><option value="11" ${r.points===11?'selected':''}>11</option></select></div><div class="field"><label>Match format</label><select id="${prefix}BestOf"><option value="1" ${r.bestOf===1?'selected':''}>1 game</option><option value="3" ${r.bestOf===3?'selected':''}>Best of 3</option></select></div>`; }
function scoringRuleCard(key,title,desc,e){ const r=ensureEventScoring(e)[key];return `<div class="stage-rule-card"><div class="stage-rule-copy"><b>${title}</b><span>${desc}</span><em>${scoringLabel(r)}</em></div><div class="stage-rule-fields">${scoringSelect('rule_'+key,r)}</div></div>`; }
function statusBadge(s){ return `<span class="status ${esc(s)}"><span class="dot"></span>${esc(s)}</span>`; }
function defaultRegistrationConfig(t){return {enabled:false,capacity:16,closeDate:'',allowPartnerNeeded:true,autoWaitlist:true,entryFee:'0.00',paymentRequired:false};}
function ensureEventRegistration(e,t=tournament()){ if(!e.registration)e.registration=defaultRegistrationConfig(t); if(e.registration.capacity==null)e.registration.capacity=16; if(e.registration.enabled==null)e.registration.enabled=false; if(e.registration.allowPartnerNeeded==null)e.registration.allowPartnerNeeded=true;if(e.registration.autoWaitlist==null)e.registration.autoWaitlist=true; if(e.registration.entryFee==null)e.registration.entryFee='0.00';if(e.registration.paymentRequired==null)e.registration.paymentRequired=false; return e.registration; }
function registrationStatusBadge(s){ const map={pending:'Pending',confirmed:'Confirmed',waitlisted:'Waitlisted',rejected:'Rejected',withdrawn:'Withdrawn',needs_partner:'Needs partner'}; return `<span class="status reg-${esc(s)}"><span class="dot"></span>${esc(map[s]||s)}</span>`; }
function registrationLink(t=tournament()){ return `${location.origin}/register?tournament=${encodeURIComponent(t?.id||'')}`; }
function nextPow2(n){ let p=1; while(p<n)p*=2; return p; }
function roundLabel(size){ return size===2?'Final':size===4?'Semi Final':size===8?'Quarter Final':size===16?'Round of 16':size===32?'Round of 32':`Round of ${size}`; }
function toast(msg){ const t=$('#toast'); if(!t)return; t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2200); }

function demoState(){
  const tId=uid('t');
  const eId=uid('e');
  const entries=[
    ['Shuttle Hustlers','Rahul','Alex',1],['Net Ninjas','James','Chris',2],['Drop Squad','Sam','Daniel',3],['Smash Society','Tom','Mike',4],
    ['Racket Rebels','Arjun','Ben',5],['Court Kings','Liam','Noah',6],['Birdie Boys','Ethan','Max',7],['Drive Club','Ryan','Luke',8]
  ].map(x=>({id:uid('en'),name:x[0],p1:x[1],p2:x[2],seed:x[3],group:null}));
  return {
    version:1, route:'dashboard', mode:'admin', activeTournamentId:tId, activeEventId:eId, publicTab:'overview', selectedMatchId:null,
    tournaments:[{
      id:tId,name:'Dropshot Folks Autumn Open',date:todayISO(),venue:'London',courts:4,status:'draft',notes:'Club tournament',createdAt:Date.now(),
      events:[{id:eId,name:"Men's Doubles",type:'doubles',format:'groups2',points:21,bestOf:3,scoringRules:defaultScoringRules(),qualifiers:2,entries,matches:[],groupsGenerated:false,knockoutGenerated:false}]
    }]
  };
}

function load(){ try{ const x=JSON.parse(localStorage.getItem(STORAGE_KEY)); const st=x?.version===1?x:demoState(); (st.tournaments||[]).forEach(t=>(t.events||[]).forEach(e=>{ensureEventScoring(e);ensureEventRegistration(e,t);})); return st; }catch{return demoState();} }
let state=load();
function canEditTournament(){return true;}
function save(msg){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch{toast('Could not save on this device. Export a backup before closing.');return false;}render();if(msg)toast(msg);return true;}
function tournament(){ return state.tournaments.find(t=>t.id===state.activeTournamentId) || state.tournaments[0]; }
function event(){ const t=tournament(); return t?.events.find(e=>e.id===state.activeEventId) || t?.events[0] || null; }
function ensureActive(){const t=tournament();if(t){state.activeTournamentId=t.id;if(!t.events.find(e=>e.id===state.activeEventId))state.activeEventId=t.events[0]?.id||null;}}

function appShell(content){
  const t=tournament();
  const nav=[['dashboard','◫','Dashboard'],['events','◇','Events'],['registrations','✦','Registrations'],['teamcup','♜','Team Cup β'],['entries','♙','Entries'],['draws','⌘','Draws'],['matches','≋','Matches'],['scoring','●','Live scoring'],['courts','⌗','Courts'],['results','♛','Results'],['settings','⚙','Tournament setup']];
  return `<div class="app">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">DF</div><div><b>Dropshot Folks</b><span>Tournament OS</span></div></div>
      <nav class="nav">${nav.map(n=>`<button data-route="${n[0]}" class="${state.route===n[0]?'active':''}"><span class="nav-icon">${n[1]}</span>${n[2]}</button>`).join('')}</nav>
      <div class="sidebar-foot">Tournament engine<br>Saved on this device</div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div class="crumb"><small>Tournament</small><strong>${esc(t?.name||'No tournament')}</strong></div>
        <div class="top-actions">
          <button class="btn tiny desktop-only" data-action="switch-tournament">Switch</button>
          <button class="btn tiny" data-action="public-view">Public view ↗</button>
          <button class="btn tiny primary" data-route="scoring">Score match</button>
        </div>
      </div>
      <div class="content">${content}</div>
    </main>
  </div>`;
}

function pageHead(eyebrow,title,sub,actions=''){ return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${sub}</p></div><div class="head-actions">${actions}</div></div>`; }
function eventTabs(){ const t=tournament(); if(!t?.events.length)return ''; return `<div class="event-strip">${t.events.map(e=>`<button class="event-tab ${e.id===state.activeEventId?'active':''}" data-event="${e.id}">${esc(e.name)} <small>${e.entries.length}</small></button>`).join('')}</div>`; }

function pageDashboard(){
  const t=tournament(); if(!t)return pageTournamentChooser();
  const events=t.events, matches=events.flatMap(e=>e.matches), completed=matches.filter(m=>m.status==='completed').length, live=matches.filter(m=>m.status==='live').length, entries=events.reduce((s,e)=>s+e.entries.length,0);
  const upcoming=matches.filter(m=>m.status!=='completed'&&m.aId&&m.bId).slice(0,7);
  const pct=matches.length?Math.round(completed/matches.length*100):0;
  return pageHead('Organizer console','Tournament control centre','Run your event from setup to the final score. Registration is shared through Netlify. Draws and scoring stay on this device.',`<button class="btn" data-action="switch-tournament">All tournaments</button><button class="btn" data-route="registrations">Registrations</button><button class="btn primary" data-action="new-event">+ Add event</button>`)+
  `<section class="hero"><div class="hero-top"><div><div class="eyebrow">${statusBadge(t.status)}</div><h2>${esc(t.name)}</h2><p>${fmtDate(t.date)} · ${esc(t.venue||'Venue TBC')} · ${t.courts} courts</p></div><div class="head-actions"><button class="btn ghost" style="background:transparent;color:#fff;border-color:#3a5443" data-route="matches">View schedule</button><button class="btn primary" data-action="public-view">Open public board</button></div></div></section>
  <div class="stats"><div class="card stat"><small>Events</small><strong>${events.length}</strong><span>categories</span></div><div class="card stat"><small>Entries</small><strong>${entries}</strong><span>players / pairs</span></div><div class="card stat"><small>Matches</small><strong>${matches.length}</strong><span>${completed} complete</span></div><div class="card stat"><small>Live now</small><strong>${live}</strong><span>${t.courts} courts available</span></div></div>
  <div class="grid two">
    <div class="card"><div class="section-head"><div><h3>Match control</h3><p>Live and upcoming matches across every event</p></div><span class="tag">${pct}% complete</span></div><div class="section-body">${upcoming.length?upcoming.map(m=>matchRow(m)).join(''):'<div class="empty">No fixtures yet. Set up an event, add entries and generate the draw.</div>'}</div></div>
    <div class="grid">
      <div class="card card-pad"><div class="section-head" style="padding:0 0 13px;border:0"><div><h3>Events</h3><p>Competition formats at a glance</p></div></div>${events.length?events.map(e=>`<div style="padding:11px 0;border-bottom:1px solid var(--line)"><div class="inline" style="justify-content:space-between"><b style="font-size:12px">${esc(e.name)}</b><span class="tag ${e.format.startsWith('groups')?'group':e.format==='knockout'?'ko':'rr'}">${esc(formatName(e.format))}</span></div><div class="sub">${eventTypeName(e.type)} · ${e.entries.length} entries · ${e.matches.length} matches</div></div>`).join(''):'<div class="empty">No events yet.</div>'}</div>
      <div class="card card-pad"><div class="section-head" style="padding:0 0 13px;border:0"><div><h3>Tournament progress</h3><p>${completed} of ${matches.length||0} matches complete</p></div></div><div class="progress"><span style="width:${pct}%"></span></div><div class="kpi-mini" style="margin-top:15px"><div><b>${matches.filter(m=>m.status==='pending').length}</b><span>Queued</span></div><div><b>${live}</b><span>Live</span></div><div><b>${completed}</b><span>Complete</span></div></div></div>
    </div>
  </div>`;
}

function pageTournamentChooser(){
  return pageHead('Dropshot Folks','Your tournaments','Create a tournament, configure events, run scoring and publish the live board.',`<button class="btn primary" data-action="new-tournament">+ New tournament</button>`)+
  `<div class="tournament-grid">${state.tournaments.map(t=>{const ms=t.events.flatMap(e=>e.matches);const done=ms.filter(m=>m.status==='completed').length;const pct=ms.length?Math.round(done/ms.length*100):0;return `<div class="card tournament-card" data-open-tournament="${t.id}">${statusBadge(t.status)}<h3>${esc(t.name)}</h3><p>${fmtDate(t.date)} · ${esc(t.venue||'Venue TBC')}</p><div class="t-meta"><span>${t.events.length} events</span><span>${t.courts} courts</span><span>${done}/${ms.length} matches</span></div><div class="progress"><span style="width:${pct}%"></span></div></div>`}).join('')}</div>`;
}

function pageEvents(){ const t=tournament(); return pageHead('Competition setup','Events','A tournament can contain several categories, each with its own entries, format and scoring rules.',`<button class="btn primary" data-action="new-event">+ Add event</button>`)+
 `<div class="tournament-grid">${t.events.map(e=>`<div class="card tournament-card" data-open-event="${e.id}"><span class="tag ${e.format.startsWith('groups')?'group':e.format==='knockout'?'ko':'rr'}">${esc(formatName(e.format))}</span><h3>${esc(e.name)}</h3><p>${eventTypeName(e.type)} · Stage-based scoring</p><div class="t-meta"><span>${e.entries.length} entries</span><span>${e.matches.length} matches</span><span>${e.qualifiers||'—'} qualify/group</span></div></div>`).join('')||'<div class="card empty">No events yet.</div>'}</div>`; }


function pageEntries(){ const e=event(); if(!e)return noEvent(); return pageHead('Roster', 'Entries',`Manage the players or pairs taking part in ${esc(e.name)}. Seed numbers are optional but help distribute stronger entries.`,`<button class="btn" data-action="bulk-entries">Bulk add</button><button class="btn primary" data-action="add-entry">+ Add entry</button>`)+eventTabs()+
 `<div class="card"><div class="section-head"><div><h3>${esc(e.name)} roster</h3><p>${e.entries.length} registered entries · ${eventTypeName(e.type)}</p></div><span class="tag">${esc(formatName(e.format))}</span></div><div class="table-wrap"><table><thead><tr><th>#</th><th>Entry</th><th>Player 1</th><th>Player 2</th><th>Seed</th><th>Group</th><th></th></tr></thead><tbody>${e.entries.map((en,i)=>`<tr><td>${i+1}</td><td><b>${esc(en.name)}</b></td><td>${esc(en.p1)}</td><td>${e.type==='doubles'?esc(en.p2||'—'):'—'}</td><td>${en.seed||'—'}</td><td>${en.group?`<span class="tag group">Group ${en.group}</span>`:'—'}</td><td><button class="btn tiny danger" data-delete-entry="${en.id}">Remove</button></td></tr>`).join('')||'<tr><td colspan="7"><div class="empty">No entries yet.</div></td></tr>'}</tbody></table></div></div>`; }

function pageDraws(){ const e=event(); if(!e)return noEvent(); ensureEventScoring(e); const groupCount=e.format==='groups4'?4:e.format==='groups2'?2:0;
  return pageHead('Competition engine','Draw & format',`Choose how ${esc(e.name)} should run, then configure scoring independently for each stage.`,`<button class="btn" data-action="clear-draw" ${!e.matches.length?'disabled':''}>Clear draw</button><button class="btn primary" data-action="generate-draw">Generate draw</button>`)+eventTabs()+
 `<div class="card card-pad" style="margin-bottom:16px"><div class="format-grid">${[
 ['roundrobin','↻','Round Robin','Everyone plays everyone. Best for smaller events.'],['groups2','◫','2 Groups → KO','Split into A/B, then qualifiers move into the knockout.'],['groups4','▦','4 Groups → KO','Four pools feeding a quarter/semi-final knockout.'],['knockout','♛','Straight Knockout','Fastest format. Lose once and you are out.']
 ].map(f=>`<div class="format-card ${e.format===f[0]?'active':''}" data-format="${f[0]}"><b>${f[1]} &nbsp;${f[2]}</b><span>${f[3]}</span></div>`).join('')}</div>
 <div class="divider"></div>
 <div class="section-head scoring-section-head"><div><h3>Scoring by stage</h3><p>Each stage can use its own game length and match format. Pending matches update when you save; live/completed matches keep the rules they started with.</p></div><span class="tag">Flexible scoring</span></div>
 <div class="stage-rules-grid">
   ${scoringRuleCard('league','Group stage / Round Robin','Use this for pool matches and full round-robin events.',e)}
   ${scoringRuleCard('knockout','Early knockout rounds','Round of 32 / Round of 16 and any knockout round before the quarter-finals.',e)}
   ${scoringRuleCard('quarterFinal','Quarter-finals','Applied automatically to Quarter Final matches.',e)}
   ${scoringRuleCard('semiFinal','Semi-finals','Applied automatically to Semi Final matches.',e)}
   ${scoringRuleCard('final','Final','Applied automatically to the championship match.',e)}
 </div>
 <div class="divider"></div><div class="form-grid three"><div class="field"><label>Qualifiers per group</label><select id="eventQualifiers" ${groupCount?'':'disabled'}><option value="1" ${e.qualifiers===1?'selected':''}>Top 1</option><option value="2" ${e.qualifiers===2?'selected':''}>Top 2</option></select></div><div class="field"><label>Example group rule</label><input value="${esc(scoringLabel(e.scoringRules.league))}" disabled></div><div class="field"><label>Example final rule</label><input value="${esc(scoringLabel(e.scoringRules.final))}" disabled></div></div><div class="inline" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" data-action="save-event-rules">Save stage rules</button></div></div>
 ${e.format.startsWith('groups') && e.entries.some(x=>x.group)?groupPreview(e):''}
 ${knockoutBracket(e)}`; }
function groupPreview(e){ const count=e.format==='groups4'?4:2; return `<div class="group-grid" style="margin-bottom:16px">${Array.from({length:count},(_,i)=>letters[i]).map(g=>`<div class="card group-card"><div class="group-title"><h3>Group ${g}</h3><span class="tag group">${e.entries.filter(x=>x.group===g).length} entries</span></div><div class="section-body">${e.entries.filter(x=>x.group===g).sort((a,b)=>(a.seed||99)-(b.seed||99)).map(x=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><span style="font-size:11px;font-weight:800">${esc(x.name)}</span><span class="sub">Seed ${x.seed||'—'}</span></div>`).join('')}</div></div>`).join('')}</div>`; }

function knockoutBracket(e){ const ko=e.matches.filter(m=>m.phase==='knockout'); if(!ko.length)return ''; const rounds=[...new Set(ko.map(m=>m.roundIndex))].sort((a,b)=>a-b); return `<div class="card"><div class="section-head"><div><h3>Knockout bracket</h3><p>Winners advance automatically when matches are completed</p></div></div><div class="bracket">${rounds.map(r=>{const ms=ko.filter(m=>m.roundIndex===r);return `<div class="round-col"><div class="round-title">${esc(ms[0]?.round||`Round ${r+1}`)}</div>${ms.map(m=>bracketMatch(e,m)).join('')}</div>`}).join('')}</div></div>`; }
function bracketMatch(e,m){ const a=entryName(e,m.aId),b=entryName(e,m.bId); return `<div class="bracket-match"><div class="sub">${esc(m.label)}</div><div class="bracket-side ${m.winnerId===m.aId?'winner':''}"><span>${esc(a)}</span><b>${completedGameWins(m).a}</b></div><div class="bracket-side ${m.winnerId===m.bId?'winner':''}"><span>${esc(b)}</span><b>${completedGameWins(m).b}</b></div></div>`; }

function pageMatches(){ const e=event(); if(!e)return noEvent(); return pageHead('Schedule','Matches',`All fixtures for ${esc(e.name)}. Courts are assigned automatically in order, and you can jump straight into scoring.`,`<button class="btn" data-action="assign-courts">Auto-assign courts</button><button class="btn primary" data-route="scoring">Open scorer</button>`)+eventTabs()+
 `<div class="card"><div class="section-head"><div><h3>Fixture list</h3><p>${e.matches.length} matches · ${e.matches.filter(m=>m.status==='completed').length} completed</p></div></div><div class="table-wrap"><table><thead><tr><th>Match</th><th>Stage</th><th>Players</th><th>Court</th><th>Status</th><th>Score</th><th></th></tr></thead><tbody>${e.matches.map(m=>{const [a,b]=matchNames(e,m);return `<tr><td><b>${esc(m.label)}</b></td><td>${m.group?`<span class="tag group">Group ${m.group}</span>`:`<span class="tag ${m.phase==='knockout'?'ko':'rr'}">${esc(m.round)}</span>`}</td><td>${esc(a)}<div class="sub">vs ${esc(b)}</div></td><td>${m.court||'—'}<div class="sub">${esc(scoringLabel(stageRule(e,m)))}</div></td><td>${statusBadge(m.status)}</td><td><b>${esc(scoreText(m))}</b></td><td>${m.aId&&m.bId&&m.status!=='completed'?`<button class="btn tiny" data-score-match="${m.id}">Score</button>`:''}</td></tr>`}).join('')||'<tr><td colspan="7"><div class="empty">No matches generated yet.</div></td></tr>'}</tbody></table></div></div>`; }

function pageScoring(){ const e=event(); if(!e)return noEvent(); const scoreable=e.matches.filter(m=>m.aId&&m.bId&&!m.bye); let m=e.matches.find(x=>x.id===state.selectedMatchId&&x.aId&&x.bId&&!x.bye)||scoreable.find(x=>x.status!=='completed')||scoreable.at(-1); if(m)state.selectedMatchId=m.id;
  return pageHead('Match desk','Live scoring','Designed for a laptop or courtside phone. Standard rally scoring is enforced automatically.',`<button class="btn" data-action="assign-courts">Refresh courts</button>`)+eventTabs()+
 `<div class="scorer-layout"><div class="card match-picker"><div class="section-head"><div><h3>Ready to score</h3><p>${scoreable.length} matches available</p></div></div>${scoreable.map(x=>{const[a,b]=matchNames(e,x);return `<div class="picker-row ${m?.id===x.id?'active':''}" data-score-match="${x.id}"><div class="inline" style="justify-content:space-between"><b style="font-size:11px">${esc(x.label)} · Court ${x.court||'—'}</b>${statusBadge(x.status)}</div><div class="teamline" style="margin-top:5px">${esc(a)} <span class="sub">vs</span> ${esc(b)}</div><div class="sub">${esc(x.group?`Group ${x.group}`:x.round)}</div></div>`}).join('')||'<div class="empty">No matches ready. Generate a draw first.</div>'}</div>
 <div>${m?scorer(e,m):'<div class="card empty">Select a match to score.</div>'}</div></div>`; }

function scorer(e,m){ const [a,b]=matchNames(e,m),g=currentGame(m),wins=completedGameWins(m),rule=stageRule(e,m); return `<div class="scorer"><div class="scorer-top"><div><div class="eyebrow" style="color:var(--brand)">${esc(m.label)} · Court ${m.court||'—'}</div><h2 style="margin:5px 0 3px;font-size:22px">${esc(m.group?`Group ${m.group}`:m.round)}</h2><div class="sub">${esc(scoringLabel(rule))} · Game ${m.games.length} · Match games ${wins.a}–${wins.b} · First to ${rule.points}</div></div>${statusBadge(m.status==='pending'?'ready':m.status)}</div>
 <div class="score-team"><div><b>${esc(a)}</b><div class="sub">${esc(entryPlayers(e,m.aId))}</div></div><div class="big-score">${g.a}</div></div>
 <div class="score-team"><div><b>${esc(b)}</b><div class="sub">${esc(entryPlayers(e,m.bId))}</div></div><div class="big-score">${g.b}</div></div>
 <div class="point-buttons"><button data-point="a" data-match="${m.id}" ${m.status==='completed'?'disabled':''}>+1 ${esc(a)}</button><button data-point="b" data-match="${m.id}" ${m.status==='completed'?'disabled':''}>+1 ${esc(b)}</button></div>
 <div class="scorer-actions"><button data-action="undo-point" data-match="${m.id}">Undo point</button><button data-action="force-a" data-match="${m.id}">A wins match</button><button data-action="force-b" data-match="${m.id}">B wins match</button></div>
 <div class="game-history"><b>Completed games:</b> ${m.games.filter(x=>x.complete).map(x=>`${x.a}-${x.b}`).join(' · ')||'None yet'}</div></div>`; }

function pageCourts(){ const t=tournament(); const all=t.events.flatMap(e=>e.matches.map(m=>({...m,_event:e}))); return pageHead('Venue operations','Courts','A tournament-day view of what is live and what is queued on every court.',`<button class="btn primary" data-action="assign-all-courts">Auto-assign all</button>`)+
 `<div class="court-grid">${Array.from({length:t.courts},(_,i)=>i+1).map(c=>{const ms=all.filter(m=>m.court===c&&m.status!=='completed');const live=ms.find(m=>m.status==='live');const cur=live||ms[0];return `<div class="card court"><div class="court-head"><b>COURT ${c}</b>${statusBadge(live?'live':cur?'ready':'draft')}</div>${cur?`<div class="court-live"><div class="sub">${esc(cur._event.name)} · ${esc(cur.group?`Group ${cur.group}`:cur.round)}</div><b style="font-size:12px">${esc(entryName(cur._event,cur.aId))}</b><div class="sub">vs</div><b style="font-size:12px">${esc(entryName(cur._event,cur.bId))}</b><div style="margin-top:8px"><button class="btn tiny dark" data-open-score-event="${cur._event.id}" data-score-match="${cur.id}">Open scorer</button></div></div>`:'<div class="empty">Court available</div>'}${ms.slice(cur?1:0,4).map(x=>`<div class="queue-item"><b>${esc(x.label)}</b> · ${esc(entryName(x._event,x.aId))} vs ${esc(entryName(x._event,x.bId))}</div>`).join('')}</div>`}).join('')}</div>`; }

function pageResults(){ const e=event(); if(!e)return noEvent(); const completed=e.matches.filter(m=>m.status==='completed'); const champ=findChampion(e); return pageHead('Tournament record','Results',`Completed matches and final outcome for ${esc(e.name)}.`,`<button class="btn" data-action="public-view">Open public results</button>`)+eventTabs()+
 `${champ?`<div class="hero"><div class="hero-top"><div><div class="eyebrow">Champion</div><h2>🏆 ${esc(champ.name)}</h2><p>${esc(champ.p1)}${champ.p2?` / ${esc(champ.p2)}`:''}</p></div></div></div>`:''}
 <div class="card"><div class="section-head"><div><h3>Completed matches</h3><p>${completed.length} finished</p></div></div><div class="table-wrap"><table><thead><tr><th>Match</th><th>Stage</th><th>Winner</th><th>Score</th><th>Court</th></tr></thead><tbody>${completed.slice().reverse().map(m=>`<tr><td><b>${esc(m.label)}</b></td><td>${esc(m.group?`Group ${m.group}`:m.round)}</td><td><b>${esc(entryName(e,m.winnerId))}</b></td><td>${esc(scoreText(m))}</td><td>${m.court||'—'}</td></tr>`).join('')||'<tr><td colspan="5"><div class="empty">No completed matches yet.</div></td></tr>'}</tbody></table></div></div>`; }

function pageSettings(){ const t=tournament(); return pageHead('Configuration','Tournament setup','Basic tournament details used throughout the organizer console and public scoreboard.',`<button class="btn danger" data-action="delete-tournament">Delete tournament</button><button class="btn primary" data-action="save-tournament">Save changes</button>`)+
 `<div class="grid two"><div class="card card-pad"><div class="form-grid"><div class="field"><label>Tournament name</label><input id="setName" value="${esc(t.name)}"></div><div class="field"><label>Date</label><input id="setDate" type="date" value="${esc(t.date)}"></div><div class="field"><label>Venue</label><input id="setVenue" value="${esc(t.venue||'')}"></div><div class="field"><label>Number of courts</label><input id="setCourts" type="number" min="1" max="30" value="${t.courts}"></div><div class="field"><label>Status</label><select id="setStatus">${['draft','registration','ready','live','completed'].map(s=>`<option value="${s}" ${t.status===s?'selected':''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select></div><div class="field"><label>Notes</label><input id="setNotes" value="${esc(t.notes||'')}"></div></div></div>
 <div class="card card-pad"><h3 style="margin-top:0">Backup & test</h3><p class="sub">Match scoring and draws are still stored in this browser. Player registration is shared through Netlify. Export a JSON backup before a real event.</p><div class="inline" style="margin-top:14px"><button class="btn" data-action="export-backup">Export backup</button><label class="btn" style="cursor:pointer">Import backup<input id="importBackup" type="file" accept="application/json" hidden></label><button class="btn danger" data-action="reset-demo">Reset demo</button></div><div class="notice warning" style="margin-top:15px">Registration is stored centrally on Netlify. Draws, matches, courts and scores remain on this device. Export a backup before tournament day.</div></div></div>`; }

function noEvent(){ return pageHead('Events','No event selected','Create an event such as Men’s Doubles or Mixed Doubles first.',`<button class="btn primary" data-action="new-event">+ Add event</button>`); }
function matchRow(m){ const e=tournament().events.find(x=>x.id===m.eventId);const[a,b]=matchNames(e,m);return `<div class="list-row"><div><b style="font-size:11px">${esc(m.label)}</b><div class="sub">Court ${m.court||'—'}</div></div><div class="teamline">${esc(a)}<div class="sub">vs ${esc(b)} · ${esc(e.name)}</div></div><div>${statusBadge(m.status)}</div><div class="score">${esc(scoreText(m))}</div></div>`; }

function publicView(){const t=tournament();const all=t.events.flatMap(e=>e.matches.map(m=>({...m,_event:e}))); const live=all.filter(m=>m.status==='live'); const upcoming=all.filter(m=>m.status==='pending'&&m.aId&&m.bId).slice(0,8); const complete=all.filter(m=>m.status==='completed').length;
  let body=''; if(state.publicTab==='overview') body=`<div class="stats"><div class="card stat"><small>Events</small><strong>${t.events.length}</strong><span>categories</span></div><div class="card stat"><small>Matches</small><strong>${all.length}</strong><span>${complete} complete</span></div><div class="card stat"><small>Live</small><strong>${live.length}</strong><span>right now</span></div><div class="card stat"><small>Courts</small><strong>${t.courts}</strong><span>in use</span></div></div><div class="grid two"><div class="card"><div class="section-head"><div><h3>Live & next up</h3><p>Scores update here from the organizer console</p></div></div><div class="section-body">${[...live,...upcoming].slice(0,10).map(m=>publicMatch(m)).join('')||'<div class="empty">No matches scheduled yet.</div>'}</div></div><div class="card card-pad"><h3 style="margin-top:0">Events</h3>${t.events.map(e=>`<div style="padding:11px 0;border-bottom:1px solid var(--line)"><b style="font-size:12px">${esc(e.name)}</b><div class="sub">${formatName(e.format)} · ${e.entries.length} entries</div></div>`).join('')}</div></div>`;
  if(state.publicTab==='live') body=`<div class="card"><div class="section-head"><div><h3>Live matches</h3><p>${live.length} currently scoring</p></div></div><div class="section-body">${live.map(m=>publicMatch(m)).join('')||'<div class="empty">Nothing live right now.</div>'}</div></div>`;
  if(state.publicTab==='groups') body=t.events.map(e=>standingsPublic(e)).join('')||'<div class="card empty">No group standings yet.</div>';
  if(state.publicTab==='draws') body=t.events.map(e=>`<div style="margin-bottom:16px"><h2 style="font-size:18px">${esc(e.name)}</h2>${knockoutBracket(e)||'<div class="card empty">No knockout draw yet.</div>'}</div>`).join('');
  if(state.publicTab==='register') body=`<div class="card card-pad public-register-cta"><div><div class="eyebrow">Registration</div><h2>Play in ${esc(t.name)}</h2><p>Choose your event and submit your player or team details on the registration page.</p></div><a class="btn primary" href="${esc(registrationLink(t))}">Register now →</a></div>`;
  if(state.publicTab==='results') body=t.events.map(e=>`<div class="card" style="margin-bottom:15px"><div class="section-head"><div><h3>${esc(e.name)}</h3><p>${e.matches.filter(m=>m.status==='completed').length} results</p></div>${findChampion(e)?`<b>🏆 ${esc(findChampion(e).name)}</b>`:''}</div><div class="section-body">${e.matches.filter(m=>m.status==='completed').slice().reverse().slice(0,12).map(m=>`<div class="list-row"><div><b style="font-size:11px">${esc(m.label)}</b></div><div class="teamline">${esc(entryName(e,m.winnerId))}<div class="sub">def. ${esc(entryName(e,m.winnerId===m.aId?m.bId:m.aId))}</div></div><div>${esc(scoreText(m))}</div><div>✓</div></div>`).join('')||'<div class="empty">No results yet.</div>'}</div></div>`).join('');
  return `<div class="public-shell"><header class="public-head"><div class="public-nav"><div class="public-brand"><div class="brand-mark" style="width:36px;height:36px">DF</div>DROPSHOT FOLKS</div><button class="btn tiny" data-action="admin-view">Organizer view</button></div></header><main class="public-main"><div class="public-hero"><div><div class="eyebrow">${statusBadge(t.status)}</div><h1>${esc(t.name)}</h1><p>${fmtDate(t.date)} · ${esc(t.venue||'Venue TBC')}</p></div><div class="kpi-mini"><div><b>${all.length}</b><span>Matches</span></div><div><b>${complete}</b><span>Complete</span></div><div><b>${t.courts}</b><span>Courts</span></div></div></div><div class="public-tabs">${[['overview','Overview'],['live','Live'],['groups','Groups'],['draws','Draw'],['register','Register'],['results','Results']].map(x=>`<button class="${state.publicTab===x[0]?'active':''}" data-public-tab="${x[0]}">${x[1]}</button>`).join('')}</div>${live.length?`<div class="live-banner">● ${live.length} match${live.length>1?'es':''} live now</div>`:''}<div style="margin-top:16px">${body}</div></main></div>`; }
function publicMatch(m){ const e=m._event||tournament().events.find(x=>x.id===m.eventId);const[a,b]=matchNames(e,m);return `<div class="list-row"><div><b style="font-size:11px">${esc(m.label)}</b><div class="sub">Court ${m.court||'—'}</div></div><div class="teamline">${esc(a)}<div class="sub">vs ${esc(b)} · ${esc(e.name)}</div></div><div>${statusBadge(m.status)}</div><div class="score">${esc(scoreText(m))}</div></div>`; }
function standingsPublic(e){ if(!['roundrobin','groups2','groups4'].includes(e.format))return ''; const groups=e.format==='roundrobin'?[null]:Array.from({length:e.format==='groups4'?4:2},(_,i)=>letters[i]);return `<div style="margin-bottom:18px"><h2 style="font-size:18px">${esc(e.name)}</h2><div class="group-grid">${groups.map(g=>`<div class="card group-card"><div class="group-title"><h3>${g?`Group ${g}`:'Standings'}</h3></div>${standingsTable(standings(e,g))}</div>`).join('')}</div></div>`; }

function render(){ ensureActive(); let html;if(state.mode==='public') html=publicView(); else {if(state.route==='tournaments')html=appShell(pageTournamentChooser()); else {const pages={dashboard:pageDashboard,events:pageEvents,registrations:pageRegistrations,entries:pageEntries,draws:pageDraws,matches:pageMatches,scoring:pageScoring,courts:pageCourts,results:pageResults,settings:pageSettings};html=appShell((pages[state.route]||pageDashboard)());}} $('#app').innerHTML=html; bindDynamic(); }

function entryName(e,id){ if(!id)return 'TBD'; return e?.entries.find(x=>x.id===id)?.name||'TBD'; }
function entryPlayers(e,id){ const x=e?.entries.find(y=>y.id===id); if(!x)return ''; return x.p2?`${x.p1} / ${x.p2}`:x.p1; }
function matchNames(e,m){ return [entryName(e,m.aId),entryName(e,m.bId)]; }
function currentGame(m){ if(!m.games?.length)m.games=[{a:0,b:0,complete:false}]; return m.games[m.games.length-1]; }
function completedGameWins(m){ return (m.games||[]).reduce((s,g)=>{if(g.complete){if(g.a>g.b)s.a++;else s.b++;}return s;},{a:0,b:0}); }
function scoreText(m){ if(m.walkover)return 'Awarded';if(m.bye)return 'Bye';const done=(m.games||[]).filter(g=>g.complete).map(g=>`${g.a}-${g.b}`); const g=(m.games||[]).findLast?.(x=>!x.complete) || (m.games||[]).filter(x=>!x.complete).slice(-1)[0]; if(m.status!=='completed'&&g&&(g.a||g.b))done.push(`${g.a}-${g.b}`); return done.join(' · ')||'—'; }
function gameWon(rule,g,side){ if(typeof DropshotScoring!=='undefined')return DropshotScoring.gameWon(rule,g,side);const a=g.a,b=g.b,p=rule.points||21,cap=p===21?30:p+9; const s=side==='a'?a:b,o=side==='a'?b:a; return (s>=p&&s-o>=2)||s>=cap; }
function matchNeededWins(rule){ if(typeof DropshotScoring!=='undefined')return DropshotScoring.neededWins(rule);return Math.floor((rule.bestOf||3)/2)+1; }

function makeMatch(e, data={}){ const base={phase:data.phase||'roundrobin',round:data.round||'',group:data.group||null};ensureEventScoring(e);const scoring=clone(e.scoringRules[stageKeyForMatch(base)]||e.scoringRules.knockout);return {id:uid('m'),eventId:e.id,label:data.label||'',phase:base.phase,round:base.round,roundIndex:data.roundIndex??0,group:base.group,aId:data.aId||null,bId:data.bId||null,court:data.court||null,status:data.status||'pending',scoring,games:[{a:0,b:0,complete:false}],history:[],winnerId:null,nextMatchId:data.nextMatchId||null,nextSlot:data.nextSlot||null}; }
function allPairs(ids){ const out=[]; for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)out.push([ids[i],ids[j]]); return out; }
function sortedEntries(e){ return [...e.entries].sort((a,b)=>(a.seed??999)-(b.seed??999)||a.name.localeCompare(b.name)); }
function assignGroups(e,count){ const arr=sortedEntries(e); e.entries.forEach(x=>x.group=null); arr.forEach((x,i)=>{const cycle=Math.floor(i/count),pos=i%count;const idx=cycle%2===0?pos:count-1-pos;x.group=letters[idx];}); e.groupsGenerated=true; }
function generateDraw(e){ if(e.entries.length<2){toast('Add at least 2 entries first.');return;}
  const groups=e.format==='groups4'?4:e.format==='groups2'?2:0;
  if(groups&&e.entries.length<groups*(e.qualifiers||2)){toast(`Add at least ${groups*(e.qualifiers||2)} entries for this group format and qualifier count`);return;}
  e.matches=[];e.knockoutGenerated=false;e.groupsGenerated=false;e.entries.forEach(x=>x.group=null);
  if(e.format==='roundrobin'){ allPairs(sortedEntries(e).map(x=>x.id)).forEach((p,i)=>e.matches.push(makeMatch(e,{label:`M${i+1}`,phase:'roundrobin',round:'Round Robin',aId:p[0],bId:p[1]}))); }
  if(e.format==='groups2'||e.format==='groups4'){ const count=e.format==='groups4'?4:2;assignGroups(e,count);let n=1;for(let i=0;i<count;i++){const g=letters[i],ids=e.entries.filter(x=>x.group===g).map(x=>x.id);allPairs(ids).forEach(p=>e.matches.push(makeMatch(e,{label:`M${n++}`,phase:'group',round:`Group ${g}`,group:g,aId:p[0],bId:p[1]})));} }
  if(e.format==='knockout') createKnockout(e,sortedEntries(e).map(x=>x.id));
  autoAssignEventCourts(e);save('Draw generated'); }

function createKnockout(e,ids,labelPrefix='',preservePairs=false){ if(ids.length<2)return; const size=nextPow2(ids.length),roundSizes=[]; for(let s=size;s>=2;s/=2)roundSizes.push(s); const rounds=[]; roundSizes.forEach((s,ri)=>{const cnt=s/2,round=[];for(let i=0;i<cnt;i++)round.push(makeMatch(e,{label:`${labelPrefix}${roundLabel(s).replaceAll(' ','').slice(0,3).toUpperCase()}${i+1}`,phase:'knockout',round:roundLabel(s),roundIndex:ri}));rounds.push(round);});
  for(let r=0;r<rounds.length-1;r++)rounds[r].forEach((m,i)=>{m.nextMatchId=rounds[r+1][Math.floor(i/2)].id;m.nextSlot=i%2===0?'a':'b';});
  let seeds=[1,2];for(let n=4;n<=size;n*=2)seeds=seeds.flatMap(s=>[s,n+1-s]);
  const ordered=preservePairs?[...ids]:seeds.map(s=>ids[s-1]||null);while(ordered.length<size)ordered.push(null);
  rounds[0].forEach((m,i)=>{m.aId=ordered[i*2]||null;m.bId=ordered[i*2+1]||null;}); e.matches.push(...rounds.flat()); e.knockoutGenerated=true; advanceByes(e); }
function advanceByes(e){
  let changed=true;
  while(changed){
    changed=false;
    e.matches.filter(m=>m.phase==='knockout'&&m.status!=='completed').forEach(m=>{
      const feeders=e.matches.filter(x=>x.nextMatchId===m.id);
      // A later round's empty slot is unresolved until its feeder has finished.
      if(feeders.some(x=>x.status!=='completed'))return;
      if(!m.aId&&!m.bId){m.status='completed';m.bye=true;changed=true;return;}
      if(!m.aId||!m.bId){
        m.winnerId=m.aId||m.bId;m.status='completed';m.bye=true;
        feedWinner(e,m,m.winnerId);changed=true;
      }
    });
  }
}
function feedWinner(e,m,winnerId){ if(!m.nextMatchId)return; const next=e.matches.find(x=>x.id===m.nextMatchId); if(!next)return; if(m.nextSlot==='a')next.aId=winnerId;else next.bId=winnerId; }
function maybeCreateGroupKnockout(e){ if(!e.format.startsWith('groups')||e.knockoutGenerated)return; const gs=e.matches.filter(m=>m.phase==='group');if(!gs.length||gs.some(m=>m.status!=='completed'))return; const count=e.format==='groups4'?4:2,q=e.qualifiers||2; const by={};for(let i=0;i<count;i++)by[letters[i]]=standings(e,letters[i]).slice(0,q).map(r=>r.id); let ids=[];
  if(count===2&&q===1) ids=[by.A[0],by.B[0]];
  else if(count===2) ids=[by.A[0],by.B[1],by.B[0],by.A[1]];
  else if(count===4&&q===1) ids=[by.A[0],by.B[0],by.C[0],by.D[0]];
  else ids=[by.A[0],by.B[1],by.C[0],by.D[1],by.B[0],by.A[1],by.D[0],by.C[1]];
  ids=ids.filter(Boolean); createKnockout(e,ids,'KO-',true); autoAssignEventCourts(e); }

function standings(e,group=null){ const entries=e.entries.filter(x=>group?x.group===group:true);const rows=entries.map(x=>({id:x.id,name:x.name,p:0,w:0,l:0,gf:0,ga:0,pf:0,pa:0}));const map=Object.fromEntries(rows.map(x=>[x.id,x]));const matches=e.matches.filter(m=>m.status==='completed'&&(group?m.group===group:m.phase==='roundrobin'));matches.forEach(m=>{const a=map[m.aId],b=map[m.bId];if(!a||!b)return;a.p++;b.p++;if(m.winnerId===m.aId){a.w++;b.l++;}else{b.w++;a.l++;}(m.games||[]).filter(g=>g.complete).forEach(g=>{a.pf+=g.a;a.pa+=g.b;b.pf+=g.b;b.pa+=g.a;if(g.a>g.b){a.gf++;b.ga++;}else{b.gf++;a.ga++;}});});return rows.sort((x,y)=>y.w-x.w||((y.gf-y.ga)-(x.gf-x.ga))||((y.pf-y.pa)-(x.pf-x.pa))||x.name.localeCompare(y.name)); }
function standingsTable(rows){ return `<div class="table-wrap"><table><thead><tr><th>Pos</th><th>Entry</th><th>P</th><th>W</th><th>L</th><th>Games +/-</th><th>Points +/-</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td><b>${esc(r.name)}</b></td><td>${r.p}</td><td>${r.w}</td><td>${r.l}</td><td>${signed(r.gf-r.ga)}</td><td>${signed(r.pf-r.pa)}</td></tr>`).join('')}</tbody></table></div>`; }
function signed(n){return n>0?`+${n}`:`${n}`;}
function findChampion(e){ const finals=e.matches.filter(m=>m.phase==='knockout'&&m.round==='Final'&&m.status==='completed');if(finals.length)return e.entries.find(x=>x.id===finals.at(-1).winnerId);if(e.format==='roundrobin'&&e.matches.length&&e.matches.every(m=>m.status==='completed'))return e.entries.find(x=>x.id===standings(e)[0]?.id);return null; }

function autoAssignEventCourts(e){ const t=tournament();let c=1;e.matches.filter(m=>m.status!=='completed').forEach(m=>{m.court=c;c=c>=t.courts?1:c+1;}); }
function autoAssignAll(){ const t=tournament();let c=1;t.events.flatMap(e=>e.matches.map(m=>({e,m}))).filter(x=>x.m.status!=='completed').forEach(x=>{x.m.court=c;c=c>=t.courts?1:c+1;});save('Courts assigned'); }
function matchSnapshot(m){ return clone({games:m.games,status:m.status,winnerId:m.winnerId,walkover:!!m.walkover}); }
function matchHasStarted(m){return m.status==='live'||(m.history||[]).length>0||(m.games||[]).some(g=>g.a||g.b);}
function canStartMatch(e,m){
  if(e.matches.some(x=>x.nextMatchId===m.id&&x.status!=='completed'))return false;
  const t=tournament();
  const names=new Set([m.aId,m.bId].flatMap(id=>{const en=e.entries.find(x=>x.id===id);return [en?.p1,en?.p2].filter(Boolean).map(s=>s.trim().toLowerCase());}));
  return !t.events.some(ev=>ev.matches.some(x=>{
    if(x.id===m.id||x.status!=='live')return false;
    if(m.court&&x.court===m.court)return true;
    return [x.aId,x.bId].some(id=>{const en=ev.entries.find(y=>y.id===id);return [en?.p1,en?.p2].filter(Boolean).some(s=>names.has(s.trim().toLowerCase()));});
  }));
}
function addPoint(matchId,side){
  if(!canEditTournament())return;
  const e=event(),m=e.matches.find(x=>x.id===matchId);
  if(!m||m.status==='completed'||!m.aId||!m.bId||!['a','b'].includes(side))return;
  if(!canStartMatch(e,m))return toast('Court or player is already in a live match, or an earlier round is unfinished');
  const before=matchSnapshot(m),rule=stageRule(e,m);
  m.status='live';const g=currentGame(m);g[side]++;
  m.history.push({type:'point',side,ts:Date.now(),before});
  if(gameWon(rule,g,side)){g.complete=true;const wins=completedGameWins(m);if(wins[side]>=matchNeededWins(rule))completeMatch(e,m,side);else m.games.push({a:0,b:0,complete:false});}
  save();
}
function undoPoint(matchId){
  if(!canEditTournament())return;
  const e=event(),m=e.matches.find(x=>x.id===matchId),h=m?.history?.at(-1);
  if(!h)return toast('Nothing to undo');
  const descendants=[];let next=e.matches.find(x=>x.id===m.nextMatchId);
  while(next){descendants.push(next);next=e.matches.find(x=>x.id===next.nextMatchId);}
  const groupKnockout=m.phase==='group'?e.matches.filter(x=>x.phase==='knockout'):[];
  if(m.status==='completed'&&[...descendants,...groupKnockout].some(matchHasStarted))return toast('Correct the later matches first; this result is already in use');
  if(m.status==='completed'){
    if(groupKnockout.length){e.matches=e.matches.filter(x=>x.phase!=='knockout');e.knockoutGenerated=false;}
    let feeder=m;
    for(const child of descendants){child[feeder.nextSlot==='a'?'aId':'bId']=null;child.status='pending';child.winnerId=null;child.bye=false;feeder=child;}
  }
  m.history.pop();
  if(h.before)Object.assign(m,clone(h.before));
  else if(h.type==='point'){
    // V1 history did not contain snapshots. Reopen the previous game if needed.
    if(m.games.length>1&&!currentGame(m).a&&!currentGame(m).b&&!currentGame(m).complete)m.games.pop();
    const g=currentGame(m);g.complete=false;g[h.side]=Math.max(0,g[h.side]-1);m.status=m.history.length?'live':'pending';m.winnerId=null;
  }
  save('Last scoring action undone');
}
function forceWin(matchId,side){
  if(!canEditTournament())return;
  const e=event(),m=e.matches.find(x=>x.id===matchId);
  if(!m||m.status==='completed'||!m.aId||!m.bId)return;
  if(!canStartMatch(e,m))return toast('Court or player is already in a live match, or an earlier round is unfinished');
  m.history.push({type:'force',side,ts:Date.now(),before:matchSnapshot(m)});
  m.walkover=true;completeMatch(e,m,side);save('Match awarded; no points fabricated');
}
function completeMatch(e,m,side){ m.status='completed';m.winnerId=side==='a'?m.aId:m.bId;feedWinner(e,m,m.winnerId);advanceByes(e);maybeCreateGroupKnockout(e); }

function modal(title,body,foot=''){ return `<div class="modal-backdrop" data-action="close-modal"><div class="modal" onclick="event.stopPropagation()"><div class="modal-head"><h3>${title}</h3><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${body}</div>${foot?`<div class="modal-foot">${foot}</div>`:''}</div></div>`; }
function openModal(html){ document.body.insertAdjacentHTML('beforeend',html); bindDynamic(); }
function closeModal(){ $('.modal-backdrop')?.remove(); }
function newTournamentModal(){ openModal(modal('Create tournament',`<div class="form-grid"><div class="field"><label>Tournament name</label><input id="newTName" placeholder="Dropshot Folks Summer Open"></div><div class="field"><label>Date</label><input id="newTDate" type="date" value="${todayISO()}"></div><div class="field"><label>Venue</label><input id="newTVenue" placeholder="Sports hall / city"></div><div class="field"><label>Courts</label><input id="newTCourts" type="number" min="1" value="4"></div></div>`,`<button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" data-action="create-tournament">Create tournament</button>`)); }
function newEventModal(){ openModal(modal('Add event',`<div class="form-grid"><div class="field"><label>Event name</label><input id="newEName" placeholder="Men's Doubles"></div><div class="field"><label>Type</label><select id="newEType"><option value="doubles">Doubles</option><option value="singles">Singles</option></select></div><div class="field"><label>Format</label><select id="newEFormat"><option value="groups2">2 Groups → Knockout</option><option value="groups4">4 Groups → Knockout</option><option value="roundrobin">Round Robin</option><option value="knockout">Straight Knockout</option></select></div><div class="notice"><b>Stage scoring is flexible.</b><br>New events start with Group/Round Robin = 1 game × 21 and knockout stages = Best of 3 × 21. You can change every stage independently on the Draws page.</div></div>`,`<button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" data-action="create-event">Add event</button>`)); }
function addEntryModal(){ const e=event(); openModal(modal('Add entry',`<div class="form-grid"><div class="field"><label>Team / entry name</label><input id="entryName" placeholder="Team name or player name"></div><div class="field"><label>Seed (optional)</label><input id="entrySeed" type="number" min="1" placeholder="1"></div><div class="field"><label>Player 1</label><input id="entryP1" placeholder="Player name"></div>${e.type==='doubles'?`<div class="field"><label>Player 2</label><input id="entryP2" placeholder="Partner name"></div>`:''}</div>`,`<button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" data-action="save-entry">Add entry</button>`)); }
function bulkEntryModal(){ const e=event(); openModal(modal('Bulk add entries',`<p class="sub">One entry per line. For doubles use <b>Team Name, Player 1, Player 2, Seed</b>. For singles use <b>Player Name, Seed</b>.</p><div class="field"><label>Paste entries</label><textarea id="bulkText" placeholder="Shuttle Hustlers, Rahul, Alex, 1\nNet Ninjas, James, Chris, 2"></textarea></div>`,`<button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" data-action="save-bulk">Add entries</button>`)); }
function switchTournamentModal(){ openModal(modal('Switch tournament',`<div class="tournament-grid" style="grid-template-columns:1fr">${state.tournaments.map(t=>`<div class="card tournament-card" data-open-tournament="${t.id}">${statusBadge(t.status)}<h3>${esc(t.name)}</h3><p>${fmtDate(t.date)} · ${esc(t.venue||'Venue TBC')}</p></div>`).join('')}</div>`,`<button class="btn" data-action="new-tournament">+ New tournament</button>`)); }


function bindDynamic(){
  bindRegistrationControls();
  $$('[data-route]').forEach(b=>b.onclick=()=>{if(b.dataset.route==='teamcup'){location.href='team-cup-admin.html';return;}state.route=b.dataset.route;save();if(state.route==='registrations'&&authUser)setTimeout(loadRemoteRegistrations,0);});
  $$('[data-event]').forEach(b=>b.onclick=()=>{state.activeEventId=b.dataset.event;state.selectedMatchId=null;save();});
  $$('[data-open-event]').forEach(b=>b.onclick=()=>{state.activeEventId=b.dataset.openEvent;state.route='draws';save();});
  $$('[data-open-tournament]').forEach(b=>b.onclick=()=>{state.activeTournamentId=b.dataset.openTournament;state.activeEventId=state.tournaments.find(t=>t.id===state.activeTournamentId)?.events[0]?.id||null;state.route='dashboard';state.mode='admin';closeModal();save();});
  $$('[data-format]').forEach(x=>x.onclick=()=>{if(!canEditTournament())return;const e=event();if(e.matches.length&&!confirm('Changing format will clear the existing draw. Continue?'))return;if(e.matches.length){e.matches=[];e.entries.forEach(en=>en.group=null);e.groupsGenerated=false;e.knockoutGenerated=false;}e.format=x.dataset.format;save();});
  $$('[data-score-match]').forEach(b=>b.onclick=()=>{if(b.dataset.openScoreEvent)state.activeEventId=b.dataset.openScoreEvent;state.selectedMatchId=b.dataset.scoreMatch;state.route='scoring';state.mode='admin';save();});
  $$('[data-point]').forEach(b=>b.onclick=()=>addPoint(b.dataset.match,b.dataset.point));
  $$('[data-public-tab]').forEach(b=>b.onclick=()=>{state.publicTab=b.dataset.publicTab;save();});
  $$('[data-delete-entry]').forEach(b=>b.onclick=()=>{if(!canEditTournament())return;const e=event();if(e.entries.find(x=>x.id===b.dataset.deleteEntry)?.source==='registration')return toast('Withdraw the confirmed entry from Registrations so every device stays consistent');if(e.matches.length&&!confirm('This draw already has matches. Remove the entry and clear the draw?'))return;e.entries=e.entries.filter(x=>x.id!==b.dataset.deleteEntry);if(e.matches.length){e.matches=[];e.groupsGenerated=false;e.knockoutGenerated=false;e.entries.forEach(x=>x.group=null);}save('Entry removed');});
  $$('[data-reg-action]').forEach(b=>b.onclick=()=>{const id=b.dataset.regId,act=b.dataset.regAction;if(act==='details')registrationDetails(id);else if(act==='confirm')confirmRegistration(id);else if(act==='delete')deleteRegistration(id);else setRemoteRegistrationStatus(id,act);});
  const imp=$('#importBackup');if(imp)imp.onchange=async ev=>{const f=ev.target.files[0];if(!f)return;try{const x=JSON.parse(await f.text());if(x.version!==1||!Array.isArray(x.tournaments))throw 0;state=x;save('Backup imported');}catch{toast('That backup could not be imported.');}};
  $$('[data-action]').forEach(b=>b.onclick=(ev)=>handleAction(b.dataset.action,b,ev));
}

async function handleAction(a,b,ev){
  const writes=['create-tournament','create-event','save-entry','save-bulk','save-event-rules','generate-draw','clear-draw','assign-courts','assign-all-courts','save-tournament','delete-tournament','reset-demo'];
  if(writes.includes(a)&&!canEditTournament())return;
      if(['save-entry','save-bulk'].includes(a)&&event().matches.length)return toast('Clear the existing draw before adding entries');
  if(a==='public-view'){state.mode='public';state.publicTab='overview';save();}
  if(a==='admin-login')adminLogin();
  if(a==='admin-password')completeAdminPassword();
  if(a==='admin-recover')recoverAdminPassword();
  if(a==='sync-registration-entries')syncRegistrationEntries();
  if(a==='admin-signout')adminSignout();
  if(a==='publish-registration')publishRegistrationCatalogue();
  if(a==='refresh-registrations'){await loadRegistrationCatalogue(true);await loadRemoteRegistrations();}
  if(a==='copy-registration-link'){navigator.clipboard?.writeText(registrationLink()).then(()=>toast('Registration link copied')).catch(()=>toast(registrationLink()));}
  if(a==='pair-selected')pairSelectedRegistrations();
  if(a==='admin-view'){state.mode='admin';save();}
  if(a==='switch-tournament')switchTournamentModal();
  if(a==='new-tournament')newTournamentModal();
  if(a==='new-event')newEventModal();
  if(a==='add-entry')addEntryModal();
  if(a==='bulk-entries')bulkEntryModal();
  if(a==='close-modal')closeModal();
  if(a==='create-tournament'){const name=$('#newTName')?.value.trim();if(!name){toast('Enter a tournament name');return;}const id=uid('t');state.tournaments.push({id,name,date:$('#newTDate').value,venue:$('#newTVenue').value.trim(),courts:+$('#newTCourts').value||4,status:'draft',notes:'',createdAt:Date.now(),events:[]});state.activeTournamentId=id;state.activeEventId=null;state.route='dashboard';closeModal();save('Tournament created');}
  if(a==='create-event'){const t=tournament(),name=$('#newEName')?.value.trim();if(!name){toast('Enter an event name');return;}const id=uid('e');t.events.push({id,name,type:$('#newEType').value,format:$('#newEFormat').value,points:21,bestOf:3,scoringRules:defaultScoringRules(),registration:defaultRegistrationConfig(t),qualifiers:2,entries:[],matches:[],groupsGenerated:false,knockoutGenerated:false});state.activeEventId=id;state.route='entries';closeModal();save('Event added');}
  if(a==='save-entry'){const e=event(),name=$('#entryName')?.value.trim(),p1=$('#entryP1')?.value.trim();if(!name||!p1){toast('Entry name and Player 1 are required');return;}e.entries.push({id:uid('en'),name,p1,p2:e.type==='doubles'?$('#entryP2')?.value.trim():'',seed:+$('#entrySeed')?.value||null,group:null});closeModal();save('Entry added');}
  if(a==='save-bulk'){const e=event(),lines=$('#bulkText').value.split(/\n+/).map(x=>x.trim()).filter(Boolean);lines.forEach(line=>{const x=line.split(',').map(v=>v.trim());if(e.type==='doubles'){if(x[0]&&x[1])e.entries.push({id:uid('en'),name:x[0],p1:x[1],p2:x[2]||'',seed:+x[3]||null,group:null});}else{if(x[0])e.entries.push({id:uid('en'),name:x[0],p1:x[0],p2:'',seed:+x[1]||null,group:null});}});closeModal();save(`${lines.length} entries added`);}
  if(a==='save-event-rules'){const e=event();ensureEventScoring(e);for(const key of ['league','knockout','quarterFinal','semiFinal','final']){e.scoringRules[key]={points:+$('#rule_'+key+'Points').value,bestOf:+$('#rule_'+key+'BestOf').value};}e.qualifiers=+$('#eventQualifiers').value||2;e.matches.filter(m=>m.status==='pending'&&!(m.history||[]).length).forEach(m=>m.scoring=clone(e.scoringRules[stageKeyForMatch(m)]||e.scoringRules.knockout));save('Stage scoring rules saved');}
  if(a==='generate-draw'){if(event().matches.length&&!confirm('Regenerate the draw and remove all current scores?'))return;generateDraw(event());}
  if(a==='clear-draw'){if(confirm('Clear all matches and scores for this event?')){const e=event();e.matches=[];e.entries.forEach(x=>x.group=null);e.groupsGenerated=false;e.knockoutGenerated=false;state.selectedMatchId=null;save('Draw cleared');}}
  if(a==='assign-courts'){autoAssignEventCourts(event());save('Courts assigned');}
  if(a==='assign-all-courts')autoAssignAll();
  if(a==='undo-point')undoPoint(b.dataset.match);
  if(a==='force-a')forceWin(b.dataset.match,'a');
  if(a==='force-b')forceWin(b.dataset.match,'b');
  if(a==='save-tournament'){const t=tournament();t.name=$('#setName').value.trim()||t.name;t.date=$('#setDate').value;t.venue=$('#setVenue').value.trim();t.courts=Math.max(1,+$('#setCourts').value||1);t.status=$('#setStatus').value;t.notes=$('#setNotes').value.trim();save('Tournament saved');}
  if(a==='delete-tournament'){if(!confirm('Delete this tournament, registrations and all of its scores?'))return;const id=tournament().id;state.tournaments=state.tournaments.filter(x=>x.id!==id);if(!state.tournaments.length)state=demoState();else{state.activeTournamentId=state.tournaments[0].id;state.activeEventId=state.tournaments[0].events[0]?.id||null;state.route='dashboard';}save('Tournament deleted');}
  if(a==='export-backup'){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='dropshot-folks-v1-backup.json';link.click();URL.revokeObjectURL(link.href);}
  if(a==='reset-demo'){if(confirm('Reset all local data to the demo tournament?')){state=demoState();save('Demo restored');}}
}

render();
initRegistration();
