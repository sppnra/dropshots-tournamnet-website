import {randomUUID} from 'node:crypto';
import {transaction} from './db.mjs';
import {check,id,uuid,text,integer,HttpError} from './validation.mjs';
import {createEmailService} from './email.mjs';
import {paymentEmail} from './email-templates.mjs';
const defaults={bank_account_name:'',bank_name:'',sort_code:'',account_number:'',payment_reference_prefix:'DF',payment_instructions:'',revision:0};
export class PaymentService {
  constructor(pool,email=createEmailService()){this.pool=pool;this.email=email;}
  async settings(tournamentId){
    id(tournamentId,'tournament');
    return {settings:(await this.pool.query('select * from tournament_payment_settings where tournament_id=$1',[tournamentId])).rows[0]||{...defaults,tournament_id:tournamentId}};
  }
  async saveSettings(body){
    const tid=id(body.tournamentId,'tournament'),rev=integer(body.revision,'Revision',0,2147483646);
    const b={bank_account_name:text(body.bank_account_name,'Account name',100,true),bank_name:text(body.bank_name,'Bank name',100,true),sort_code:text(body.sort_code,'Sort code',8,true).replace(/-/g,''),account_number:text(body.account_number,'Account number',8,true),payment_reference_prefix:text(body.payment_reference_prefix,'Reference prefix',4).toUpperCase(),payment_instructions:text(body.payment_instructions,'Payment instructions',1000,true)};
    check(!b.sort_code||/^\d{6}$/.test(b.sort_code),'Sort code must contain six digits');
    check(!b.account_number||/^\d{8}$/.test(b.account_number),'Account number must contain eight digits');
    check(/^[A-Z0-9]{1,4}$/.test(b.payment_reference_prefix),'Reference prefix must contain letters or digits');
    return transaction(this.pool,async c=>{
      check((await c.query('select id from tournaments where id=$1 for update',[tid])).rows.length,'Publish the tournament before saving its bank details',409);
      const old=(await c.query('select revision from tournament_payment_settings where tournament_id=$1',[tid])).rows[0];
      check((old?.revision||0)===rev,'Bank settings changed on another device. Reload them before saving.',409);
      await c.query(`insert into tournament_payment_settings(tournament_id,bank_account_name,bank_name,sort_code,account_number,payment_reference_prefix,payment_instructions,revision)
        values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(tournament_id) do update set bank_account_name=excluded.bank_account_name,bank_name=excluded.bank_name,sort_code=excluded.sort_code,account_number=excluded.account_number,payment_reference_prefix=excluded.payment_reference_prefix,payment_instructions=excluded.payment_instructions,revision=excluded.revision,updated_at=now()`,[tid,...Object.values(b),rev+1]);
      return {ok:true,revision:rev+1};
    });
  }
  // Called inside the existing event-lock/approval transaction. Stable shared entry ID.
  async approve(c,e,r,entryId){
    const existing=(await c.query('select id from registration_payments where entry_id=$1',[entryId])).rows[0];
    if(existing)return existing.id;
    // A pre-upgrade confirmed entry must never acquire a retrospective charge.
    if(r.status==='confirmed')return null;
    const bank=(await c.query('select payment_reference_prefix from tournament_payment_settings where tournament_id=$1',[e.tournament_id])).rows[0];
    const paymentId=randomUUID(),required=e.payment_required;
    const reference=required?`${bank?.payment_reference_prefix||'DF'}-${paymentId.replaceAll('-','').slice(0,13).toUpperCase()}`:null;
    await c.query(`insert into registration_payments(id,entry_id,tournament_id,event_id,payment_status,payment_reference,payment_amount)
      values($1,$2,$3,$4,$5,$6,$7)`,[paymentId,entryId,e.tournament_id,e.id,required?'pending':'not_required',reference,required?e.entry_fee:0]);
    return paymentId;
  }
  async registrationPayment(registrationId){
    uuid(registrationId,'registration');
    const row=(await this.pool.query(`select p.*,r.status as registration_status from registrations r join registration_payments p on p.entry_id=r.entry_id where r.id=$1`,[registrationId])).rows[0];
    check(row,'No payment is required for this entry',409);return row;
  }
  async markReceived(registrationId,body,user){
    check(typeof body.sendEmail==='boolean','Choose whether to send a payment receipt');
    const payment=await this.registrationPayment(registrationId);
    await transaction(this.pool,async c=>{
      // Match event lock order used by approval, withdrawal and pairing.
      await c.query('select id from events where id=$1 for update',[payment.event_id]);
      const r=(await c.query('select status from registrations where id=$1',[registrationId])).rows[0];
      check(r?.status==='confirmed','Only approved registrations can be marked paid',409);
      const p=(await c.query('select * from registration_payments where id=$1 for update',[payment.id])).rows[0];
      check(p.payment_status!=='not_required','Payment is not required',409);
      if(p.payment_status==='paid')return;
      const actor=text(user.email||user.id,'Organizer',200);
      await c.query("update registration_payments set payment_status='paid',payment_received_at=now(),payment_received_by=$2 where id=$1",[p.id,actor]);
      await c.query("insert into payment_audit(id,payment_id,action,actor) values($1,$2,'received',$3)",[randomUUID(),p.id,actor]);
    });
    return body.sendEmail?this.deliver(payment.id,'payment'):{ok:true};
  }
  async retry(registrationId,kind){
    check(['approval','payment'].includes(kind),'Invalid email type');
    const p=await this.registrationPayment(registrationId);
    check(p.registration_status==='confirmed','Only approved registrations can receive payment emails',409);
    return this.deliver(p.id,kind);
  }
  async queue(paymentId,kind){
    return transaction(this.pool,async c=>{
      const p=(await c.query(`select p.*,t.name as tournament_name,t.event_date::text,t.venue,e.name as event_name,coalesce(team.name,player.name) as entry_name
        from registration_payments p join tournaments t on t.id=p.tournament_id join events e on e.id=p.event_id join event_entries en on en.id=p.entry_id
        left join teams team on team.id=en.team_id left join players player on player.id=en.player_id where p.id=$1 for update of p`,[paymentId])).rows[0];
      if(!p||p.payment_status==='not_required'||(kind==='approval'&&p.approval_email_sent_at)||(kind==='payment'&&p.payment_email_sent_at))return;
      check(kind==='payment'?p.payment_status==='paid':p.payment_status==='pending','Approval payment instructions are only sent while payment is pending; use the payment receipt after payment.',409);
      const en=(await c.query('select active from event_entries where id=$1',[p.entry_id])).rows[0];check(en.active,'This entry is withdrawn or not confirmed',409);
      const bank=(await c.query('select * from tournament_payment_settings where tournament_id=$1',[p.tournament_id])).rows[0];
      if(kind==='approval')check(bank?.bank_account_name&&/^\d{6}$/.test(bank.sort_code)&&/^\d{8}$/.test(bank.account_number),'Save complete tournament bank details, then retry the approval email.',409);
      const players=(await c.query(`select distinct player.name,player.email from event_entries en join players player on player.id=en.player_id
        where en.id=$1 union select player.name,player.email from event_entries en join team_members tm on tm.team_id=en.team_id join players player on player.id=tm.player_id where en.id=$1`,[p.entry_id])).rows;
      for(const recipient of players){
        const payload=paymentEmail(kind,p,recipient,bank);
        await c.query(`insert into payment_email_outbox(id,payment_id,kind,recipient,payload) values($1,$2,$3,$4,$5::jsonb) on conflict(payment_id,kind,recipient) do nothing`,[randomUUID(),p.id,kind,recipient.email,JSON.stringify(payload)]);
      }
    });
  }
  async deliver(paymentId,kind='approval'){
    if(!paymentId)return {ok:true};
    try{
      await this.queue(paymentId,kind);
      const jobs=(await this.pool.query('select id from payment_email_outbox where payment_id=$1 and kind=$2 order by id',[paymentId,kind])).rows;
      for(const {id:jobId} of jobs){
        const job=await transaction(this.pool,async c=>{
          const j=(await c.query('select * from payment_email_outbox where id=$1 for update',[jobId])).rows[0];
          if(j.status==='sent')return null;
          const elapsed=Date.now()-new Date(j.attempt_started_at||0).getTime();
          if(j.status==='sending'&&elapsed<45000)return null;
          // Conservative 14-minute window (provider documents at least 15 minutes).
          const ambiguous=['sending','uncertain'].includes(j.status);
          if(ambiguous&&Date.now()-new Date(j.idempotency_started_at).getTime()>=14*60000){
            await c.query("update payment_email_outbox set status='uncertain',last_error=$2 where id=$1",[jobId,'Delivery uncertain. Check Brevo transactional logs before any resend; automatic resend is blocked to prevent duplicates.']);return null;
          }
          await c.query(`update payment_email_outbox set status='sending',attempt_started_at=now(),idempotency_started_at=${ambiguous?'idempotency_started_at':'now()'},attempts=attempts+1,last_error=null where id=$1`,[jobId]);
          return j;
        });
        if(!job)continue;
        try{
          const result=await this.email.send(job.payload,job.id);
          await this.pool.query("update payment_email_outbox set status='sent',sent_at=now(),provider_message_id=$2,last_error=null where id=$1",[job.id,result.messageId]);
        }catch(error){
          await this.pool.query('update payment_email_outbox set status=$2,last_error=$3 where id=$1',[job.id,error.uncertain?'uncertain':'failed',error.message==='Save complete tournament bank details, then retry the approval email.'?error.message:'Email not sent. Check email configuration and provider logs, then retry.']);
          console.warn('Payment email attempt failed',{payment_id:paymentId,kind,outcome:error.uncertain?'uncertain':'failed'});
        }
      }
      const pending=(await this.pool.query("select count(*)::integer as n from payment_email_outbox where payment_id=$1 and kind=$2 and status<>'sent'",[paymentId,kind])).rows[0].n;
      if(pending)return {ok:true,warning:kind==='approval'?'Registration approved, but confirmation email could not be sent to every player. Check Details and retry.':'Payment received, but confirmation email failed or is still sending. Check Details and retry.'};
      if(jobs.length)await this.pool.query(`update registration_payments set ${kind==='approval'?'approval_email_sent_at':'payment_email_sent_at'}=coalesce(${kind==='approval'?'approval_email_sent_at':'payment_email_sent_at'},now()) where id=$1`,[paymentId]);
      return {ok:true};
    }catch(error){
      console.warn('Payment email preparation failed',{payment_id:paymentId,kind,code:error.code||'EMAIL_SETUP',reason:error instanceof HttpError?error.message:'Email preparation unavailable'});
      return {ok:true,warning:kind==='approval'?'Registration approved, but confirmation email could not be sent. Check bank details and email setup, then retry.':'Payment received, but confirmation email failed. Check email setup, then retry.'};
    }
  }
  async stats(tournamentId){
    id(tournamentId,'tournament');
    const rows=(await this.pool.query(`select p.payment_status,p.payment_amount from registration_payments p where p.tournament_id=$1
      and exists(select 1 from registrations r where r.entry_id=p.entry_id and r.status='confirmed')`,[tournamentId])).rows;
    const stats={pending:0,paid:0,expected:0,received:0,outstanding:0};
    for(const p of rows){const cents=Math.round(Number(p.payment_amount)*100);if(p.payment_status==='pending'){stats.pending++;stats.outstanding+=cents;}if(p.payment_status==='paid'){stats.paid++;stats.received+=cents;}if(p.payment_status!=='not_required')stats.expected+=cents;}
    for(const k of ['expected','received','outstanding'])stats[k]/=100;
    return {stats};
  }
}
