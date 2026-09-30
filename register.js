const root=document.querySelector('#registerApp'),qs=new URLSearchParams(location.search);
const tournamentId=qs.get('tournament')||qs.get('t');
const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtDate=d=>d?new Date(`${d}T12:00:00`).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'Date TBC';
let tournament=null,events=[],selectedEventId=null,submitted=null,requestKey=crypto.randomUUID(),needsPartner=false,draft={};
function event(){return events.find(e=>e.id===selectedEventId)||events[0];}
function problem(title,message){root.innerHTML=`<main class="registration-page"><section class="registration-card"><div class="brand-mark">DF</div><h1>${esc(title)}</h1><p>${esc(message)}</p><button id="retry" class="btn dark">Try again</button></section></main>`;document.querySelector('#retry').onclick=init;}
function playerBlock(n,label){return `<section id="playerBlock${n}" class="player-block" aria-label="${label}"><div class="player-number">${n}</div><div class="player-fields"><div class="field"><label for="p${n}Name">${label}</label><input id="p${n}Name" required maxlength="100" autocomplete="section-player${n} name" placeholder="Full name"></div><div class="form-grid"><div class="field"><label for="p${n}Email">Email</label><input id="p${n}Email" type="email" required maxlength="160" autocomplete="section-player${n} email" placeholder="name@email.com"></div><div class="field"><label for="p${n}Phone">Phone</label><input id="p${n}Phone" type="tel" required maxlength="40" autocomplete="section-player${n} tel" placeholder="07…"></div></div></div></section>`;}
function togglePartner(){const block=document.querySelector('#playerBlock2');if(!block)return;block.classList.toggle('hide',needsPartner);block.querySelectorAll('input').forEach(x=>{x.required=!needsPartner;x.disabled=needsPartner;});}
function success(){
  const r=submitted,label={pending:'Pending organizer approval',waitlisted:'On the waitlist',needs_partner:'Waiting for a partner',confirmed:'Place confirmed',withdrawn:'Withdrawn',rejected:'Not accepted'}[r.status];
  const message=r.status==='needs_partner'?'The organizer will review your entry and help find a partner. Your place is confirmed after pairing and approval.':r.status==='waitlisted'?'This event is full. The organizer will contact you if a place becomes available.':r.status==='confirmed'?'Your place has been confirmed.':"The organizer will review your registration. If approved and payment is required, we’ll email you with bank-transfer instructions.";
  root.innerHTML=`<main class="registration-page"><section class="registration-card registration-success"><div class="success-icon">✓</div><div class="eyebrow">Dropshot Folks</div><h1>Registration submitted 🏸</h1><p><b>${esc(r.tournament_name)}</b><br>${esc(r.event_name)}<br>${esc(r.entry_name)}</p><div class="registration-receipt-status">${esc(label)}</div><p>${esc(message)}</p><div class="notice">Your contact details are visible only to tournament organizers.</div><button id="another" class="btn primary" style="margin-top:18px">Register another event</button></section></main>`;
  document.querySelector('#another').onclick=()=>{submitted=null;requestKey=crypto.randomUUID();draft={};needsPartner=false;init();};
}
function render(){
  if(submitted)return success();const e=event();if(!e)return problem('Registration is closed','There are no events accepting registrations.');
  const doubles=e.event_type==='doubles',allowed=doubles&&e.allow_partner_needed,full=e.confirmed_count>=e.capacity;
  if(!allowed)needsPartner=false;
  root.innerHTML=`<div class="registration-page"><header class="registration-top"><div class="public-brand"><div class="brand-mark">DF</div><span>DROPSHOT FOLKS</span></div><span class="registration-pill">Registration open</span></header><main class="registration-wrap"><section class="registration-intro"><div class="eyebrow">${fmtDate(tournament.event_date)} · ${esc(tournament.venue||'Venue TBC')}</div><h1>${esc(tournament.name)}</h1><p>Choose your event and add your details. No account needed.</p></section><div class="registration-layout">
  <section class="registration-events" aria-label="Choose event"><div class="registration-section-label">1 · Choose your event</div>${events.map(x=>`<button type="button" class="registration-event-option ${x.id===e.id?'active':''}" data-event="${x.id}" aria-pressed="${x.id===e.id}"><span><b>${esc(x.name)}</b><small>${x.event_type==='doubles'?'Doubles':'Singles'} · ${x.confirmed_count} / ${x.capacity} confirmed${x.confirmed_count>=x.capacity?x.auto_waitlist?' · Waitlist open':' · Full':''}</small></span><span>→</span></button>`).join('')}<div class="registration-help"><b>What happens next?</b><p>The organizer reviews your entry and confirms your place. Contact details stay private.</p></div></section>
  <form id="registrationForm" class="registration-card form-card"><div class="registration-section-label">2 · Your details</div><div class="selected-event-head"><div><div class="eyebrow">Selected event</div><h2>${esc(e.name)}</h2></div><span class="tag ${doubles?'group':'rr'}">${doubles?'Doubles':'Singles'}</span></div>
  ${full?`<div class="notice">${e.auto_waitlist?'This event is full. Complete entries join the waitlist.':'This event is full and the waitlist is closed.'}</div>`:''}
  ${doubles?`<fieldset class="registration-choice"><legend>How would you like to register?</legend><label><input type="radio" name="partnerChoice" value="with" ${!needsPartner?'checked':''}> With a partner</label>${allowed?`<label><input type="radio" name="partnerChoice" value="need" ${needsPartner?'checked':''}> I need a partner</label>`:''}</fieldset><div class="field"><label for="teamName">Team name <span>optional</span></label><input id="teamName" maxlength="80" placeholder="e.g. Shuttle Hustlers"></div>`:''}
  ${playerBlock(1,doubles?'Player 1 full name':'Full name')}${doubles?playerBlock(2,'Player 2 full name'):''}
  <label class="privacy-check"><input id="privacy" type="checkbox" required><span>I agree that Dropshot Folks organizers can use these contact details to manage this tournament entry${doubles?' and I have permission to provide my partner’s details':''}. Contact details stay private.</span></label><div id="submitError" class="notice warning hide" role="alert"></div><button id="submitBtn" type="submit" class="btn primary registration-submit" ${full&&!e.auto_waitlist?'disabled':''}>Register →</button><div class="registration-fineprint">Registration closes ${e.registration_close?fmtDate(e.registration_close):'when the organizer closes entries'}.</div></form></div></main></div>`;
  for(const [id,value] of Object.entries(draft)){const input=document.getElementById(id);if(input)input.value=value;}
  togglePartner();
  document.querySelectorAll('[data-event]').forEach(button=>button.onclick=()=>{
    for(const id of ['teamName','p1Name','p1Email','p1Phone','p2Name','p2Email','p2Phone']){const input=document.getElementById(id);if(input)draft[id]=input.value;}
    selectedEventId=button.dataset.event;requestKey=crypto.randomUUID();render();
  });
  document.querySelectorAll('[name="partnerChoice"]').forEach(input=>input.onchange=()=>{needsPartner=input.value==='need';togglePartner();});
  document.querySelector('#registrationForm').onsubmit=submitRegistration;
}
async function submitRegistration(ev){
  ev.preventDefault();const e=event(),button=document.querySelector('#submitBtn');if(button.disabled)return;
  const player=n=>({name:document.querySelector(`#p${n}Name`).value.trim(),email:document.querySelector(`#p${n}Email`).value.trim(),phone:document.querySelector(`#p${n}Phone`).value.trim()});
  const body={tournamentId:tournament.id,eventId:e.id,requestKey,needsPartner,player1:player(1),player2:e.event_type==='doubles'&&!needsPartner?player(2):null,teamName:document.querySelector('#teamName')?.value.trim()||'',consent:document.querySelector('#privacy').checked};
  button.disabled=true;button.textContent='Registering…';
  try{const data=await registrationApi('registrations',{method:'POST',body});submitted=data.registration;render();}
  catch(error){const box=document.querySelector('#submitError');box.textContent=error.message;box.classList.remove('hide');box.scrollIntoView({block:'nearest'});button.disabled=false;button.textContent='Register →';}
}
async function init(){
  if(!tournamentId)return problem('Tournament link is incomplete','Please use the registration link shared by the organizer.');
  root.innerHTML='<main class="registration-page"><section class="registration-card loading-card"><div class="brand-mark">DF</div><h2>Loading registration…</h2><p>Getting the latest tournament information.</p></section></main>';
  try{const data=await registrationApi(`tournaments?tournament=${encodeURIComponent(tournamentId)}`);tournament=data.tournaments[0];if(!tournament)return problem('Registration is unavailable','The tournament has not been published or its registration is closed.');events=tournament.events;selectedEventId=events.some(e=>e.id===selectedEventId)?selectedEventId:events[0]?.id;render();}
  catch(error){problem('Could not load registration',error.message);}
}
init();
