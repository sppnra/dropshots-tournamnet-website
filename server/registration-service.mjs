import {randomUUID} from 'node:crypto';
import {transaction} from './db.mjs';
import {check,id,uuid,registrationInput,catalogueInput,HttpError} from './validation.mjs';
const dateExpr="(now() at time zone 'Europe/London')::date";
const publicEventColumns=`e.id,e.tournament_id,e.name,e.event_type,e.capacity,e.registration_enabled,e.registration_close::text,e.allow_partner_needed,e.auto_waitlist,
  (select count(*)::integer from event_entries en where en.event_id=e.id and en.active) as confirmed_count`;
const registrationColumns=`r.id,r.tournament_id,r.event_id,r.status,r.needs_partner,r.entry_id as local_entry_id,r.created_at,
  e.name as event_name,e.event_type,t.name as tournament_name,team.name as team_name,
  p.name as player1_name,p.email as player1_email,p.phone as player1_phone,
  coalesce(p2.name,member2.name) as player2_name,coalesce(p2.email,member2.email) as player2_email,coalesce(p2.phone,member2.phone) as player2_phone`;
const registrationJoins=`from registrations r join events e on e.id=r.event_id join tournaments t on t.id=r.tournament_id
  join players p on p.id=r.player_id left join players p2 on p2.id=r.partner_id left join teams team on team.id=r.team_id
  left join team_members tm2 on tm2.team_id=r.team_id and tm2.player_id<>r.player_id left join players member2 on member2.id=tm2.player_id`;

