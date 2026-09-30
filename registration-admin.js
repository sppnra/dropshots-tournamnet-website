let registrationBusy=false,registrationError='',adminCallback=null;
let registrationCatalogue=[],registrationFilters={event:'',status:'',search:''};
let registrationInitialized=false,registrationDiagnostic=null;
let paymentSettings=null,paymentStats=null,sendPaymentReceipts=true;
const moneyGBP=value=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(value||0));
const paymentDate=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Europe/London'}):'—';
function paymentBadge(r){const label=r.payment_status==='paid'?'Paid':r.payment_status==='pending'?'Payment pending':r.status==='confirmed'?'Not required':'Not started';return `<span class="status reg-${r.payment_status==='paid'?'confirmed':r.payment_status==='pending'?'pending':'withdrawn'}">${label}</span>`;}
function emailLabel(r,kind){return r.payment_status==='not_required'?'Not applicable':r[`${kind}_email_status`]||'not_sent';}

function registrationDisplayName(r){return r.team_name||(r.player2_name?`${r.player1_name} / ${r.player2_name}`:r.player1_name);}
function pageRegistrations(){
  const t=tournament();if(!t)return noEvent();
  const all=remoteRegistrations.filter(r=>r.tournament_id===t.id);
  const filtered=all.filter(r=>(!registrationFilters.event||r.event_id===registrationFilters.event)&&(!registrationFilters.status||r.status===registrationFilters.status)&&
    (!registrationFilters.search||[r.player1_name,r.player2_name,r.team_name].some(v=>(v||'').toLowerCase().includes(registrationFilters.search.toLowerCase()))));
  const counts=Object.fromEntries(['pending','confirmed','waitlisted','needs_partner'].map(s=>[s,all.filter(r=>r.status===s).length]));
  const busy=registrationBusy?'disabled':'';
  const authBlock=adminCallback&&['invite','recovery'].includes(adminCallback.type)?`
    <form id="adminPasswordForm" class="card card-pad"><h3>${adminCallback.type==='invite'?'Set your organizer password':'Choose a new password'}</h3>
    <div class="inline"><input id="adminNewPassword" type="password" required minlength="12" autocomplete="new-password" aria-label="New password" placeholder="At least 12 characters"><button class="btn primary" type="submit">Save password</button></div></form>`:
    !authUser?`<form id="adminLoginForm" class="card card-pad registration-login"><div class="eyebrow">Organizer access</div><h3>Sign in to manage registrations</h3>
      <p class="sub">Use your invited Netlify Identity organizer account.</p><div class="form-grid">
      <div class="field"><label for="adminEmail">Email</label><input id="adminEmail" type="email" required autocomplete="username"></div>
      <div class="field"><label for="adminPassword">Password</label><input id="adminPassword" type="password" required autocomplete="current-password"></div></div>
      <div class="inline" style="margin-top:12px"><button class="btn primary" type="submit" ${busy}>Sign in</button><button class="btn" type="button" data-action="admin-recover">Forgot password</button></div></form>`:
    `<div class="notice">Signed in as <b>${esc(authUser.email)}</b> · Registrations are saved on Netlify. <button class="btn tiny" data-action="admin-signout">Sign out</button></div>`;
  const cards=t.events.map(e=>{
    const cfg=ensureEventRegistration(e,t),remote=registrationCatalogue.find(x=>x.id===t.id)?.events.find(x=>x.id===e.id);
    return `<div class="card card-pad"><div class="inline" style="justify-content:space-between"><div><h3 style="margin:0">${esc(e.name)}</h3><div class="sub">${remote?.confirmed_count||0} / ${cfg.capacity} ${e.type==='doubles'?'teams':'players'} confirmed</div></div>
    <label class="switch-line"><input type="checkbox" data-reg-enabled="${e.id}" ${cfg.enabled?'checked':''}> Open</label></div>
    <div class="form-grid" style="margin-top:14px"><div class="field"><label for="capacity_${e.id}">Maximum entries</label><input id="capacity_${e.id}" data-reg-capacity="${e.id}" type="number" min="1" max="1000" value="${cfg.capacity}"></div>
    <div class="field"><label for="close_${e.id}">Closing date</label><input id="close_${e.id}" data-reg-close="${e.id}" type="date" value="${esc(cfg.closeDate||'')}"></div>
    <div class="field"><label for="partner_${e.id}">Allow partner matching</label><select id="partner_${e.id}" data-reg-partner="${e.id}" ${e.type==='singles'?'disabled':''}><option value="yes" ${cfg.allowPartnerNeeded?'selected':''}>On</option><option value="no" ${!cfg.allowPartnerNeeded?'selected':''}>Off</option></select></div>
    <div class="field"><label for="fee_${e.id}">Entry fee (£${e.type==='doubles'?' per team':''})</label><input id="fee_${e.id}" data-reg-fee="${e.id}" type="number" min="0" max="999999.99" step="0.01" value="${esc(cfg.entryFee)}"></div><div class="field"><label for="payment_${e.id}">Payment required</label><select id="payment_${e.id}" data-reg-payment="${e.id}"><option value="no" ${!cfg.paymentRequired?'selected':''}>Off</option><option value="yes" ${cfg.paymentRequired?'selected':''}>On</option></select></div>
    <div class="field"><label for="waitlist_${e.id}">Automatic waitlist</label><select id="waitlist_${e.id}" data-reg-waitlist="${e.id}"><option value="yes" ${cfg.autoWaitlist?'selected':''}>On</option><option value="no" ${!cfg.autoWaitlist?'selected':''}>Off</option></select></div></div></div>`;
  }).join('');
  const rows=filtered.map(r=>`<tr><td><b>${esc(registrationDisplayName(r))}</b><div class="sub">${esc(r.event_name)}</div></td>
    <td>${esc(r.player1_name)}<div class="sub">${esc(r.player1_email)} · ${esc(r.player1_phone)}</div>${r.player2_name?`<div>${esc(r.player2_name)}<div class="sub">${esc(r.player2_email)} · ${esc(r.player2_phone)}</div></div>`:''}</td>
    <td>${new Date(r.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</td><td>${registrationStatusBadge(r.status)}</td>
    <td>${paymentBadge(r)}${r.payment_status!=='not_required'?`<div class="sub">${moneyGBP(r.payment_amount)}${r.payment_status==='paid'?` · ${esc(paymentDate(r.payment_received_at))}`:''}</div>`:''}${r.payment_reference?`<small>${esc(r.payment_reference)}</small>`:''}</td>
    <td><div class="inline">${r.status==='confirmed'&&r.payment_status==='pending'?`<button class="btn tiny primary" data-payment-action="received" data-payment-id="${r.id}" ${busy}>Mark payment received</button>`:''}${r.payment_status==='paid'?'<span class="sub">Payment received ✓</span>':''}
    ${r.status==='confirmed'&&r.payment_status==='pending'&&['not_sent','failed','uncertain'].includes(r.approval_email_status)?`<button class="btn tiny" data-payment-action="approval" data-payment-id="${r.id}" ${busy}>Retry approval email</button>`:''}
    ${r.status==='confirmed'&&r.payment_status==='paid'&&['not_sent','failed','uncertain'].includes(r.payment_email_status)?`<button class="btn tiny" data-payment-action="payment" data-payment-id="${r.id}" ${busy}>${r.payment_email_status==='not_sent'?'Send':'Retry'} payment email</button>`:''}
    <button class="btn tiny" data-reg-action="details" data-reg-id="${r.id}">Details</button>
    ${r.status!=='confirmed'&&(!r.needs_partner||r.team_name)?`<button class="btn tiny primary" data-reg-action="confirm" data-reg-id="${r.id}" ${busy}>Approve / Confirm</button>`:''}
    ${r.status!=='waitlisted'?`<button class="btn tiny" data-reg-action="waitlisted" data-reg-id="${r.id}" ${busy}>Waitlist</button>`:''}
    ${r.status!=='rejected'?`<button class="btn tiny" data-reg-action="rejected" data-reg-id="${r.id}" ${busy}>Reject</button>`:''}
    ${r.status!=='withdrawn'?`<button class="btn tiny" data-reg-action="withdrawn" data-reg-id="${r.id}" ${busy}>Withdraw</button>`:''}
    <button class="btn tiny danger" data-reg-action="delete" data-reg-id="${r.id}" ${busy}>Delete</button></div></td></tr>`).join('');
  const needs=filtered.filter(r=>r.status==='needs_partner');
  return pageHead('Player registration','Registrations','Publish event registration, review players, and add confirmed entries to your tournament roster.',
    `<button class="btn" data-action="refresh-registrations" ${busy}>Refresh</button><button class="btn primary" data-action="publish-registration" ${busy||!authUser?'disabled':''}>Save & publish registration</button>`)+
    `${registrationError?`<div class="notice warning" role="alert">${esc(registrationError)}</div>`:''}${authBlock}
    <div class="registration-share card card-pad" style="margin-top:16px"><div><div class="eyebrow">Public registration link</div><b>${esc(registrationLink(t))}</b><p class="sub">Publish first, then share this link on WhatsApp.</p></div><div class="inline"><button class="btn" id="inspectCatalogue" ${!authUser?'disabled':''}>Inspect published database</button><button class="btn" data-action="copy-registration-link">Copy link</button><a class="btn dark" href="${esc(registrationLink(t))}" target="_blank" rel="noopener">Open page ↗</a></div></div>
    ${registrationDiagnostic?`<details class="card card-pad" open><summary>Published database catalogue · ${esc(registrationDiagnostic.reason)}</summary><p class="sub">Database values only. Closing dates use Europe/London. No player contact data.</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(registrationDiagnostic,null,2))}</pre></details>`:''}
    <div class="stats registration-stats"><div class="card stat"><small>Total</small><strong>${all.length}</strong></div>${[['confirmed','Confirmed'],['pending','Pending'],['waitlisted','Waitlisted'],['needs_partner','Needs partner']].map(([s,label])=>`<div class="card stat"><small>${label}</small><strong>${counts[s]}</strong></div>`).join('')}</div>
    ${authUser?paymentSettingsForm(t):''}
    ${authUser&&paymentStats?.tournamentId===t.id?`<div class="stats payment-stats">${[['pending','Payment pending entries'],['paid','Paid entries'],['expected','Expected revenue'],['received','Received'],['outstanding','Outstanding']].map(([key,label])=>`<div class="card stat"><small>${label}</small><strong>${['pending','paid'].includes(key)?paymentStats[key]:moneyGBP(paymentStats[key])}</strong></div>`).join('')}</div><p class="sub">Revenue counts approved entries once per singles player or doubles team. Withdrawn, rejected and waitlisted entries are excluded; payment history is retained.</p>`:''}
    <div class="grid equal">${cards||'<div class="card empty">Create an event before opening registration.</div>'}</div>
    <div class="card card-pad registration-filters"><div class="form-grid three"><div class="field"><label for="regTournamentFilter">Tournament</label><select id="regTournamentFilter">${state.tournaments.map(x=>`<option value="${x.id}" ${x.id===t.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="regEventFilter">Event</label><select id="regEventFilter"><option value="">All events</option>${t.events.map(x=>`<option value="${x.id}" ${registrationFilters.event===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="regStatusFilter">Status</label><select id="regStatusFilter"><option value="">All statuses</option>${['pending','confirmed','waitlisted','needs_partner','rejected','withdrawn'].map(s=>`<option value="${s}" ${registrationFilters.status===s?'selected':''}>${esc(s.replaceAll('_',' '))}</option>`).join('')}</select></div></div>
    <div class="field" style="margin-top:12px"><label for="regSearch">Search player or team name</label><input id="regSearch" type="search" value="${esc(registrationFilters.search)}" placeholder="Search names…"></div></div>
    <div class="card"><div class="section-head"><div><h3>Incoming registrations</h3><label class="privacy-check"><input id="sendPaymentReceipts" type="checkbox" ${sendPaymentReceipts?'checked':''}> Send an email when marking payment received</label><p>${remoteRegistrationLoading?'Loading registrations…':`${filtered.length} shown · Contact details are organizer-only`}</p></div><button class="btn tiny" data-action="sync-registration-entries" ${busy}>Sync confirmed Entries</button></div>
    <div class="table-wrap"><table><thead><tr><th>Player / team & event</th><th>Contact</th><th>Submitted</th><th>Status</th><th>Payment</th><th>Actions</th></tr></thead><tbody>${rows||`<tr><td colspan="6"><div class="empty">${!authUser?'Sign in to view registrations.':remoteRegistrationLoading?'Loading…':'No registrations match these filters.'}</div></td></tr>`}</tbody></table></div></div>
    <div class="card card-pad" style="margin-top:16px"><div class="inline" style="justify-content:space-between"><h3>Needs partner</h3><button class="btn primary" data-action="pair-selected" ${busy||!authUser?'disabled':''}>Pair Players</button></div>
    <div class="partner-candidates">${needs.map(r=>`<label class="partner-candidate"><input type="checkbox" class="pair-reg" value="${r.id}"><span><b>${esc(r.player1_name)}</b><small>${esc(r.event_name)}</small></span></label>`).join('')||'<p class="sub">No players waiting for a partner in these filters.</p>'}</div></div>`;
}
function bindRegistrationControls(){
  const bankForm=document.querySelector('#bankSettingsForm');if(bankForm)bankForm.onsubmit=ev=>{ev.preventDefault();saveBankSettings();};
  const receipt=document.querySelector('#sendPaymentReceipts');if(receipt)receipt.onchange=()=>{sendPaymentReceipts=receipt.checked;};
  document.querySelectorAll('[data-payment-action]').forEach(button=>button.onclick=()=>paymentAction(button.dataset.paymentId,button.dataset.paymentAction));
  const inspect=document.querySelector('#inspectCatalogue');if(inspect)inspect.onclick=async()=>{try{registrationDiagnostic=await registrationApi(`admin/catalogue-diagnostic?tournament=${encodeURIComponent(tournament().id)}`);render();}catch(error){registrationError=error.message;render();}};
  const login=document.querySelector('#adminLoginForm');if(login)login.onsubmit=ev=>{ev.preventDefault();adminLogin();};
  const password=document.querySelector('#adminPasswordForm');if(password)password.onsubmit=ev=>{ev.preventDefault();completeAdminPassword();};
  const tournamentFilter=document.querySelector('#regTournamentFilter');if(tournamentFilter)tournamentFilter.onchange=async()=>{
    state.activeTournamentId=tournamentFilter.value;state.activeEventId=tournament()?.events[0]?.id||null;registrationFilters={event:'',status:'',search:''};paymentSettings=null;paymentStats=null;registrationDiagnostic=null;save();await loadRemoteRegistrations();
  };
  for(const [selector,key] of [['#regEventFilter','event'],['#regStatusFilter','status']]){const input=document.querySelector(selector);if(input)input.onchange=()=>{registrationFilters[key]=input.value;render();};}
  const search=document.querySelector('#regSearch');if(search)search.oninput=()=>{
    const position=search.selectionStart;registrationFilters.search=search.value;render();const next=document.querySelector('#regSearch');next?.focus();next?.setSelectionRange(position,position);
  };
}
async function initRegistration(){
  if(registrationInitialized)return;registrationInitialized=true;
  if(!window.DropshotIdentity){registrationError='Build and deploy the project to enable organizer login.';return;}
  const callback=await window.DropshotIdentityReady;
  if(callback?.error)registrationError=callback.error;
  if(callback){adminCallback=callback;state.route='registrations';state.mode='admin';}
  window.DropshotIdentity.onAuthChange(event=>{
    if(event==='logout'){authUser=null;remoteRegistrations=[];registrationCatalogue=[];paymentSettings=null;paymentStats=null;registrationDiagnostic=null;render();}
  });
  await checkAdminSession();
  if(authUser){await loadRegistrationCatalogue();await loadRemoteRegistrations();}
  render();
}
async function checkAdminSession(){
  try{const data=await registrationApi('admin/session');authUser=data.user;registrationError='';}
  catch(error){authUser=null;if(error.status!==401)registrationError=error.message;}
}
async function adminLogin(){
  if(registrationBusy)return;
  const email=document.querySelector('#adminEmail')?.value.trim(),password=document.querySelector('#adminPassword')?.value;
  if(!email||!password)return toast('Enter your email and password');
  registrationBusy=true;render();
  try{await window.DropshotIdentity.login(email,password);await checkAdminSession();if(authUser){await loadRegistrationCatalogue();await loadRemoteRegistrations();}}
  catch(error){registrationError=error.message;}
  finally{registrationBusy=false;render();}
}
async function adminSignout(){
  try{await window.DropshotIdentity.logout();}catch{}
  authUser=null;remoteRegistrations=[];registrationCatalogue=[];paymentSettings=null;paymentStats=null;registrationDiagnostic=null;registrationError='';render();
}
async function completeAdminPassword(){
  const password=document.querySelector('#adminNewPassword')?.value;
  if(!password||password.length<12)return toast('Use at least 12 characters');
  try{
    if(adminCallback.type==='invite')await window.DropshotIdentity.acceptInvite(adminCallback.token,password);
    else await window.DropshotIdentity.updateUser({password});
    adminCallback=null;await checkAdminSession();if(authUser){await loadRegistrationCatalogue();await loadRemoteRegistrations();}render();
  }catch(error){registrationError=error.message;render();}
}
async function recoverAdminPassword(){
  const email=document.querySelector('#adminEmail')?.value.trim();if(!email)return toast('Enter your organizer email first');
  try{await window.DropshotIdentity.requestPasswordRecovery(email);toast('Check your email for password reset instructions');}catch(error){registrationError=error.message;render();}
}
async function loadRegistrationCatalogue(replaceSettings=false){
  if(!authUser)return;
  try{
    const {tournaments}=await registrationApi('admin/catalogue');registrationCatalogue=tournaments;
    for(const remote of tournaments){
      let local=state.tournaments.find(t=>t.id===remote.id);
      if(!local){local={id:remote.id,name:remote.name,date:remote.event_date||'',venue:remote.venue,courts:4,status:'draft',notes:'',createdAt:Date.now(),events:[]};state.tournaments.push(local);}
      const useRemote=replaceSettings||local.registrationRevision==null;
      if(useRemote){
        local.registrationRevision=remote.revision;
      }
      for(const event of remote.events){
          let e=local.events.find(x=>x.id===event.id);
          const added=!e;
          if(added){e={id:event.id,name:event.name,type:event.event_type,format:event.format,points:21,bestOf:3,scoringRules:defaultScoringRules(),qualifiers:2,entries:[],matches:[],groupsGenerated:false,knockoutGenerated:false};local.events.push(e);}
          if(useRemote||added)e.registration={enabled:event.registration_enabled,capacity:event.capacity,closeDate:event.registration_close||'',allowPartnerNeeded:event.allow_partner_needed,autoWaitlist:event.auto_waitlist,entryFee:String(event.entry_fee||'0.00'),paymentRequired:event.payment_required===true};
      }
    }
    save();
  }catch(error){registrationError=error.message;}
}
async function publishRegistrationCatalogue(){
  if(!authUser)return toast('Organizer sign-in required');if(registrationBusy)return;
  const t=tournament();
  for(const e of t.events){const cfg=ensureEventRegistration(e,t);
    cfg.enabled=document.querySelector(`[data-reg-enabled="${e.id}"]`).checked;
    cfg.capacity=Number(document.querySelector(`[data-reg-capacity="${e.id}"]`).value);
    cfg.closeDate=document.querySelector(`[data-reg-close="${e.id}"]`).value;
    cfg.allowPartnerNeeded=document.querySelector(`[data-reg-partner="${e.id}"]`).value==='yes';
    cfg.autoWaitlist=document.querySelector(`[data-reg-waitlist="${e.id}"]`).value==='yes';
    cfg.entryFee=document.querySelector(`[data-reg-fee="${e.id}"]`).value;cfg.paymentRequired=document.querySelector(`[data-reg-payment="${e.id}"]`).value==='yes';
  }
  registrationBusy=true;render();
  try{
    const data=await registrationApi('admin/catalogue',{method:'POST',body:{id:t.id,name:t.name,date:t.date||null,venue:t.venue||'',revision:t.registrationRevision||0,
      events:t.events.map(e=>({id:e.id,name:e.name,type:e.type,format:e.format,registration:e.registration}))}});
    t.registrationRevision=data.revision;registrationDiagnostic=data.diagnostic;save();
    const publicData=await registrationApi(`tournaments?tournament=${encodeURIComponent(t.id)}`);
    const published=publicData.tournaments.find(x=>x.id===t.id);
    registrationError=published?'':`Settings saved to the database, but public registration is closed (${data.diagnostic?.reason||'public_read_failed'}). Enable an event and clear or update its closing date, then publish again.`;
    await loadRegistrationCatalogue();toast(published?'Registration published and public link verified':'Settings saved; registration is closed');
  }catch(error){registrationError=error.message;}
  finally{registrationBusy=false;render();}
}
async function loadRemoteRegistrations(){
  if(!authUser)return;
  const tid=tournament()?.id;if(!tid)return;
  remoteRegistrationLoading=true;if(state.route==='registrations')render();
  try{
    const result=[];let offset=0;
    do{const data=await registrationApi(`admin/registrations?tournament=${encodeURIComponent(tid)}&offset=${offset}`);result.push(...data.registrations);offset=data.next_offset;}while(offset!==null);
    if(tournament()?.id!==tid)return;
    const [{settings},{stats}]=await Promise.all([registrationApi(`admin/payment-settings?tournament=${encodeURIComponent(tid)}`),registrationApi(`admin/payment-stats?tournament=${encodeURIComponent(tid)}`)]);
    if(tournament()?.id!==tid)return;paymentSettings=settings;paymentStats={...stats,tournamentId:tid};
    remoteRegistrations=result;registrationError='';await loadRegistrationCatalogue();await syncRegistrationEntries(false);
  }catch(error){registrationError=error.message;if([401,403].includes(error.status)){authUser=null;remoteRegistrations=[];}}
  finally{remoteRegistrationLoading=false;if(state.route==='registrations')render();}
}
async function syncRegistrationEntries(notify=true){
  if(!authUser)return;
  const t=tournament();
  try{
    const {entries}=await registrationApi(`admin/entries?tournament=${encodeURIComponent(t.id)}`);
    for(const e of t.events){
      const remote=entries.filter(x=>x.event_id===e.id),current=e.entries.filter(x=>x.source==='registration');
      const changed=remote.some(x=>!e.entries.some(y=>y.id===x.id))||current.some(x=>!remote.some(y=>y.id===x.id));
      if(e.matches.length&&changed){registrationError='Confirmed Entries have changed. Clear the local draw before syncing roster additions or withdrawals.';continue;}
      if(!e.matches.length){
        e.entries=e.entries.filter(x=>x.source!=='registration'||remote.some(y=>y.id===x.id));
        for(const x of remote)if(!e.entries.some(y=>y.id===x.id))e.entries.push({id:x.id,name:x.name,p1:x.p1,p2:x.p2,seed:null,group:null,source:'registration'});
      }
    }
    save();if(notify)toast('Confirmed Entries synced');
  }catch(error){registrationError=error.message;render();}
}
function registrationDetails(id){
  const r=remoteRegistrations.find(x=>x.id===id);if(!r)return;
  openModal(modal('Registration details',`<h3>${esc(registrationDisplayName(r))}</h3><p>${esc(r.tournament_name)} · ${esc(r.event_name)}</p>${registrationStatusBadge(r.status)} ${paymentBadge(r)}
    <dl class="payment-details"><dt>Entry fee ${r.approved_at?'at approval':'current event fee'}</dt><dd>${moneyGBP(r.approved_at?r.payment_amount:r.entry_fee)}</dd><dt>Payment reference</dt><dd>${esc(r.payment_reference||'—')}</dd><dt>Submitted</dt><dd>${esc(paymentDate(r.created_at))}</dd><dt>Approved</dt><dd>${esc(paymentDate(r.approved_at))}</dd><dt>Approval email</dt><dd>${esc(emailLabel(r,'approval'))} · ${esc(paymentDate(r.approval_email_sent_at))}</dd><dt>Payment email</dt><dd>${esc(emailLabel(r,'payment'))} · ${esc(paymentDate(r.payment_email_sent_at))}</dd><dt>Payment received</dt><dd>${esc(paymentDate(r.payment_received_at))}</dd><dt>Recorded by</dt><dd>${esc(r.payment_received_by||'—')}</dd></dl>
    ${[r.approval_email_status,r.payment_email_status].includes('uncertain')?'<div class="notice warning">Email delivery is uncertain. Retry promptly; after 14 minutes automatic resend is blocked. Check Brevo transactional logs before any resend.</div>':''}
    <p><b>${esc(r.player1_name)}</b><br>${esc(r.player1_email)}<br>${esc(r.player1_phone)}</p>${r.player2_name?`<p><b>${esc(r.player2_name)}</b><br>${esc(r.player2_email)}<br>${esc(r.player2_phone)}</p>`:''}
    ${r.team_name&&r.needs_partner?'<div class="notice">This player has been paired. Status changes apply to the whole team.</div>':''}`));
}
async function registrationMutation(fn){
  if(!authUser)return toast('Organizer sign-in required');if(registrationBusy)return;
  registrationBusy=true;render();
  try{const result=await fn();registrationError='';await loadRemoteRegistrations();if(result?.warning)registrationError=result.warning;}
  catch(error){registrationError=error.message;}
  finally{registrationBusy=false;render();}
}
function canChangeRegistrationRoster(r){
  const e=tournament().events.find(x=>x.id===r.event_id);
  if(e?.matches.length){toast('Clear this event’s local draw before changing its Entries');return false;}return true;
}
async function confirmRegistration(id){
  const r=remoteRegistrations.find(x=>x.id===id);if(!r||!canChangeRegistrationRoster(r))return;
  const e=registrationCatalogue.find(t=>t.id===r.tournament_id)?.events.find(e=>e.id===r.event_id);
  const overrideCapacity=e&&e.confirmed_count>=e.capacity;
  if(overrideCapacity&&!confirm('This event is full. Confirm this entry above the configured capacity?'))return;
  await registrationMutation(()=>registrationApi(`admin/registrations/${id}`,{method:'PATCH',body:{status:'confirmed',overrideCapacity:!!overrideCapacity}}));
}
async function setRemoteRegistrationStatus(id,status){
  const r=remoteRegistrations.find(x=>x.id===id);if(!r||(r.local_entry_id&&!canChangeRegistrationRoster(r)))return;
  await registrationMutation(()=>registrationApi(`admin/registrations/${id}`,{method:'PATCH',body:{status}}));
}
async function deleteRegistration(id){
  const r=remoteRegistrations.find(x=>x.id===id);if(!r||!canChangeRegistrationRoster(r))return;
  if(!confirm('Delete this registration? If paired, the team will be withdrawn.'))return;
  await registrationMutation(()=>registrationApi(`admin/registrations/${id}`,{method:'DELETE',body:{}}));
}
async function pairSelectedRegistrations(){
  const ids=[...document.querySelectorAll('.pair-reg:checked')].map(x=>x.value);
  if(ids.length!==2)return toast('Select exactly two players who need a partner');
  const r=remoteRegistrations.find(x=>x.id===ids[0]);if(!r||!canChangeRegistrationRoster(r))return;
  await registrationMutation(()=>registrationApi('admin/pair',{method:'POST',body:{ids}}));
}

function paymentSettingsForm(t){
  const b=paymentSettings?.tournament_id===t.id?paymentSettings:null;
  if(!b)return '<div class="card card-pad"><p class="sub">Refresh registrations to load private bank settings. Publish new tournaments before saving bank details.</p></div>';
  return `<form id="bankSettingsForm" class="card card-pad bank-settings"><h3>Tournament bank details</h3><p class="sub">Organizer-only. Sent privately to approved players; never shown on public pages. Bank details are saved separately from event settings.</p><div class="form-grid">${[['bank_account_name','Account name',100],['bank_name','Bank name (optional)',100],['sort_code','Sort code',8],['account_number','Account number',8],['payment_reference_prefix','Payment reference prefix (1–4 letters or digits)',4]].map(([key,label,max])=>`<div class="field"><label for="bank_${key}">${label}</label><input id="bank_${key}" name="${key}" type="text" maxlength="${max}" value="${esc(b[key])}" autocomplete="off" ${registrationBusy||remoteRegistrationLoading?'disabled':''} ${['sort_code','account_number'].includes(key)?'inputmode="numeric"':''}></div>`).join('')}<div class="field"><label for="bank_payment_instructions">Payment instructions / notes</label><textarea id="bank_payment_instructions" name="payment_instructions" maxlength="1000" ${registrationBusy||remoteRegistrationLoading?'disabled':''}>${esc(b.payment_instructions)}</textarea></div></div><button type="submit" class="btn primary" ${registrationBusy||remoteRegistrationLoading?'disabled':''}>Save bank details</button></form>`;
}
async function saveBankSettings(){
  if(!authUser||!paymentSettings)return;
  const body={tournamentId:tournament().id,revision:paymentSettings.revision};
  for(const key of ['bank_account_name','bank_name','sort_code','account_number','payment_reference_prefix','payment_instructions'])body[key]=document.querySelector(`[name="${key}"]`).value.trim();
  await registrationMutation(()=>registrationApi('admin/payment-settings',{method:'POST',body}));
}
async function paymentAction(id,action){
  if(action==='received'){
    if(!confirm('Mark this bank transfer as received? Check the amount and reference against your bank statement first.'))return;
    await registrationMutation(()=>registrationApi(`admin/registrations/${id}/payment`,{method:'POST',body:{sendEmail:sendPaymentReceipts}}));
  }else await registrationMutation(()=>registrationApi(`admin/registrations/${id}/retry-email`,{method:'POST',body:{kind:action}}));
}
