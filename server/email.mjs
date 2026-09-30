// Provider adapter. No SDK or browser credentials; replace send() to change provider.
export class EmailError extends Error {
  constructor(message,uncertain=false){super(message);this.uncertain=uncertain;}
}
export function createEmailService({env=process.env,fetchImpl=fetch}={}){
  return {async send(message,key){
    if(!env.EMAIL_API_KEY||!env.EMAIL_FROM)throw new EmailError('Configure EMAIL_API_KEY and EMAIL_FROM in Netlify.');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_FROM))throw new EmailError('EMAIL_FROM must be a verified sender email address.');
    const payload={sender:{name:'Dropshot Folks',email:env.EMAIL_FROM},to:[message.to],subject:message.subject,
      htmlContent:message.html,textContent:message.text,headers:{idempotencyKey:key},
      ...(env.EMAIL_REPLY_TO?{replyTo:{email:env.EMAIL_REPLY_TO}}:{})};
    let response;
    try{response=await fetchImpl('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':env.EMAIL_API_KEY,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(6000)});}
    catch{throw new EmailError('Email delivery outcome is unknown. Retry promptly or check Brevo transactional logs.',true);}
    let result;try{result=await response.json();}catch{throw new EmailError('Email delivery outcome is unknown. Check Brevo transactional logs.',true);}
    if(response.ok)return {messageId:result.messageId||'accepted'};
    if(result.code==='duplicate_parameter')return {messageId:'accepted-on-earlier-attempt'};
    // A 5xx may arrive after acceptance. Do not blindly resend outside the dedupe window.
    throw new EmailError(response.status>=500?'Email delivery outcome is unknown. Check Brevo transactional logs.':`Email provider rejected the request (HTTP ${response.status}). Check sender verification, API key and daily quota.`,response.status>=500);
  }};
}
