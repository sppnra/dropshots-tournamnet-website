const liveRoot=document.querySelector('#cupApp'),liveId=new URLSearchParams(location.search).get('tournament')||'t_team_cup_2026';let liveVersion=-1;
async function refreshCupLive(){
  try{const cup=await cupApi(`team-cup?tournament=${encodeURIComponent(liveId)}`);if(cup.version===liveVersion){const status=document.querySelector('#cupLiveFreshness');if(status)status.textContent=`Updated ${new Date().toLocaleTimeString('en-GB')} · refresh every 5 seconds`;return;}liveVersion=cup.version;
    liveRoot.innerHTML=`<header><div class="brand-mark">DF</div><h1>${cupEscape(cup.name)}</h1><p>${cupEscape(cup.event_date)} · ${cupEscape(cup.config.time)} · ${cupEscape(cup.venue)}</p><p id="cupLiveFreshness">Updated ${new Date().toLocaleTimeString('en-GB')} · refresh every 5 seconds</p><a class="btn primary" href="team-cup-register.html?tournament=${encodeURIComponent(cup.id)}">Register a team</a></header>${cup.progressionWarning?`<p class="notice warning">${cupEscape(cup.progressionWarning)}</p>`:''}${cupBoard(cup)}`;
  }catch(error){const status=document.querySelector('#cupLiveFreshness');if(status)status.textContent='Connection lost — displayed scores may be old. Retrying…';if(liveVersion<0)liveRoot.innerHTML=`<h1>Team Cup unavailable</h1><p>${cupEscape(error.message)}</p>`;}
}
refreshCupLive();setInterval(()=>{if(!document.hidden)refreshCupLive();},5000);
