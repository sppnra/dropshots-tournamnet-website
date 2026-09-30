import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {transaction} from './db.mjs';
import {check,id,uuid,integer,player,text,bool,date} from './validation.mjs';
import scoring from '../scoring-core.js';
import {newCup,newTie,fillMatches,progress,standings,disciplineNames,tieResult} from './team-cup-engine.mjs';
const preset={id:'t_team_cup_2026',name:'Dropshot Folks Badminton Team Cup 2026',date:'2026-10-18',venue:'Westminster City School, 55 Palace Street, London SW1E 5HJ'};
const hash=token=>createHash('sha256').update(token).digest('hex');
const actor=user=>user?.email||user?.id||'referee';
export class TeamCupService {
  constructor(pool){this.pool=pool;}
  async create(){
    await transaction(this.pool,async c=>{
      await c.query('insert into tournaments(id,name,event_date,venue) values($1,$2,$3,$4) on conflict(id) do nothing',[preset.id,preset.name,preset.date,preset.venue]);
      await c.query('insert into team_cups(tournament_id,data) values($1,$2::jsonb) on conflict(tournament_id) do nothing',[preset.id,JSON.stringify(newCup())]);
    });return {id:preset.id};
  }
  async list(){return {cups:(await this.pool.query('select t.id,t.name from team_cups c join tournaments t on t.id=c.tournament_id order by t.name')).rows};}
  async load(c,tid,lock=false){
    id(tid,'tournament');
    const row=(await c.query(`select c.*,t.name,t.event_date::text,t.venue from team_cups c join tournaments t on t.id=c.tournament_id where c.tournament_id=$1 ${lock===true?'for update of c':lock==='read'?'for share of c':''}`,[tid])).rows[0];check(row,'Team Cup not created yet',404);
    const teams=(await c.query('select * from team_cup_teams where tournament_id=$1 order by created_at,id',[tid])).rows;
    const members=(await c.query('select m.* from team_cup_members m join team_cup_teams t on t.id=m.team_id where t.tournament_id=$1 order by position',[tid])).rows;
    teams.forEach(t=>{t.members=members.filter(m=>m.team_id===t.id);});
    const matches=(await c.query('select state from team_cup_matches where tournament_id=$1',[tid])).rows.map(r=>r.state);
    return {id:tid,name:row.name,event_date:row.event_date,venue:row.venue,version:row.version,cup:row.data,teams,matches,originalStates:new Map(matches.map(m=>[m.id,JSON.stringify(m)]))};
  }
  async store(c,s){
    await c.query('update team_cups set data=$2::jsonb,version=version+1 where tournament_id=$1',[s.id,JSON.stringify(s.cup)]);
    const ids=s.matches.map(m=>m.id);
    await c.query('delete from team_cup_matches where tournament_id=$1 and not(id=any($2::uuid[]))',[s.id,ids]);
    for(const m of s.matches.filter(m=>s.originalStates.get(m.id)!==JSON.stringify(m)))await c.query('insert into team_cup_matches(id,tournament_id,tie_id,state) values($1,$2,$3,$4::jsonb) on conflict(id) do update set state=excluded.state',[m.id,s.id,m.tieId,JSON.stringify(m)]);
  }
  project(s,admin=false){
    const drawn=new Set(s.cup.groups.flatMap(g=>g.teams));
    const teams=admin?s.teams:s.teams.filter(t=>t.status==='confirmed'||drawn.has(t.id)).map(t=>({id:t.id,name:t.name,status:t.status,members:t.members.map(m=>({id:m.id,name:m.name}))}));
    return {id:s.id,name:s.name,event_date:s.event_date,venue:s.venue,version:s.version,config:s.cup.config,teams,groups:s.cup.groups,ties:s.cup.ties,
      matches:s.matches.map(m=>({...m,discipline_name:disciplineNames[m.discipline]})),standings:standings(s.cup,s.teams,s.matches),progressionWarning:s.cup.progressionWarning||null,
      champion:s.cup.ties.find(t=>t.round==='Final'&&t.status==='completed')?.winner||null};
  }
  async view(tid,admin=false){
    return transaction(this.pool,async c=>{
      const s=await this.load(c,tid,'read'),data=this.project(s,admin);
      if(admin){const tokens=(await c.query('select tok.match_id,tok.token_text from referee_tokens tok join team_cup_matches m on m.id=tok.match_id where m.tournament_id=$1 and tok.active',[tid])).rows;
        data.matches.forEach(m=>{m.referee_token=tokens.find(t=>t.match_id===m.id)?.token_text||null;});}
      return data;
    });
  }
  async register(body){
    const tid=id(body.tournamentId,'tournament'),key=uuid(body.requestKey),name=text(body.teamName,'Team name',100);
    check(body.consent===true,'Confirm permission to provide all four players’ details');
    check(Array.isArray(body.members)&&body.members.length===4,'Register exactly four players');
    const members=body.members.map((m,i)=>{
      const p=player(m,i===0?'Captain':`Player ${i+1}`);check(['men','women'].includes(m.category),'Select category eligibility');
      check(['XS','S','M','L','XL','XXL','3XL'].includes(m.shirtSize),'Select a T-shirt size');return {...p,category:m.category,shirtSize:m.shirtSize};
    });
    check(new Set(members.map(m=>m.email)).size===4,'Each player needs a separate email address');
    check(members.filter(m=>m.category==='men').length===2,'A team needs two men’s-category and two women’s-category players for all three disciplines');
    return transaction(this.pool,async c=>{
      const s=await this.load(c,tid,true);
      const existing=(await c.query('select id,tournament_id,status from team_cup_teams where request_key=$1',[key])).rows[0];
      if(existing){check(existing.tournament_id===tid,'Request ID already used',409);return {team:{id:existing.id,status:existing.status,name}};}
      const open=(await c.query("select ($1::date is null or $1::date >= (now() at time zone 'Europe/London')::date) as open",[s.cup.config.registration_close])).rows[0].open;
      check(s.cup.config.registration_enabled&&open&&!s.cup.groups.length,'Team registration is closed',409);
      const duplicate=s.teams.some(t=>!['rejected','withdrawn'].includes(t.status)&&t.members.some(m=>members.some(p=>p.email===m.email)));
      check(!duplicate,'A player is already registered in another team',409);
      // Pending teams are reviewed centrally; full approval capacity gives waitlist.
      const status=s.teams.filter(t=>t.status==='confirmed').length>=s.cup.config.capacity?'waitlisted':'pending';
      const teamId=randomUUID();await c.query('insert into team_cup_teams(id,tournament_id,name,status,request_key) values($1,$2,$3,$4,$5)',[teamId,tid,name,status,key]);
      for(let i=0;i<4;i++){const p=members[i];await c.query('insert into team_cup_members(id,team_id,position,name,email,phone,category,shirt_size) values($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),teamId,i+1,p.name,p.email,p.phone,p.category,p.shirtSize]);}
      await c.query('update team_cups set version=version+1 where tournament_id=$1',[tid]);return {team:{id:teamId,name,status}};
    });
  }
  async configure(body){
    return transaction(this.pool,async c=>{
      const s=await this.load(c,body.tournamentId,true),cfg=body.config;check(s.version===body.version,'Team Cup changed. Refresh before saving.',409);check(cfg&&typeof cfg==='object','Include Team Cup settings');
      const groupCount=integer(cfg.groupCount,'Groups',2,4),qualifiers=integer(cfg.qualifiers,'Qualifiers',1,4);check(groupCount*qualifiers<=8,'This beta supports up to eight knockout qualifiers');
      const courts=integer(cfg.courts,'Courts',1,20);check(!s.matches.some(m=>m.court>courts),'Move matches from removed courts first',409);
      check(!s.cup.groups.length||groupCount===s.cup.config.groupCount,'Group count is locked after generating the draw',409);
      check(!s.cup.knockout||qualifiers===s.cup.config.qualifiers,'Qualifiers are locked once knockout is generated',409);
      const rules={};for(const k of ['group','quarter','semi','final']){const r=cfg.rules?.[k];check(r&&[11,15,21].includes(r.points)&&[1,3].includes(r.bestOf),'Choose 11, 15 or 21 points and 1 or 3 games');rules[k]={points:r.points,bestOf:r.bestOf};}
      s.cup.config={...s.cup.config,groupCount,qualifiers,courts,thirdPlace:bool(cfg.thirdPlace,'Third place'),registration_enabled:bool(cfg.registration_enabled,'Registration'),registration_close:date(cfg.registration_close,'Closing date'),rules};
      for(const m of s.matches.filter(m=>m.status==='pending')){const tie=s.cup.ties.find(t=>t.id===m.tieId);m.rule=structuredClone(rules[tie.phase==='group'?'group':tie.round==='Final'?'final':tie.round==='Semi-final'||tie.round==='Third place'?'semi':'quarter']);m.version++;}
      const third=s.cup.ties.find(t=>t.round==='Third place');
      if(third&&!s.cup.config.thirdPlace){check(!s.matches.some(m=>third.matchIds.includes(m.id)&&m.status!=='pending'),'Third-place play has already started',409);s.matches=s.matches.filter(m=>!third.matchIds.includes(m.id));s.cup.ties=s.cup.ties.filter(t=>t.id!==third.id);}
      this.advance(s);await this.store(c,s);return {ok:true};
    });
  }
  async teamStatus(body){
    uuid(body.teamId,'team');check(['confirmed','waitlisted','rejected','withdrawn'].includes(body.status),'Invalid team status');
    return transaction(this.pool,async c=>{
      const s=await this.load(c,body.tournamentId,true),team=s.teams.find(t=>t.id===body.teamId);check(team,'Team not found',404);
      check(!s.cup.groups.length||body.status==='withdrawn'||body.status==='confirmed'&&team.status==='confirmed','Team roster is locked after the draw. Withdraw using walkovers instead.',409);
      if(body.status==='confirmed'&&team.status!=='confirmed')check(s.teams.filter(t=>t.status==='confirmed').length<s.cup.config.capacity,'Twelve teams are already approved; keep this team waitlisted',409);
      team.status=body.status;await c.query('update team_cup_teams set status=$2 where id=$1',[team.id,team.status]);
      if(team.status==='withdrawn')for(const tie of s.cup.ties.filter(t=>t.a===team.id||t.b===team.id))for(const m of s.matches.filter(m=>tie.matchIds.includes(m.id)&&m.status!=='completed')){
        const before=structuredClone(m);m.status='completed';m.winner=tie.a===team.id?'b':'a';m.walkover=true;m.version++;
        await this.audit(c,s,m,'walkover',actor(body.user),before,{reason:'Team withdrawn'});
      }
      this.advance(s);await this.store(c,s);return {ok:true};
    });
  }
  advance(s){
    s.cup.ties.forEach(t=>tieResult(t,s.matches));
    // Withdrawn teams are not qualifiers; pause safely if a group lacks active teams.
    if(!s.cup.knockout&&s.cup.groups.some(g=>g.teams.filter(id=>s.teams.some(t=>t.id===id&&t.status==='confirmed')).length<s.cup.config.qualifiers)){s.cup.progressionWarning='A group has too few active teams to qualify. Reduce qualifiers before knockout.';return;}
    delete s.cup.progressionWarning;progress(s.cup,s.teams,s.matches);
  }
  async draw(body){
    return transaction(this.pool,async c=>{
      const s=await this.load(c,body.tournamentId,true);check(s.version===body.version,'Team Cup changed. Refresh before drawing.',409);check(!s.cup.groups.length,'A Team Cup draw already exists',409);
      const approved=s.teams.filter(t=>t.status==='confirmed');check(approved.length>=s.cup.config.groupCount*2,'Approve at least two teams per group',409);
      const assignments=body.groups||approved.map((t,i)=>({teamId:t.id,group:i%s.cup.config.groupCount}));
      check(Array.isArray(assignments)&&assignments.length===approved.length,'Assign every approved team once');
      check(new Set(assignments.map(x=>x.teamId)).size===approved.length&&assignments.every(x=>approved.some(t=>t.id===x.teamId)&&Number.isInteger(x.group)&&x.group>=0&&x.group<s.cup.config.groupCount),'Invalid group assignments');
      for(let i=0;i<s.cup.config.groupCount;i++){
        const ids=assignments.filter(x=>x.group===i).map(x=>x.teamId);check(ids.length>=Math.max(2,s.cup.config.qualifiers),'Each group needs at least two teams and enough qualifiers');
        const g={id:String(i),name:String.fromCharCode(65+i),teams:ids};s.cup.groups.push(g);
        for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++){const t=newTie(s.cup,s.matches,{phase:'group',round:`Group ${g.name}`,group:g.id,a:ids[a],b:ids[b]});fillMatches(s.cup,t,s.matches);}
      }
      s.cup.config.registration_enabled=false;await this.store(c,s);return {ok:true};
    });
  }
  async resetDraw(body,user){
    return transaction(this.pool,async c=>{
      const s=await this.load(c,body.tournamentId,true);check(s.version===body.version,'Team Cup changed. Refresh first.',409);
      check(s.matches.every(m=>m.status==='pending'&&m.games.every(g=>!g.a&&!g.b)),'Cannot clear a draw with live or completed scores; undo those results first.',409);
      await this.audit(c,s,null,'draw_cleared',actor(user),null,{tieCount:s.cup.ties.length});s.matches=[];s.cup.groups=[];s.cup.ties=[];s.cup.knockout=false;delete s.cup.progressionWarning;await this.store(c,s);return {ok:true};
    });
  }
  async audit(c,s,m,action,who,before,detail={}){await c.query('insert into score_events(match_id,tournament_id,action,actor,before_state,detail) values($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[m?.id||null,s.id,action,who,JSON.stringify(before||null),JSON.stringify(detail)]);}
  lineup(s,m,value){
    const tie=s.cup.ties.find(t=>t.id===m.tieId);check(value&&typeof value==='object','Assign both team lineups');
    for(const side of ['a','b']){
      const ids=value[side],team=s.teams.find(t=>t.id===tie[side]);check(Array.isArray(ids)&&ids.length===2&&new Set(ids).size===2&&ids.every(id=>team.members.some(p=>p.id===id)),'Choose two different players from the assigned team');
      const players=ids.map(id=>team.members.find(p=>p.id===id));
      check(m.discipline==='MD'?players.every(p=>p.category==='men'):m.discipline==='WD'?players.every(p=>p.category==='women'):players[0].category!==players[1].category,'Lineup does not meet this discipline’s category eligibility');
    }return value;
  }
  playable(s,m){
    check(m.court&&m.lineup.a.length===2&&m.lineup.b.length===2,'Organizer must set court and lineups before scoring',409);
    const ids=[...m.lineup.a,...m.lineup.b];
    check(!s.matches.some(other=>other.id!==m.id&&other.status==='live'&&(other.court===m.court||[...other.lineup.a,...other.lineup.b].some(id=>ids.includes(id)))),'Court or player is already in another live match',409);
  }
  invalidate(s,m){
    const tie=s.cup.ties.find(t=>t.id===m.tieId);let affected=[];
    if(tie.phase==='group')affected=s.cup.ties.filter(t=>t.phase!=='group');
    else {const queue=[tie.id];while(queue.length){const parent=queue.shift();for(const t of s.cup.ties.filter(t=>t.feederA===parent||t.feederB===parent)){if(!affected.includes(t)){affected.push(t);queue.push(t.id);}}}if(tie.round==='Semi-final')affected.push(...s.cup.ties.filter(t=>t.round==='Third place'));}
    const matchIds=affected.flatMap(t=>t.matchIds);
    check(!s.matches.some(x=>matchIds.includes(x.id)&&x.status!=='pending'),'Correct downstream results first; this result is already in use',409);
    s.matches=s.matches.filter(x=>!matchIds.includes(x.id));
    if(tie.phase==='group'){s.cup.ties=s.cup.ties.filter(t=>t.phase==='group');s.cup.knockout=false;}
    else {affected.forEach(t=>{t.matchIds=[];t.status='pending';t.winner=null;t.winsA=0;t.winsB=0;});s.cup.ties=s.cup.ties.filter(t=>t.round!=='Third place');}
  }
  async updateMatch(body,user=null,token=null){
    const matchId=uuid(body.matchId,'match');
    const found=(await this.pool.query('select tournament_id from team_cup_matches where id=$1',[matchId])).rows[0];check(found,'Match not found',404);
    return transaction(this.pool,async c=>{
      const s=await this.load(c,found.tournament_id,true),m=s.matches.find(m=>m.id===matchId);check(m,'Match no longer available',404);
      if(token){const tok=(await c.query('select match_id from referee_tokens where token_hash=$1 and active',[hash(token)])).rows[0];check(tok?.match_id===matchId,'Referee link is invalid or disabled',403);check(['point','undo','award'].includes(body.action),'Referee action not permitted',403);check(m.status!=='completed','Completed match is read-only; ask the organizer for corrections',409);}
      check(Number.isInteger(body.version)&&body.version===m.version,'Score changed on another device. Refresh before scoring again.',409);
      const before=structuredClone(m),action=body.action;
      if(action==='setup'){
        check(user,'Organizer required',403);const court=integer(body.court,'Court',1,s.cup.config.courts);
        check(m.status==='pending','Lineups are locked once scoring starts; undo to the beginning first',409);m.lineup=this.lineup(s,m,body.lineup);m.court=court;
      }else if(action==='court'){
        check(user,'Organizer required',403);m.court=integer(body.court,'Court',1,s.cup.config.courts);if(m.status==='live')this.playable(s,m);
      }else if(action==='undo'){
        const last=(await c.query("select sequence,before_state from score_events where match_id=$1 and action in ('point','award','walkover','correct') and undone_at is null order by sequence desc limit 1",[m.id])).rows[0];check(last,'Nothing to undo',409);
        if(m.status==='completed')this.invalidate(s,m);const metadata={court:m.court,lineup:m.lineup,rule:m.rule};for(const key of Object.keys(m))delete m[key];Object.assign(m,last.before_state,metadata);if(m.status==='live')this.playable(s,m);
        await c.query('update score_events set undone_at=now() where sequence=$1',[last.sequence]);
      }else if(['point','award','walkover','correct'].includes(action)){
        if(m.status==='completed'){check(user&&action!=='point','Match is already complete',409);this.invalidate(s,m);}
        if(action==='point'){
          check(['a','b'].includes(body.side),'Choose a scoring side');this.playable(s,m);scoring.point(m,body.side);
        }else if(action==='correct'){
          check(user,'Organizer required',403);this.playable(s,m);const cap=m.rule.points===21?30:m.rule.points+9;
          const g=m.games.at(-1);g.a=integer(body.a,'Team A score',0,cap);g.b=integer(body.b,'Team B score',0,cap);check(g.a<cap||g.b<cap,'Both sides cannot reach the game cap');g.complete=false;delete g.winner;m.winner=null;m.status='live';delete m.walkover;
          const winner=['a','b'].find(side=>scoring.gameWon(m.rule,g,side));
          if(winner){g.complete=true;g.winner=winner;if(m.games.filter(g=>g.complete&&g.winner===winner).length>=scoring.neededWins(m.rule)){m.status='completed';m.winner=winner;}else m.games.push({a:0,b:0,complete:false});}
        }else {check(['a','b'].includes(body.side),'Choose the winning side');if(token)this.playable(s,m);m.status='completed';m.winner=body.side;m.walkover=action==='walkover';m.awarded=true;}
      }else check(false,'Unknown match action');
      m.version=before.version+1;await this.audit(c,s,m,action,actor(user),before,{side:body.side||null});this.advance(s);await this.store(c,s);return {ok:true};
    });
  }
  async token(body,user){
    const matchId=uuid(body.matchId,'match');check(['generate','disable'].includes(body.action),'Choose generate or disable');
    const found=(await this.pool.query('select tournament_id from team_cup_matches where id=$1',[matchId])).rows[0];check(found,'Match not found',404);
    return transaction(this.pool,async c=>{
      const s=await this.load(c,found.tournament_id,true);check(s.matches.some(m=>m.id===matchId),'Match no longer exists',404);
      await c.query('update referee_tokens set active=false where match_id=$1',[matchId]);let token=null;
      if(body.action==='generate'){token=randomBytes(32).toString('base64url');await c.query('insert into referee_tokens(token_hash,token_text,match_id) values($1,$2,$3)',[hash(token),token,matchId]);}
      await this.audit(c,s,s.matches.find(m=>m.id===matchId),body.action==='generate'?'token_regenerated':'token_disabled',actor(user),null);
      await c.query('update team_cups set version=version+1 where tournament_id=$1',[s.id]);return {token};
    });
  }
  async auditView(matchId){
    uuid(matchId,'match');return {events:(await this.pool.query('select action,actor,created_at,undone_at,detail from score_events where match_id=$1 order by sequence desc limit 50',[matchId])).rows};
  }
  async referee(token){
    check(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token),'Referee link is invalid or disabled',403);
    const found=(await this.pool.query('select m.tournament_id,t.match_id from referee_tokens t join team_cup_matches m on m.id=t.match_id where t.token_hash=$1 and t.active',[hash(token)])).rows[0];check(found,'Referee link is invalid or disabled',403);
    const s=await this.view(found.tournament_id);const m=s.matches.find(m=>m.id===found.match_id),tie=s.ties.find(t=>t.id===m.tieId);
    return {id:s.id,name:s.name,venue:s.venue,match:m,tie:{id:tie.id,a:{...s.teams.find(t=>t.id===tie.a),members:s.teams.find(t=>t.id===tie.a).members.filter(p=>m.lineup.a.includes(p.id))},b:{...s.teams.find(t=>t.id===tie.b),members:s.teams.find(t=>t.id===tie.b).members.filter(p=>m.lineup.b.includes(p.id))},round:tie.round}};
  }
}
