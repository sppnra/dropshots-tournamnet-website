import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {transaction} from './db.mjs';
import {check,id,uuid,integer,player,text,bool,date,fee} from './validation.mjs';
import scoring from '../scoring-core.js';
import {newCup,newTie,fillMatches,progress,standings,disciplineNames,tieResult,createKnockout} from './team-cup-engine.mjs';
import {CupPaymentService} from './cup-payments.mjs';
const preset={id:'t_team_cup_2026',name:'Dropshot Folks Badminton Team Cup 2026',date:'2026-10-18',venue:'Westminster City School, 55 Palace Street, London SW1E 5HJ'};
const hash=token=>createHash('sha256').update(token).digest('hex');
const actor=user=>user?.email||user?.id||'referee';
export class TeamCupService {
  constructor(pool,email){this.pool=pool;this.payments=new CupPaymentService(pool,email);}
  requireOverride(body,message="Confirm this override and supply a reason"){check(body.override===true,message,409);text(body.reason,"Override reason",300);}
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
    teams.forEach(t=>{t.members=members.filter(m=>m.team_id===t.id);t.past_members=row.data.retiredMembers?.[t.id]||[];});
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
    const teams=admin?s.teams:s.teams.filter(t=>t.status==='confirmed'||drawn.has(t.id)).map(t=>({id:t.id,name:t.name,status:t.status,members:t.members.map(m=>({id:m.id,name:m.name})),past_members:t.past_members}));
    return {id:s.id,name:s.name,event_date:s.event_date,venue:s.venue,version:s.version,seeds:s.cup.seeds||{},config:s.cup.config,confirmed_count:s.teams.filter(t=>t.status==='confirmed').length,teams,groups:s.cup.groups,ties:s.cup.ties,
      matches:s.matches.map(m=>({...m,discipline_name:disciplineNames[m.discipline]})),standings:standings(s.cup,s.teams,s.matches),progressionWarning:s.cup.progressionWarning||null,
      champion:s.cup.ties.find(t=>t.round==='Final'&&t.status==='completed')?.winner||null};
  }
  async view(tid,admin=false){
    return transaction(this.pool,async c=>{
      const s=await this.load(c,tid,'read'),data=this.project(s,admin);
      if(admin){const payments=(await c.query('select p.*,o.kind,o.status as email_status,o.last_error from team_cup_payments p left join payment_email_outbox o on o.cup_payment_id=p.id where p.tournament_id=$1',[tid])).rows;data.teams.forEach(t=>{const rows=payments.filter(p=>p.team_id===t.id);if(rows.length){t.payment={...rows[0],emails:rows.filter(r=>r.kind).map(r=>({kind:r.kind,status:r.email_status,error:r.last_error}))};delete t.payment.data;}});
        const tokens=(await c.query('select tok.match_id,tok.token_text from referee_tokens tok join team_cup_matches m on m.id=tok.match_id where m.tournament_id=$1 and tok.active',[tid])).rows;
        data.matches.forEach(m=>{m.referee_token=tokens.find(t=>t.match_id===m.id)?.token_text||null;});}
      return data;
    });
  }
  async register(body){
    const tid=id(body.tournamentId,'tournament'),key=uuid(body.requestKey),name=text(body.teamName,'Team name',100);
    check(body.consent===true,'Confirm permission to provide all players’ details');
    return transaction(this.pool,async c=>{
      const s=await this.load(c,tid,true),members=this.validateMembers(body.members,s.cup.config.team_size);
      const existing=(await c.query('select id,tournament_id,status from team_cup_teams where request_key=$1',[key])).rows[0];
      if(existing){check(existing.tournament_id===tid,'Request ID already used',409);return {team:{id:existing.id,status:existing.status,name}};}
      const open=(await c.query("select ($1::date is null or $1::date >= (now() at time zone 'Europe/London')::date) as open",[s.cup.config.registration_close])).rows[0].open;
      check(s.cup.config.registration_enabled&&open,'Team registration is closed',409);
      const duplicate=s.teams.some(t=>!['rejected','withdrawn'].includes(t.status)&&t.members.some(m=>members.some(p=>p.email===m.email)));
      check(!duplicate,'A player is already registered in another team',409);
      // Pending teams are reviewed centrally; full approval capacity gives waitlist.
      const full=s.teams.filter(t=>t.status==='confirmed').length>=s.cup.config.capacity;check(!full||s.cup.config.auto_waitlist!==false,'Team capacity is full and automatic waitlist is disabled',409);const status=full?'waitlisted':'pending';
      const teamId=randomUUID();await c.query('insert into team_cup_teams(id,tournament_id,name,status,request_key) values($1,$2,$3,$4,$5)',[teamId,tid,name,status,key]);
      for(let i=0;i<members.length;i++){const p=members[i];await c.query('insert into team_cup_members(id,team_id,position,name,email,phone,category,shirt_size) values($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),teamId,i+1,p.name,p.email,p.phone,p.category,p.shirtSize]);}
      await c.query('update team_cups set version=version+1 where tournament_id=$1',[tid]);return {team:{id:teamId,name,status}};
    });
  }
  async configure(body,user){
    return transaction(this.pool,async c=>{
      const s=await this.load(c,body.tournamentId,true),cfg=body.config;check(s.version===body.version,'Team Cup changed. Refresh before saving.',409);check(cfg&&typeof cfg==='object','Include Team Cup settings');
      const groupCount=integer(cfg.groupCount,'Groups',1,8),qualifiers=integer(cfg.qualifiers,'Qualifiers',1,8);check(groupCount*qualifiers<=32,'This beta supports up to 32 knockout qualifiers');
      const courts=integer(cfg.courts,'Courts',1,20);check(!s.matches.some(m=>m.court>courts),'Move matches from removed courts first',409);
      if(s.cup.groups.length&&groupCount!==s.cup.config.groupCount){this.requireOverride(body,'Changing group count requires a confirmed draw reset');await this.audit(c,s,null,'format_reset',actor(user),{cup:s.cup,matches:s.matches},{reason:body.reason});s.matches=[];s.cup.groups=[];s.cup.ties=[];s.cup.knockout=false;}
      if(s.cup.knockout&&qualifiers!==s.cup.config.qualifiers){this.requireOverride(body);await this.audit(c,s,null,'qualifiers_reset',actor(user),{cup:s.cup,matches:s.matches},{reason:body.reason});s.matches=s.matches.filter(m=>s.cup.ties.find(t=>t.id===m.tieId)?.phase==='group');s.cup.ties=s.cup.ties.filter(t=>t.phase==='group');s.cup.knockout=false;}
      const rules={};for(const k of ['group','quarter','semi','final']){const r=cfg.rules?.[k];check(r&&[11,15,21].includes(r.points)&&[1,3].includes(r.bestOf),'Choose 11, 15 or 21 points and 1 or 3 games');rules[k]={points:r.points,bestOf:r.bestOf};}
      const capacity=integer(cfg.capacity??s.cup.config.capacity,'Team capacity',1,1000),team_size=integer(cfg.team_size??s.cup.config.team_size,'Team size',4,20),fee_per_person=Number(fee(cfg.fee_per_person??s.cup.config.fee_per_person));
      const format=cfg.format||s.cup.config.format||'groups';check(['groups','roundrobin','knockout'].includes(format),'Choose groups, round robin or knockout');
      if(s.cup.ties.length&&format!==(s.cup.config.format||'groups')){this.requireOverride(body);await this.audit(c,s,null,'format_reset',actor(user),{cup:s.cup,matches:s.matches},{reason:body.reason});s.matches=[];s.cup.groups=[];s.cup.ties=[];s.cup.knockout=false;}
      const timeField=(value,label)=>{check(/^([01]\d|2[0-3]):[0-5]\d$/.test(value),`Enter a valid ${label}`);return value;};
      const start_time=timeField(cfg.start_time||s.cup.config.start_time||'09:00','start time'),end_time=timeField(cfg.end_time||s.cup.config.end_time||'16:00','end time');check(end_time>start_time,'End time must be after start time');
      const name=text(body.name??s.name,'Tournament name',160),event_date=date(body.date??s.event_date,'Tournament date'),venue=text(body.venue??s.venue,'Venue',200,true);
      await c.query('update tournaments set name=$2,event_date=$3,venue=$4 where id=$1',[s.id,name,event_date,venue]);
      await this.audit(c,s,null,'settings_changed',actor(user),{name:s.name,event_date:s.event_date,venue:s.venue,config:s.cup.config},{reason:body.reason||null});
      s.cup.config={...s.cup.config,capacity,team_size,fee_per_person,format,start_time,end_time,time:`${start_time}–${end_time}`,auto_waitlist:cfg.auto_waitlist!==false,email_members:cfg.email_members===true,groupCount,qualifiers,courts,thirdPlace:bool(cfg.thirdPlace,'Third place'),registration_enabled:bool(cfg.registration_enabled,'Registration'),registration_close:date(cfg.registration_close,'Closing date'),rules};
      for(const m of s.matches.filter(m=>m.status==='pending')){const tie=s.cup.ties.find(t=>t.id===m.tieId);m.rule=structuredClone(rules[tie.phase==='group'?'group':tie.round==='Final'?'final':tie.round==='Semi-final'||tie.round==='Third place'?'semi':'quarter']);m.version++;}
      const third=s.cup.ties.find(t=>t.round==='Third place');
      if(third&&!s.cup.config.thirdPlace){if(s.matches.some(m=>third.matchIds.includes(m.id)&&m.status!=='pending'))this.requireOverride(body,'Removing a started third-place match requires confirmation');s.matches=s.matches.filter(m=>!third.matchIds.includes(m.id));s.cup.ties=s.cup.ties.filter(t=>t.id!==third.id);}
      this.advance(s);await this.store(c,s);return {ok:true};
    });
  }
  async teamStatus(body){
    uuid(body.teamId,'team');check(['pending','confirmed','waitlisted','rejected','withdrawn'].includes(body.status),'Invalid team status');
    const result=await transaction(this.pool,async c=>{
      const s=await this.load(c,body.tournamentId,true),team=s.teams.find(t=>t.id===body.teamId);check(team,'Team not found',404);
      if(s.cup.ties.length&&body.status!==team.status&&body.status!=='withdrawn')this.requireOverride(body,'Changing drawn team status requires an override');
      if(body.status==='confirmed'&&team.status!=='confirmed'&&s.teams.filter(t=>t.status==='confirmed').length>=s.cup.config.capacity)this.requireOverride(body,`Capacity ${s.cup.config.capacity} is full. Confirm an approval override.`);
      const before={status:team.status};team.status=body.status;await c.query('update team_cup_teams set status=$2 where id=$1',[team.id,team.status]);
      let pid=null;if(team.status==='confirmed')pid=await this.payments.approve(c,s,team);
      if(['withdrawn','rejected','waitlisted','pending'].includes(team.status))for(const tie of s.cup.ties.filter(t=>t.a===team.id||t.b===team.id))for(const m of s.matches.filter(m=>tie.matchIds.includes(m.id)&&m.status!=='completed')){
        const before=structuredClone(m);m.status='completed';m.winner=tie.a===team.id?'b':'a';m.walkover=true;m.version++;await this.audit(c,s,m,'walkover',actor(body.user),before,{reason:'Team removed from active competition'});
      }
      await this.audit(c,s,null,'team_status',actor(body.user),before,{teamId:team.id,status:team.status,reason:body.reason||null});this.advance(s);await this.store(c,s);return pid;
    });return result?this.payments.deliver(result):{ok:true};
  }
  validateMembers(input,size){
    check(Array.isArray(input)&&input.length===size,`Register exactly ${size===4?'four':size} players`);
    const members=input.map((m,i)=>{const p=player(m,i===0?'Captain':`Player ${i+1}`);check(['men','women'].includes(m.category),'Select category eligibility');const shirt=m.shirtSize??m.shirt_size;check(['XS','S','M','L','XL','XXL','3XL'].includes(shirt),'Select a T-shirt size');return {...p,id:m.id,category:m.category,shirtSize:shirt};});
    check(new Set(members.map(m=>m.email)).size===size,'Each player needs a separate email address');check(members.filter(m=>m.category==='men').length>=2&&members.filter(m=>m.category==='women').length>=2,'A team needs at least two men’s-category and two women’s-category players');return members;
  }
  async editTeam(body,user){
    return transaction(this.pool,async c=>{
      const s=await this.load(c,body.tournamentId,true);check(s.version===body.version,'Team Cup changed. Refresh before editing.',409);const team=s.teams.find(t=>t.id===body.teamId);check(team,'Team not found',404);
      const members=this.validateMembers(body.members,body.members.length);check(members.length>=4&&members.length<=20,'Teams need 4–20 players');
      if(s.matches.some(m=>m.status!=='pending'&&s.cup.ties.some(t=>t.id===m.tieId&&(t.a===team.id||t.b===team.id))))this.requireOverride(body,'Editing players after play starts requires confirmation');
      const duplicate=s.teams.some(t=>t.id!==team.id&&!['withdrawn','rejected'].includes(t.status)&&t.members.some(m=>members.some(p=>p.email===m.email)));if(duplicate)this.requireOverride(body,'Player is in another active team; confirm an eligibility override');
      const seed=body.seed==null||body.seed===''?null:integer(Number(body.seed),'Seed',1,1000);s.cup.seeds={...s.cup.seeds,[team.id]:seed};
      await c.query('update team_cup_teams set name=$2 where id=$1',[team.id,text(body.name,'Team name',100)]);
      // Keep member IDs for historical lineups. Removed players remain in historical score audit.
      const ids=members.map(m=>m.id&&team.members.some(p=>p.id===m.id)?m.id:randomUUID());s.cup.retiredMembers={...s.cup.retiredMembers,[team.id]:[...(s.cup.retiredMembers?.[team.id]||[]),...team.members.filter(p=>!ids.includes(p.id)).map(p=>({id:p.id,name:p.name}))]};
      await c.query('delete from team_cup_members where team_id=$1',[team.id]);
      for(let i=0;i<members.length;i++){const m=members[i];await c.query('insert into team_cup_members(id,team_id,position,name,email,phone,category,shirt_size) values($1,$2,$3,$4,$5,$6,$7,$8)',[ids[i],team.id,i+1,m.name,m.email,m.phone,m.category,m.shirtSize]);}
      for(const m of s.matches.filter(m=>m.status!=='completed')){let changed=false;for(const side of ['a','b'])if(s.cup.ties.find(t=>t.id===m.tieId)?.[side]===team.id){const lineup=m.lineup[side].map(id=>members[ids.indexOf(id)]);const valid=lineup.every(Boolean)&&(m.discipline==='MD'?lineup.every(p=>p.category==='men'):m.discipline==='WD'?lineup.every(p=>p.category==='women'):lineup.length===0||lineup[0]?.category!==lineup[1]?.category);if(!valid){m.lineup[side]=[];changed=true;}}if(changed)m.version++;}
      await this.audit(c,s,null,'roster_edited',actor(user),null,{teamId:team.id,reason:body.reason||null,seed});await this.store(c,s);return {ok:true};
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
      const s=await this.load(c,body.tournamentId,true);check(s.version===body.version,'Team Cup changed. Refresh before drawing.',409);check(!s.cup.ties.length,'A Team Cup draw already exists',409);
      const approved=s.teams.filter(t=>t.status==='confirmed').sort((a,b)=>(s.cup.seeds?.[a.id]||1001)-(s.cup.seeds?.[b.id]||1001));
      if(s.cup.config.format==='knockout'){check(approved.length>=2&&approved.length<=32,'Knockout supports 2–32 teams');createKnockout(s.cup,s.matches,approved.map(t=>({id:t.id,group:t.id})));this.advance(s);s.cup.config.registration_enabled=false;await this.store(c,s);return {ok:true};}
      if(s.cup.config.format==='roundrobin')s.cup.config.groupCount=1;
      check(approved.length>=s.cup.config.groupCount*2,'Approve at least two teams per group',409);
      const assignments=s.cup.config.format==='roundrobin'?approved.map(t=>({teamId:t.id,group:0})):body.groups||approved.map((t,i)=>({teamId:t.id,group:i%s.cup.config.groupCount}));
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
      if(!s.matches.every(m=>m.status==='pending'&&m.games.every(g=>!g.a&&!g.b)))this.requireOverride(body,'Resetting a started draw requires confirmation and a reason');
      await this.audit(c,s,null,'draw_cleared',actor(user),{cup:s.cup,matches:s.matches},{tieCount:s.cup.ties.length,reason:body.reason||null});s.matches=[];s.cup.groups=[];s.cup.ties=[];s.cup.knockout=false;delete s.cup.progressionWarning;await this.store(c,s);return {ok:true};
    });
  }
  async audit(c,s,m,action,who,before,detail={}){await c.query('insert into score_events(match_id,tournament_id,action,actor,before_state,detail) values($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[m?.id||null,s.id,action,who,JSON.stringify(before||null),JSON.stringify(detail)]);}
  lineup(s,m,value,override=false){
    const tie=s.cup.ties.find(t=>t.id===m.tieId);check(value&&typeof value==='object','Assign both team lineups');
    for(const side of ['a','b']){
      const ids=value[side],team=s.teams.find(t=>t.id===tie[side]);check(Array.isArray(ids)&&ids.length===2&&new Set(ids).size===2&&ids.every(id=>team.members.some(p=>p.id===id)),'Choose two different players from the assigned team');
      const players=ids.map(id=>team.members.find(p=>p.id===id));
      check(override||(m.discipline==='MD'?players.every(p=>p.category==='men'):m.discipline==='WD'?players.every(p=>p.category==='women'):players[0].category!==players[1].category),'Lineup does not meet this discipline’s category eligibility');
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
    check(s.forceOverride||!s.matches.some(x=>matchIds.includes(x.id)&&x.status!=='pending'),'Correct downstream results first or confirm an override to reset affected results',409);
    s.matches=s.matches.filter(x=>!matchIds.includes(x.id));
    if(tie.phase==='group'){s.cup.ties=s.cup.ties.filter(t=>t.phase==='group');s.cup.knockout=false;}
    else {affected.forEach(t=>{t.matchIds=[];t.status='pending';t.winner=null;t.winsA=0;t.winsB=0;});s.cup.ties=s.cup.ties.filter(t=>t.round!=='Third place');}
  }
  async updateMatch(body,user=null,token=null){
    const matchId=uuid(body.matchId,'match');
    const found=(await this.pool.query('select tournament_id from team_cup_matches where id=$1',[matchId])).rows[0];check(found,'Match not found',404);
    return transaction(this.pool,async c=>{
      const s=await this.load(c,found.tournament_id,true),m=s.matches.find(m=>m.id===matchId);check(m,'Match no longer available',404);
      if(user&&body.override){this.requireOverride(body);s.forceOverride=true;}
      if(token){const tok=(await c.query('select match_id from referee_tokens where token_hash=$1 and active',[hash(token)])).rows[0];check(tok?.match_id===matchId,'Referee link is invalid or disabled',403);check(['point','undo','award'].includes(body.action),'Referee action not permitted',403);check(m.status!=='completed','Completed match is read-only; ask the organizer for corrections',409);}
      check(Number.isInteger(body.version)&&body.version===m.version,'Score changed on another device. Refresh before scoring again.',409);
      const before=structuredClone(m),action=body.action;
      if(action==='setup'){
        check(user,'Organizer required',403);const court=integer(body.court,'Court',1,s.cup.config.courts);
        if(m.status!=='pending')this.requireOverride(body,'Changing started lineups requires confirmation');m.lineup=this.lineup(s,m,body.lineup,body.override===true);m.eligibilityOverride=body.override===true;m.court=court;
      }else if(action==='court'){
        check(user,'Organizer required',403);m.court=integer(body.court,'Court',1,s.cup.config.courts);if(m.status==='live')this.playable(s,m);
      }else if(action==='start'){check(user,'Organizer required',403);check(m.status==='pending','Only a pending match can be started',409);this.playable(s,m);m.status='live';
      }else if(action==='result'){check(user,'Organizer required',403);this.requireOverride(body);this.invalidate(s,m);const tie=s.cup.ties.find(t=>t.id===m.tieId);delete tie.overrideWinner;
        check(Array.isArray(body.games)&&body.games.length>=1&&body.games.length<=m.rule.bestOf,'Supply valid game scores');const cap=m.rule.points===21?30:m.rule.points+9;m.games=[];m.status='live';m.winner=null;delete m.walkover;delete m.awarded;
        for(const [i,input] of body.games.entries()){check(m.status!=='completed','Games after the match was won are invalid');const g={a:integer(input.a,'A score',0,cap),b:integer(input.b,'B score',0,cap),complete:false};check(g.a<cap||g.b<cap,'Both sides cannot reach the game cap');const winner=['a','b'].find(side=>scoring.gameWon(m.rule,g,side));if(winner){g.complete=true;g.winner=winner;}else check(i===body.games.length-1,'Finish earlier games before entering the next game');m.games.push(g);if(winner&&m.games.filter(g=>g.winner===winner).length>=scoring.neededWins(m.rule)){m.status='completed';m.winner=winner;}}
        if(m.status!=='completed'&&m.games.at(-1).complete)m.games.push({a:0,b:0,complete:false});if(m.status==='live')this.playable(s,m);
      }else if(action==='reopen'){check(user,'Organizer required',403);this.requireOverride(body);this.invalidate(s,m);const tie=s.cup.ties.find(t=>t.id===m.tieId);delete tie.overrideWinner;m.games=[{a:0,b:0,complete:false}];m.status='pending';m.winner=null;delete m.awarded;delete m.walkover;
      }else if(action==='undo'){
        const last=(await c.query("select sequence,before_state from score_events where match_id=$1 and action in ('point','award','walkover','correct','result','reopen') and undone_at is null order by sequence desc limit 1",[m.id])).rows[0];check(last,'Nothing to undo',409);
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
      m.version=before.version+1;await this.audit(c,s,m,action,actor(user),before,{side:body.side||null,reason:body.reason||null});this.advance(s);await this.store(c,s);return {ok:true};
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
  async operations(body,user){
    return transaction(this.pool,async c=>{
      const s=await this.load(c,body.tournamentId,true);check(s.version===body.version,'Team Cup changed. Refresh before overriding.',409);
      this.requireOverride(body);s.forceOverride=true;
      const before=structuredClone({cup:s.cup,matches:s.matches});
      const validTeam=id=>s.teams.some(t=>t.id===id);const clearTie=t=>{s.matches=s.matches.filter(m=>!t.matchIds.includes(m.id));t.matchIds=[];t.status='pending';t.winner=null;delete t.overrideWinner;};
      const dropKnockout=()=>{s.matches=s.matches.filter(m=>s.cup.ties.find(t=>t.id===m.tieId)?.phase==='group');s.cup.ties=s.cup.ties.filter(t=>t.phase==='group');s.cup.knockout=false;};
      if(body.action==='move-group'){
        check(validTeam(body.teamId),'Team not found');const dest=s.cup.groups.find(g=>g.id===body.groupId);check(dest,'Group not found');dropKnockout();
        const affected=s.cup.ties.filter(t=>t.a===body.teamId||t.b===body.teamId);s.matches=s.matches.filter(m=>!affected.some(t=>t.matchIds.includes(m.id)));s.cup.ties=s.cup.ties.filter(t=>!affected.includes(t));
        s.cup.groups.forEach(g=>g.teams=g.teams.filter(id=>id!==body.teamId));dest.teams.push(body.teamId);
        for(const other of dest.teams.filter(id=>id!==body.teamId)){const tie=newTie(s.cup,s.matches,{phase:'group',round:`Group ${dest.name}`,group:dest.id,a:body.teamId,b:other});fillMatches(s.cup,tie,s.matches);}
      }else if(body.action==='winner'){
        const tie=s.cup.ties.find(t=>t.id===body.tieId);check(tie,'Tie not found');check(!body.teamId||[tie.a,tie.b].includes(body.teamId),'Winner must be one of this tie’s teams');
        this.invalidate(s,{tieId:tie.id});if(body.teamId)tie.overrideWinner=body.teamId;else delete tie.overrideWinner;
      }else if(body.action==='advance'){
        const tie=s.cup.ties.find(t=>t.id===body.tieId);check(tie&&tie.phase!=='group','Select a knockout tie');check(['a','b'].includes(body.side)&&validTeam(body.teamId),'Select side and team');
        this.invalidate(s,{tieId:tie.id});clearTie(tie);tie.manualSides={...tie.manualSides,[body.side]:body.teamId};tie[body.side]=body.teamId;check(tie.a!==tie.b,'Cannot play the same team on both sides');tie.bye=false;fillMatches(s.cup,tie,s.matches);
      }else if(['fixture','delete-fixture'].includes(body.action)){
        let tie=s.cup.ties.find(t=>t.id===body.tieId);check(!tie||tie.phase==='group','Edit knockout participants with the manual advance action');
        if(tie){this.invalidate(s,{tieId:tie.id});clearTie(tie);}
        if(body.action==='delete-fixture'){check(tie,'Tie not found');s.cup.ties=s.cup.ties.filter(t=>t.id!==tie.id);}
        else {check(validTeam(body.a)&&validTeam(body.b)&&body.a!==body.b,'Select two different teams');const group=s.cup.groups.find(g=>g.id===body.groupId);check(group,'Select a group');check(group.teams.includes(body.a)&&group.teams.includes(body.b),'Both teams must belong to the selected group');
          if(!tie)tie=newTie(s.cup,s.matches,{phase:'group',round:`Group ${group.name}`,group:group.id});Object.assign(tie,{a:body.a,b:body.b,group:group.id,phase:'group',round:`Group ${group.name}`});fillMatches(s.cup,tie,s.matches);
        }
      }else check(false,'Unknown override action');
      await this.audit(c,s,null,body.action,actor(user),before,{reason:body.reason,teamId:body.teamId||null,tieId:body.tieId||null});this.advance(s);await this.store(c,s);return {ok:true};
    });
  }
  async auditView(matchId,tid){
    if(tid){id(tid,'tournament');return {events:(await this.pool.query('select action,actor,created_at,undone_at,detail from score_events where tournament_id=$1 order by sequence desc limit 100',[tid])).rows};}
    uuid(matchId,'match');return {events:(await this.pool.query('select action,actor,created_at,undone_at,detail from score_events where match_id=$1 order by sequence desc limit 50',[matchId])).rows};
  }
  async referee(token){
    check(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token),'Referee link is invalid or disabled',403);
    const found=(await this.pool.query('select m.tournament_id,t.match_id from referee_tokens t join team_cup_matches m on m.id=t.match_id where t.token_hash=$1 and t.active',[hash(token)])).rows[0];check(found,'Referee link is invalid or disabled',403);
    const s=await this.view(found.tournament_id);const m=s.matches.find(m=>m.id===found.match_id),tie=s.ties.find(t=>t.id===m.tieId);
    const sideTeam=side=>{const team=s.teams.find(t=>t.id===tie[side]);return {id:team.id,name:team.name,members:[...team.members,...(team.past_members||[])].filter(p=>m.lineup[side].includes(p.id)).map(p=>({id:p.id,name:p.name}))};};
    return {id:s.id,name:s.name,venue:s.venue,match:m,tie:{id:tie.id,a:sideTeam('a'),b:sideTeam('b'),round:tie.round}};
  }
}
