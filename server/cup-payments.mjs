import {randomUUID} from 'node:crypto';
import {PaymentService} from './payments.mjs';
import {transaction} from './db.mjs';
import {check,uuid,fee} from './validation.mjs';
import {paymentEmail} from './email-templates.mjs';
export class CupPaymentService extends PaymentService {
  constructor(pool,email){super(pool,email);this.paymentColumn='cup_payment_id';this.paymentTable='team_cup_payments';}
  async approve(c,s,team){
    const existing=(await c.query('select id from team_cup_payments where team_id=$1',[team.id])).rows[0];if(existing)return existing.id;
    const bank=(await c.query('select payment_reference_prefix from tournament_payment_settings where tournament_id=$1',[s.id])).rows[0];
    const pid=randomUUID(),amount=Math.round(Number(s.cup.config.fee_per_person)*team.members.length*100)/100;
    await c.query(`insert into team_cup_payments(id,team_id,tournament_id,payment_status,payment_reference,payment_amount,fee_per_person,team_size) values($1,$2,$3,$4,$5,$6,$7,$8)`,[pid,team.id,s.id,amount>0?'pending':'not_required',`${bank?.payment_reference_prefix||'DF'}-${pid.replaceAll('-','').slice(0,13).toUpperCase()}`,amount,s.cup.config.fee_per_person,team.members.length]);return pid;
  }
  async registrationIdentity(pid){return (await this.pool.query('select team_id from team_cup_payments where id=$1',[pid])).rows[0]?.team_id||pid;}
  async queue(pid,kind){
    return transaction(this.pool,async c=>{
      const p=(await c.query(`select p.*,t.name as tournament_name,t.event_date::text,t.venue,team.name as entry_name,team.status as registration_status,cup.data
        from team_cup_payments p join tournaments t on t.id=p.tournament_id join team_cup_teams team on team.id=p.team_id join team_cups cup on cup.tournament_id=p.tournament_id where p.id=$1 for update of p`,[pid])).rows[0];
      if(!p||p.payment_status==='not_required'||(kind==='approval'&&p.approval_email_sent_at)||(kind==='payment'&&p.payment_email_sent_at))return;
      check(p.registration_status==='confirmed','Only approved teams can receive payment emails',409);
      check(kind==='payment'?p.payment_status==='paid':p.payment_status==='pending','Use payment instructions for pending payments and receipts for paid payments',409);
      const bank=(await c.query('select * from tournament_payment_settings where tournament_id=$1',[p.tournament_id])).rows[0];
      if(kind==='approval')check(bank?.bank_account_name&&/^\d{6}$/.test(bank.sort_code)&&/^\d{8}$/.test(bank.account_number),'Save complete tournament bank details, then retry the approval email.',409);
      p.members=(await c.query('select name,email,position from team_cup_members where team_id=$1 order by position',[p.team_id])).rows;p.event_name='Team Cup';
      const recipients=p.data.config.email_members?p.members:p.members.slice(0,1);
      for(const recipient of recipients){const payload=paymentEmail(kind,p,recipient,bank);
        await c.query(`insert into payment_email_outbox(id,cup_payment_id,kind,recipient,payload) values($1,$2,$3,$4,$5::jsonb) on conflict(cup_payment_id,kind,recipient) do nothing`,[randomUUID(),pid,kind,recipient.email,JSON.stringify(payload)]);
        // Refresh only definite unsent failures after captain/roster/bank corrections; ambiguous payloads stay stable.
        await c.query(`update payment_email_outbox set payload=$4::jsonb where cup_payment_id=$1 and kind=$2 and recipient=$3 and status in ('queued','failed')`,[pid,kind,recipient.email,JSON.stringify(payload)]);
      }
      const addresses=recipients.map(r=>r.email);await c.query(`delete from payment_email_outbox where cup_payment_id=$1 and kind=$2 and status in ('queued','failed') and not(recipient=any($3::text[]))`,[pid,kind,addresses]);
    });
  }
  async action(body,user,cup){
    uuid(body.teamId,'team');check(['received','pending','retry','amount'].includes(body.action),'Invalid payment action');
    const pid=await transaction(this.pool,async c=>{
      const s=await cup.load(c,body.tournamentId,true),team=s.teams.find(t=>t.id===body.teamId);check(team,'Team not found',404);check(team.status==='confirmed','Approve the team before managing its payment',409);
      const pid=await this.approve(c,s,team);const p=(await c.query('select * from team_cup_payments where id=$1 for update',[pid])).rows[0];
      if(body.action==='received'){
        check(p.payment_status!=='not_required','Payment is not required',409);
        if(p.payment_status!=='paid'){await c.query("update team_cup_payments set payment_status='paid',payment_received_at=now(),payment_received_by=$2 where id=$1",[pid,user.email||user.id]);await cup.audit(c,s,null,'payment_received',user.email||user.id,null,{teamId:team.id});}
      }else if(body.action==='amount'){cup.requireOverride(body);await c.query('update team_cup_payments set payment_amount=$2 where id=$1',[pid,fee(body.amount)]);await cup.audit(c,s,null,'payment_amount_changed',user.email||user.id,null,{teamId:team.id,reason:body.reason});
      }else if(body.action==='pending'){
        cup.requireOverride(body,'Reopening a paid payment requires confirmation and a reason');
        await c.query("update team_cup_payments set payment_status='pending',payment_received_at=null,payment_received_by=null where id=$1",[pid]);await cup.audit(c,s,null,'payment_reopened',user.email||user.id,null,{teamId:team.id,reason:body.reason});
      }
      await c.query('update team_cups set version=version+1 where tournament_id=$1',[s.id]);return pid;
    });
    if(body.action==='retry'){check(['approval','payment'].includes(body.kind),'Choose an email type');return this.deliver(pid,body.kind);}
    return body.action==='received'&&body.sendEmail!==false?this.deliver(pid,'payment'):{ok:true};
  }
}
