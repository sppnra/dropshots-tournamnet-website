const refereeRoot=document.querySelector('#cupApp');
const refereeToken=new URLSearchParams(location.hash.slice(1)).get('token')||new URLSearchParams(location.search).get('token');
let refereeData=null,refereeBusy=false,refereeError='';
function renderReferee(){
  refereeRoot.innerHTML=`${refereeError?`<div class="notice warning" role="alert">${cupEscape(refereeError)}</div>`:''}${refereeData?cupScorer(refereeData):'<h1>Referee link unavailable</h1><p>Ask the organizer for a current scoring link.</p>'}`;
  refereeRoot.querySelectorAll('[data-score]').forEach(button=>{button.disabled=button.disabled||refereeBusy;button.onclick=async()=>{
    if(refereeBusy)return;if(button.dataset.score==='award'&&!confirm('Award this match to the selected team?'))return;
    refereeBusy=true;button.disabled=true;
    try{await cupApi('referee',{action:button.dataset.score,side:button.dataset.side,version:refereeData.match.version},refereeToken);refereeError='';}
    catch(error){refereeError=error.message;}
    finally{refereeBusy=false;await loadReferee();}
  };});
}
async function loadReferee(){
  if(!refereeToken){renderReferee();return;}
  try{refereeData=await cupApi('referee',null,refereeToken);renderReferee();}
  catch(error){if([403,404].includes(error.status))refereeData=null;refereeError=error.message;renderReferee();}
}
loadReferee();
// No one-second polling. Refresh after actions and every 5s while visible/idle.
setInterval(()=>{if(!document.hidden&&!refereeBusy)loadReferee();},5000);
