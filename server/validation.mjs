export class HttpError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
export function check(condition,message,status=400){if(!condition)throw new HttpError(status,message);}
export function text(value,label,max=100,optional=false){
  check(typeof value==='string'||(optional&&value==null),`${label} is required`);
  const result=(value||'').trim();
  check((optional||result.length>0)&&result.length<=max,`${label} must be ${optional?'at most':'between 1 and'} ${max} characters`);
  check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result),`${label} contains invalid characters`);
  return result;
}
export function id(value,label='ID') {const result=text(value,label,100);check(/^[a-zA-Z0-9_-]+$/.test(result),`Invalid ${label}`);return result;}
export function uuid(value,label='Request ID'){const result=text(value,label,36);check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result),`Invalid ${label}`);return result;}
export function bool(value,label){check(typeof value==='boolean',`${label} must be on or off`);return value;}
export function integer(value,label,min=1,max=1000){check(Number.isInteger(value)&&value>=min&&value<=max,`${label} must be between ${min} and ${max}`);return value;}
export function date(value,label){
  if(value===null||value==='')return null;
  check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value),`Invalid ${label}`);
  const parsed=new Date(`${value}T12:00:00Z`);check(!Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value,`Invalid ${label}`);return value;
}
export function player(value,label){
  check(value&&typeof value==='object',`${label} details are required`);
  const result={name:text(value.name,`${label} name`),email:text(value.email,`${label} email`,160).toLowerCase(),phone:text(value.phone,`${label} phone`,40)};
  check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email),`Enter a valid ${label.toLowerCase()} email`);
  check(/^[+()\d\s.-]{5,40}$/.test(result.phone)&&result.phone.replace(/\D/g,'').length>=5,`Enter a valid ${label.toLowerCase()} phone`);
  return result;
}
export function registrationInput(body){
  const out={tournamentId:id(body.tournamentId,'tournament'),eventId:id(body.eventId,'event'),requestKey:uuid(body.requestKey),needsPartner:bool(body.needsPartner,'Partner choice'),player1:player(body.player1,'Player 1'),teamName:text(body.teamName,'Team name',80,true)};
  if(body.player2!=null)out.player2=player(body.player2,'Player 2');
  check(body.consent===true,'Please agree to the use of contact details for your tournament entry');
  check(!out.player2||out.player1.email!==out.player2.email,'Players must have separate email addresses');
  return out;
}
export function fee(value){
  const v=value??'0.00';check((typeof v==='string'||typeof v==='number')&&/^\d{1,6}(\.\d{1,2})?$/.test(String(v)),'Entry fee must be a GBP amount with up to two decimal places');
  return Number(v).toFixed(2);
}
export function catalogueInput(body){
  check(body&&Array.isArray(body.events)&&body.events.length<=50,'Include up to 50 events');
  const out={id:id(body.id,'tournament'),name:text(body.name,'Tournament name',160),date:date(body.date,'tournament date'),venue:text(body.venue,'Venue',200,true),revision:integer(body.revision,'Revision',0,2147483646),events:[]};
  const ids=new Set();
  for(const e of body.events){
    const settings=e.registration;check(settings&&typeof settings==='object','Registration settings are required');
    const entryFee=fee(settings.entryFee),paymentRequired=settings.paymentRequired===undefined?false:bool(settings.paymentRequired,'Payment required');
    check(!paymentRequired||Number(entryFee)>0,'Set a positive entry fee when payment is required');
    const eventId=id(e.id,'event');check(!ids.has(eventId),'Duplicate event');ids.add(eventId);
    check(['singles','doubles'].includes(e.type),'Invalid event type');
    check(['roundrobin','groups2','groups4','knockout'].includes(e.format),'Invalid tournament format');
    out.events.push({id:eventId,name:text(e.name,'Event name',160),type:e.type,format:e.format,
      entryFee,paymentRequired,capacity:integer(settings.capacity,'Capacity'),enabled:bool(settings.enabled,'Registration'),closeDate:date(settings.closeDate,'closing date'),allowPartnerNeeded:bool(settings.allowPartnerNeeded,'Partner matching'),autoWaitlist:bool(settings.autoWaitlist,'Automatic waitlist')});
  }
  return out;
}
