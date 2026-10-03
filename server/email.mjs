// Provider adapter. No SDK or browser credentials; replace send() to change provider.
export class EmailError extends Error {
  constructor(message,uncertain=false,details={}){super(message);this.uncertain=uncertain;Object.assign(this,details);}
}
export const emailConfiguration=(env=process.env)=>({api_key_exists:!!env.EMAIL_API_KEY,sender:env.EMAIL_FROM||null,provider:'Brevo HTTPS API'});
// Provider responses may echo input: redact secrets, long account-number-like values and truncate.
export function safeEmailReason(error,env=process.env){
  let message=error?.message||'Email preparation unavailable';
  if(env.EMAIL_API_KEY)message=message.split(env.EMAIL_API_KEY).join('[redacted]');
  return message.replace(/\b\d{6,}\b/g,'[redacted]').replace(/\b\d{2}[- ]\d{2}[- ]\d{2}\b/g,'[redacted]').slice(0,400);
}
export function logEmailFailure(error,context){console.warn('Payment email failed',{...emailConfiguration(),...context,provider_http_status:error.httpStatus||null,provider_error:safeEmailReason(error)});}
export function createEmailService({env=process.env,fetchImpl=fetch}={}){
  return {configuration:()=>emailConfiguration(env),async diagnose(){
    if(!env.EMAIL_API_KEY)return {...emailConfiguration(env),reason:'Email provider API key is missing.'};
    if(!env.EMAIL_FROM)return {...emailConfiguration(env),reason:'EMAIL_FROM is missing.'};
    try{const response=await fetchImpl('https://api.brevo.com/v3/senders',{headers:{'api-key':env.EMAIL_API_KEY},signal:AbortSignal.timeout(6000)});const result=await response.json();
      if(!response.ok)return {...emailConfiguration(env),http_status:response.status,reason:response.status===401?'Brevo API key is invalid or disabled.':'Brevo sender inspection failed; check provider logs.'};
      const sender=result.senders?.find(s=>s.email?.toLowerCase()===env.EMAIL_FROM.toLowerCase());return {...emailConfiguration(env),sender_verified:sender?.active===true,reason:sender?.active?'Sender is active. Check transactional logs for delivery/bounces.':'Sender email is absent or has not been verified.'};
    }catch{return {...emailConfiguration(env),reason:'Could not reach Brevo to check sender verification.'};}
  },async send(message,key){
    if(!env.EMAIL_API_KEY)throw new EmailError('Email provider API key is missing. Configure EMAIL_API_KEY in Netlify Functions.');
    if(!env.EMAIL_FROM)throw new EmailError('Sender address is missing. Configure EMAIL_FROM in Netlify Functions.');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_FROM))throw new EmailError('EMAIL_FROM must be a verified sender email address.');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.to?.email||''))throw new EmailError('Recipient email address is invalid. Correct the player/captain email before retrying.');
    if(env.EMAIL_REPLY_TO&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_REPLY_TO))throw new EmailError('EMAIL_REPLY_TO is not a valid email address.');
    const payload={sender:{name:'Dropshot Folks',email:env.EMAIL_FROM},to:[message.to],subject:message.subject,
      htmlContent:message.html,textContent:message.text,headers:{idempotencyKey:key},
      ...(env.EMAIL_REPLY_TO?{replyTo:{email:env.EMAIL_REPLY_TO}}:{})};
    let response;
    try{response=await fetchImpl('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':env.EMAIL_API_KEY,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(6000)});}
    catch{throw new EmailError('Email delivery outcome is unknown. Retry promptly or check Brevo transactional logs.',true);}
    let result;try{result=await response.json();}catch{throw new EmailError(`Brevo returned an unreadable response (HTTP ${response.status}). ${response.ok||response.status>=500?'Delivery outcome is unknown;':'Request rejected;'} check Brevo transactional logs.`,response.ok||response.status>=500,{httpStatus:response.status});}
    if(response.ok)return {messageId:result.messageId||'accepted'};
    if(result.code==='duplicate_parameter')return {messageId:'accepted-on-earlier-attempt'};
    // A 5xx may arrive after acceptance. Do not blindly resend outside the dedupe window.
    const provider=safeEmailReason({message:String(result.message||result.code||'Request rejected')},env);
    throw new EmailError(response.status>=500?`Email delivery outcome is unknown (HTTP ${response.status}). Check Brevo transactional logs.`:`Brevo rejected the email (HTTP ${response.status}): ${provider}`,response.status>=500,{httpStatus:response.status,providerCode:result.code});
  }};
}