export class RegistrationService {
  constructor(pool){this.pool=pool;}
  async catalogue(admin=false,tournamentId=null){
    if(tournamentId)id(tournamentId,'tournament');
    const tournaments=(await this.pool.query(`select id,name,event_date::text,venue,revision from tournaments t where ($1::text is null or id=$1)
      ${admin?'':`and published and exists(select 1 from events e where e.tournament_id=t.id and e.registration_enabled and (e.registration_close is null or e.registration_close>=${dateExpr}))`} order by event_date nulls last,name`,[tournamentId])).rows;
    const events=(await this.pool.query(`select ${publicEventColumns},e.format from events e join tournaments t on t.id=e.tournament_id where ($1::text is null or e.tournament_id=$1)
      ${admin?'':`and t.published and e.registration_enabled and (e.registration_close is null or e.registration_close>=${dateExpr})`} order by e.name`,[tournamentId])).rows;
    return {tournaments:tournaments.map(t=>({...t,events:events.filter(e=>e.tournament_id===t.id)}))};
  }
  async publish(body){
    const t=catalogueInput(body);
    return transaction(this.pool,async c=>{
      await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[t.id]);
      const old=(await c.query('select revision from tournaments where id=$1 for update',[t.id])).rows[0];
      check((old?.revision||0)===t.revision,'Registration settings changed on another device. Refresh before publishing.',409);
      const rev=(old?.revision||0)+1;
      await c.query(`insert into tournaments(id,name,event_date,venue,revision) values($1,$2,$3,$4,$5)
        on conflict(id) do update set name=excluded.name,event_date=excluded.event_date,venue=excluded.venue,revision=excluded.revision,updated_at=now()`,[t.id,t.name,t.date,t.venue,rev]);
      for(const e of t.events){
        const existing=(await c.query('select tournament_id,event_type from events where id=$1 for update',[e.id])).rows[0];
        check(!existing||existing.tournament_id===t.id,'An event belongs to another tournament',409);
        if(existing&&existing.event_type!==e.type)check(!(await c.query('select 1 from registrations where event_id=$1 limit 1',[e.id])).rows.length,'An event with registrations cannot change between singles and doubles',409);
        await c.query(`insert into events(id,tournament_id,name,event_type,format,capacity,registration_enabled,registration_close,allow_partner_needed,auto_waitlist)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(id) do update set name=excluded.name,event_type=excluded.event_type,format=excluded.format,capacity=excluded.capacity,
          registration_enabled=excluded.registration_enabled,registration_close=excluded.registration_close,allow_partner_needed=excluded.allow_partner_needed,auto_waitlist=excluded.auto_waitlist,updated_at=now()`,
          [e.id,t.id,e.name,e.type,e.format,e.capacity,e.enabled,e.closeDate,e.type==='doubles'&&e.allowPartnerNeeded,e.autoWaitlist]);
      }
      await c.query('update events set registration_enabled=false where tournament_id=$1 and not(id=any($2::text[]))',[t.id,t.events.map(e=>e.id)]);
      return {revision:rev};
    });
  }
  async ensurePlayer(c,tournamentId,data){
    // Never let anonymous signups overwrite contact information already in use.
    await c.query('insert into players(id,tournament_id,name,email,phone) values($1,$2,$3,$4,$5) on conflict(tournament_id,email) do nothing',[randomUUID(),tournamentId,data.name,data.email,data.phone]);
    const p=(await c.query('select * from players where tournament_id=$1 and email=$2',[tournamentId,data.email])).rows[0];
    check(p.name===data.name&&p.phone===data.phone,'This email already has different player details. Contact the organizer to update them.',409);
    return p;
  }
  async makeTeam(c,tournamentId,name,p1,p2){
    const teamId=randomUUID();
    await c.query('insert into teams(id,tournament_id,name) values($1,$2,$3)',[teamId,tournamentId,name||`${p1.name} / ${p2.name}`]);
    await c.query('insert into team_members(team_id,player_id,position) values($1,$2,1),($1,$3,2)',[teamId,p1.id,p2.id]);
    return teamId;
  }
  async receipt(c,r){
    const row=(await c.query(`select r.id,r.status,e.name as event_name,t.name as tournament_name,
      coalesce(team.name,p.name) as entry_name from registrations r join events e on e.id=r.event_id join tournaments t on t.id=r.tournament_id
      join players p on p.id=r.player_id left join teams team on team.id=r.team_id where r.id=$1`,[r.id])).rows[0];
    return {registration:row};
  }
  async submit(body){
    const input=registrationInput(body);
    return transaction(this.pool,async c=>{
      // One event lock serializes submissions, confirmation and pairing.
      const e=(await c.query(`select e.*,t.published,(e.registration_close is null or e.registration_close>=${dateExpr}) as in_date
        from events e join tournaments t on t.id=e.tournament_id where e.id=$1 and e.tournament_id=$2 for update of e`,[input.eventId,input.tournamentId])).rows[0];
      check(e,'Event not found',404);
      const retry=(await c.query('select * from registrations where request_key=$1',[input.requestKey])).rows[0];
      if(retry){
        check(retry.event_id===input.eventId&&retry.tournament_id===input.tournamentId,'Request ID is already in use',409);
        return this.receipt(c,retry);
      }
      check(e.published&&e.registration_enabled&&e.in_date,'Registration is closed for this event',409);
      check(!input.needsPartner||(e.event_type==='doubles'&&e.allow_partner_needed),'Partner matching is not available');
      check(e.event_type!=='doubles'||input.needsPartner||input.player2,'Add your partner details or select “I need a partner”');
      check(e.event_type==='doubles'||(!input.player2&&!input.needsPartner),'Singles registrations contain one player');
      const contacts=[input.player1.email,...(input.player2&&!input.needsPartner?[input.player2.email]:[])];
      const duplicate=(await c.query(`select 1 from registrations r join players p on p.id=r.player_id left join players p2 on p2.id=r.partner_id
        where r.event_id=$1 and r.status not in ('rejected','withdrawn') and (p.email=any($2::text[]) or p2.email=any($2::text[])
        or exists(select 1 from team_members tm join players tp on tp.id=tm.player_id where tm.team_id=r.team_id and tp.email=any($2::text[]))) limit 1`,[e.id,contacts])).rows.length;
      check(!duplicate,'A player is already registered for this event. Contact the organizer to change the entry.',409);
      const count=Number((await c.query('select count(*)::integer as n from event_entries where event_id=$1 and active',[e.id])).rows[0].n);
      check(count<e.capacity||e.auto_waitlist,'This event is full and its waitlist is closed',409);
      const status=input.needsPartner?'needs_partner':count>=e.capacity?'waitlisted':'pending';
      const p1=await this.ensurePlayer(c,e.tournament_id,input.player1);
      const p2=e.event_type==='doubles'&&!input.needsPartner?await this.ensurePlayer(c,e.tournament_id,input.player2):null;
      const teamId=p2?await this.makeTeam(c,e.tournament_id,input.teamName,p1,p2):null;
      const regId=randomUUID();
      await c.query(`insert into registrations(id,request_key,tournament_id,event_id,player_id,partner_id,team_id,needs_partner,status)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[regId,input.requestKey,e.tournament_id,e.id,p1.id,p2?.id||null,teamId,input.needsPartner,status]);
      return this.receipt(c,{id:regId});
    });
  }
  async list(filters={}){
    const conditions=[],params=[];
    const add=(sql,v)=>{params.push(v);conditions.push(sql.replace('?',`$${params.length}`));};
    if(filters.tournament)add('r.tournament_id=?',id(filters.tournament,'tournament'));
    if(filters.event)add('r.event_id=?',id(filters.event,'event'));
    if(filters.status){check(['pending','confirmed','waitlisted','needs_partner','rejected','withdrawn'].includes(filters.status),'Invalid status');add('r.status=?',filters.status);}
    if(filters.search){check(filters.search.length<=100,'Search is too long');params.push(filters.search);const n=params.length;conditions.push(`(position(lower($${n}) in lower(p.name))>0 or position(lower($${n}) in lower(coalesce(p2.name,member2.name,'')))>0 or position(lower($${n}) in lower(coalesce(team.name,'')))>0)`);}
    const offset=Number(filters.offset||0);check(Number.isInteger(offset)&&offset>=0&&offset<=100000,'Invalid page');
    const where=conditions.length?'where '+conditions.join(' and '):'';
    const rows=(await this.pool.query(`select ${registrationColumns} ${registrationJoins} ${where} order by r.created_at desc,r.id limit 201 offset ${offset}`,params)).rows;
    const counts=(await this.pool.query(`select r.status,count(*)::integer as count ${registrationJoins} ${where} group by r.status`,params)).rows;
    return {registrations:rows.slice(0,200),counts:Object.fromEntries(counts.map(x=>[x.status,x.count])),next_offset:rows.length>200?offset+200:null};
  }
  async entries(tournamentId){
    id(tournamentId,'tournament');
    const entries=(await this.pool.query(`select en.id,en.event_id,coalesce(team.name,p.name) as name,coalesce(p.name,p1.name) as p1,coalesce(p2.name,'') as p2
      from event_entries en join events e on e.id=en.event_id left join players p on p.id=en.player_id left join teams team on team.id=en.team_id
      left join team_members tm1 on tm1.team_id=en.team_id and tm1.position=1 left join players p1 on p1.id=tm1.player_id
      left join team_members tm2 on tm2.team_id=en.team_id and tm2.position=2 left join players p2 on p2.id=tm2.player_id
      where e.tournament_id=$1 and en.active order by en.created_at,en.id`,[tournamentId])).rows;
    return {entries};
  }
  async lockRegistration(c,registrationId){
    uuid(registrationId,'registration');
    const found=(await c.query('select event_id from registrations where id=$1',[registrationId])).rows[0];check(found,'Registration not found',404);
    const e=(await c.query('select * from events where id=$1 for update',[found.event_id])).rows[0];
    const r=(await c.query('select * from registrations where id=$1 for update',[registrationId])).rows[0];check(r,'Registration not found',404);
    return {e,r};
  }
  async activate(c,e,r,overrideCapacity=false){
    const current=r.entry_id?(await c.query('select * from event_entries where id=$1',[r.entry_id])).rows[0]:null;
    if(current?.active)return current.id;
    const count=Number((await c.query('select count(*)::integer as n from event_entries where event_id=$1 and active',[e.id])).rows[0].n);
    check(overrideCapacity||count<e.capacity,'Event is full. Keep this entry waitlisted or explicitly override capacity.',409);
    const entryId=current?.id||`en_${randomUUID().replaceAll('-','')}`;
    await c.query(`insert into event_entries(id,event_id,player_id,team_id,active) values($1,$2,$3,$4,true)
      on conflict(id) do update set active=true`,[entryId,e.id,r.team_id?null:r.player_id,r.team_id]);
    return entryId;
  }
  async status(registrationId,body){
    const status=body.status;
    check(['confirmed','waitlisted','rejected','withdrawn'].includes(status),'Invalid registration status');
    check(body.overrideCapacity===undefined||typeof body.overrideCapacity==='boolean','Invalid capacity override');
    return transaction(this.pool,async c=>{
      const {e,r}=await this.lockRegistration(c,registrationId);
      if(status==='confirmed'){
        check(!r.needs_partner||r.team_id,'Pair this player before confirming');
        const entryId=await this.activate(c,e,r,body.overrideCapacity===true);
        await c.query(`update registrations set status='confirmed',entry_id=$1,updated_at=now() where id=$2 or ($3::uuid is not null and team_id=$3 and event_id=$4)`,[entryId,r.id,r.team_id,e.id]);
      }else{
        if(r.entry_id)await c.query('update event_entries set active=false where id=$1',[r.entry_id]);
        await c.query(`update registrations set status=$1,updated_at=now() where id=$2 or ($3::text is not null and entry_id=$3)`,[status,r.id,r.entry_id]);
      }
      return {ok:true};
    });
  }
  async pair(body){
    check(Array.isArray(body.ids)&&body.ids.length===2&&body.ids[0]!==body.ids[1],'Select two different players');
    const ids=body.ids.map(v=>uuid(v,'registration'));
    return transaction(this.pool,async c=>{
      const {e,r}=await this.lockRegistration(c,ids[0]);
      const b=(await c.query('select * from registrations where id=$1 and event_id=$2 for update',[ids[1],e.id])).rows[0];
      check(b&&b.event_id===e.id&&e.event_type==='doubles','Players must be in the same doubles event');
      // Repeating the same successful request returns the existing pair.
      if(r.status==='confirmed'&&b.status==='confirmed'&&r.entry_id&&r.entry_id===b.entry_id)return {ok:true};
      check(r.status==='needs_partner'&&b.status==='needs_partner'&&!r.team_id&&!b.team_id,'Both players must need a partner',409);
      check(r.player_id!==b.player_id,'Choose two different players');
      const players=(await c.query('select * from players where id=any($1::uuid[])',[[r.player_id,b.player_id]])).rows;
      const p1=players.find(p=>p.id===r.player_id),p2=players.find(p=>p.id===b.player_id);
      const teamId=await this.makeTeam(c,e.tournament_id,'',p1,p2);
      const entryId=await this.activate(c,e,{...r,team_id:teamId});
      await c.query(`update registrations set team_id=$1,entry_id=$2,status='confirmed',updated_at=now() where id=any($3::uuid[])`,[teamId,entryId,ids]);
      return {ok:true};
    });
  }
  async remove(registrationId){
    return transaction(this.pool,async c=>{
      const {r}=await this.lockRegistration(c,registrationId);
      if(r.entry_id){await c.query('update event_entries set active=false where id=$1',[r.entry_id]);await c.query("update registrations set status='withdrawn',updated_at=now() where entry_id=$1",[r.entry_id]);}
      await c.query('delete from registrations where id=$1',[r.id]);
      return {ok:true};
    });
  }
}
