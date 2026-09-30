import {randomUUID} from 'node:crypto';
export const disciplines=['MD','WD','XD'];
export const disciplineNames={MD:"Men’s Doubles",WD:"Women’s Doubles",XD:'Mixed Doubles'};
export function newCup(){return {config:{registration_enabled:true,registration_close:'2026-10-13',capacity:12,courts:4,groupCount:3,qualifiers:2,thirdPlace:false,
  fee_per_person:22,team_size:4,time:'09:00–16:00',rules:{group:{points:21,bestOf:1},quarter:{points:21,bestOf:3},semi:{points:21,bestOf:3},final:{points:21,bestOf:3}}},groups:[],ties:[],knockout:false};}
export function newTie(cup,matches,options){
  const tie={id:randomUUID(),status:'pending',winner:null,winsA:0,winsB:0,matchIds:[],...options};cup.ties.push(tie);return tie;
}
export function fillMatches(cup,tie,matches){
  if(!tie.a||!tie.b||tie.matchIds.length)return;
  const rule=cup.config.rules[tie.phase==='group'?'group':tie.round==='Final'?'final':tie.round==='Semi-final'||tie.round==='Third place'?'semi':'quarter'];
  for(const discipline of disciplines){const m={id:randomUUID(),tieId:tie.id,discipline,version:0,status:'pending',winner:null,court:null,lineup:{a:[],b:[]},rule:structuredClone(rule),games:[{a:0,b:0,complete:false}]};tie.matchIds.push(m.id);matches.push(m);}
}
export function tieResult(tie,matches){
  if(tie.bye){tie.status='completed';tie.winner=tie.a;return;}
  const ms=matches.filter(m=>tie.matchIds.includes(m.id));tie.winsA=ms.filter(m=>m.winner==='a').length;tie.winsB=ms.filter(m=>m.winner==='b').length;
  tie.winner=tie.winsA>=2?tie.a:tie.winsB>=2?tie.b:null;
  tie.status=ms.length===3&&ms.every(m=>m.status==='completed')?'completed':ms.some(m=>m.status!=='pending')?'live':'pending';
}
export function standings(cup,teams,matches){
  return cup.groups.map(group=>{
    const rows=group.teams.map(id=>({id,name:teams.find(t=>t.id===id)?.name||'Team',played:0,won:0,lost:0,matchesWon:0,matchesLost:0,matchDifference:0,pointDifference:0}));
    for(const tie of cup.ties.filter(t=>t.group===group.id)){
      for(const [side,teamId] of [['a',tie.a],['b',tie.b]]){
        const r=rows.find(x=>x.id===teamId);if(!r)continue;
        if(tie.status==='completed'){r.played++;if(tie.winner===teamId)r.won++;else r.lost++;}
        for(const m of matches.filter(m=>tie.matchIds.includes(m.id))){
          if(m.status==='completed'){if(m.winner===side)r.matchesWon++;else r.matchesLost++;}
          for(const game of m.games)r.pointDifference+=game[side]-game[side==='a'?'b':'a'];
        }
        r.matchDifference=r.matchesWon-r.matchesLost;
      }
    }
    rows.sort((a,b)=>b.won-a.won||b.matchDifference-a.matchDifference||b.pointDifference-a.pointDifference||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    return {id:group.id,name:group.name,rows:rows.map((r,i)=>({...r,position:i+1}))};
  });
}
function knockout(cup,teams,matches){
  const tables=standings(cup,teams,matches).map(g=>({...g,rows:g.rows.filter(r=>teams.some(t=>t.id===r.id&&t.status==='confirmed'))})),qualified=[];
  for(let rank=0;rank<cup.config.qualifiers;rank++)for(const group of tables)qualified.push({id:group.rows[rank].id,group:group.id});
  let size=2;while(size<qualified.length)size*=2;
  // Highest group ranks receive byes; pair others across groups where possible.
  const byes=size-qualified.length,seeds=qualified.slice(),pairs=[];
  for(let i=0;i<byes;i++)pairs.push([seeds.shift(),null]);
  while(seeds.length){const a=seeds.shift();let j=seeds.findLastIndex(b=>b.group!==a.group);if(j<0)j=seeds.length-1;pairs.push([a,seeds.splice(j,1)[0]]);}
  // Split bye recipients across bracket halves.
  if(pairs.length===4&&byes===2)[pairs[1],pairs[2]]=[pairs[2],pairs[1]];
  let round=pairs.map(([a,b])=>newTie(cup,matches,{phase:'knockout',round:size===8?'Quarter-final':size===4?'Semi-final':'Final',size,a:a.id,b:b?.id||null,bye:!b}));
  round.forEach(t=>fillMatches(cup,t,matches));
  while(round.length>1){size/=2;const next=[];for(let i=0;i<round.length;i+=2)next.push(newTie(cup,matches,{phase:'knockout',round:size===4?'Semi-final':'Final',size,a:null,b:null,feederA:round[i].id,feederB:round[i+1].id}));round=next;}
  cup.knockout=true;
}
export function progress(cup,teams,matches){
  cup.ties.forEach(t=>tieResult(t,matches));
  const groups=cup.ties.filter(t=>t.phase==='group');
  if(!cup.knockout&&groups.length&&groups.every(t=>t.status==='completed'))knockout(cup,teams,matches);
  for(const tie of cup.ties.filter(t=>t.phase==='knockout')){
    for(const side of ['a','b']){const feeder=cup.ties.find(t=>t.id===tie[side==='a'?'feederA':'feederB']);if(feeder)tie[side]=feeder.status==='completed'?feeder.winner:null;}
    fillMatches(cup,tie,matches);tieResult(tie,matches);
  }
  const semis=cup.ties.filter(t=>t.round==='Semi-final');
  if(cup.config.thirdPlace&&semis.length===2&&semis.every(t=>t.status==='completed')&&!cup.ties.some(t=>t.round==='Third place')){
    const losers=semis.map(t=>t.winner===t.a?t.b:t.a);
    const t=newTie(cup,matches,{phase:'third',round:'Third place',a:losers[0],b:losers[1]});fillMatches(cup,t,matches);
  }
}
