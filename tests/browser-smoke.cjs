// Run after npm run build and npx playwright install chromium.
const {spawn}=require('node:child_process');const path=require('node:path');const fs=require('node:fs');const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),port=8899,url=`http://127.0.0.1:${port}`;
async function main(){
  const server=spawn(process.execPath,['scripts/dev-server.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let browser;const errors=[];
  try{
    await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Local test server did not start')),20000);server.stdout.on('data',chunk=>{output+=chunk;if(output.includes('LOCAL DEMO ONLY')){clearTimeout(timer);resolve();}});server.stderr.on('data',chunk=>process.stderr.write(chunk));server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited ${code}`));});});
    browser=await chromium.launch({headless:true,...(process.env.DROPSHOT_BROWSER_CHANNEL?{channel:process.env.DROPSHOT_BROWSER_CHANNEL}:{})});
    const adminContext=await browser.newContext(),playerContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const admin=await adminContext.newPage(),player=await playerContext.newPage();
    for(const page of [admin,player])page.on('pageerror',error=>errors.push(error.message));
    await admin.goto(`${url}/__dev/organizer`);
    await admin.locator('[data-route="registrations"]').first().click();
    await admin.locator('#regTournamentFilter').selectOption('local-demo-tournament');
    await admin.getByText('LOCAL-DEMO-ONLY',{exact:true}).waitFor();
    // Fresh local draft with old tournament date: publish via the actual organizer UI.
    await admin.evaluate(()=>{const s=state;const t=structuredClone(s.tournaments.find(t=>t.id==='local-demo-tournament'));t.id='t_browser_publish';t.name='Publish Flow Test';t.date='2020-01-01';t.status='draft';delete t.registrationRevision;t.events=[t.events[0]];t.events[0].id='e_browser_publish';t.events[0].registration={enabled:false,capacity:3,closeDate:'',allowPartnerNeeded:false,autoWaitlist:true};s.tournaments.push(t);s.activeTournamentId=t.id;s.activeEventId=t.events[0].id;s.route='registrations';save();});
    await admin.getByText('LOCAL-DEMO-ONLY',{exact:true}).waitFor();
    await admin.locator('[data-reg-enabled="e_browser_publish"]').check();
    const publishResponse=admin.waitForResponse(r=>r.url().endsWith('/api/admin/catalogue')&&r.request().method()==='POST');
    await admin.locator('[data-action="publish-registration"]').click();assert.equal((await publishResponse).status(),200);
    await admin.getByText('Published database catalogue · open',{exact:true}).waitFor();
    const share=await admin.getByRole('link',{name:'Open page ↗'}).getAttribute('href');assert.equal(share,`${url}/register?tournament=t_browser_publish`);
    for(const route of [share,`${url}/register.html?t=t_browser_publish`]){await player.goto(route);await player.locator('[data-event="e_browser_publish"]').waitFor();assert.equal(await player.locator('#submitBtn').isEnabled(),true);await player.locator('#p1Name').fill('Publish Reader');}
    await admin.locator('#regTournamentFilter').selectOption('local-demo-tournament');
    await player.goto(`${url}/register?tournament=local-demo-tournament`);
    await player.locator('[data-event="local-singles"]').click();
    await player.locator('#p1Name').fill('Browser Player');await player.locator('#p1Email').fill('browser.player@example.test');await player.locator('#p1Phone').fill('07123456789');await player.locator('#privacy').check();
    await player.locator('#submitBtn').click();await player.getByText('Registration submitted 🏸',{exact:true}).waitFor();await player.getByText('Pending organizer approval',{exact:true}).waitFor();
    assert.equal(await player.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile registration has horizontal overflow');
    await admin.locator('[data-action="refresh-registrations"]').click();
    const row=admin.getByRole('row').filter({has:admin.getByText('Browser Player',{exact:true})});await row.getByRole('button',{name:'Approve / Confirm',exact:true}).click();await row.getByText('Confirmed',{exact:true}).waitFor();
    await admin.locator('[data-route="entries"]').first().click();await admin.locator('[data-event="local-singles"]').click();await admin.getByRole('cell',{name:'Browser Player',exact:true}).first().waitFor();
    const roster=await admin.evaluate(()=>JSON.parse(localStorage.getItem('dropshot-folks-v1')).tournaments.find(t=>t.id==='local-demo-tournament').events.find(e=>e.id==='local-singles').entries);
    assert.equal(roster.length,1);assert.equal(roster[0].source,'registration');assert.ok(!JSON.stringify(roster).includes('@'));
    await admin.locator('[data-action="public-view"]').first().click();assert.ok(!(await admin.locator('body').innerText()).includes('browser.player@example.test'));
    const anonymous=await playerContext.request.get(`${url}/api/admin/registrations?tournament=local-demo-tournament`);assert.equal(anonymous.status(),401);
    await player.locator('#another').click();await player.locator('[data-event="local-doubles"]').click();await player.locator('[name="partnerChoice"][value="need"]').check();
    assert.equal(await player.locator('#p2Name').isDisabled(),true);
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await player.screenshot({path:path.join(root,'test-results/registration-mobile.png'),fullPage:true});
    await admin.locator('[data-action="admin-view"]').click();await admin.locator('[data-route="registrations"]').first().click();await admin.screenshot({path:path.join(root,'test-results/registration-admin.png'),fullPage:true});
    // Configure a paid event and private bank settings through the actual UI.
    await admin.locator('[data-reg-fee="local-doubles"]').fill('20.00');await admin.locator('[data-reg-payment="local-doubles"]').selectOption('yes');
    let saved=admin.waitForResponse(r=>r.url().endsWith('/api/admin/catalogue')&&r.request().method()==='POST');await admin.locator('[data-action="publish-registration"]').click();assert.equal((await saved).status(),200);
    await admin.locator('[data-action="refresh-registrations"]').click();await admin.waitForFunction(()=>!remoteRegistrationLoading&&!registrationBusy);await admin.locator('#bank_bank_account_name').fill('Dropshot Folks');await admin.locator('#bank_bank_name').fill('Demo Bank');await admin.locator('#bank_sort_code').fill('12-34-56');await admin.locator('#bank_account_number').fill('12345678');
    saved=admin.waitForResponse(r=>r.url().endsWith('/api/admin/payment-settings')&&r.request().method()==='POST');await admin.getByRole('button',{name:'Save bank details',exact:true}).click();assert.equal((await saved).status(),200);
    const bank=(await (await adminContext.request.get(`${url}/api/admin/payment-settings?tournament=local-demo-tournament`)).json()).settings;assert.equal(bank.bank_account_name,'Dropshot Folks');assert.equal(bank.account_number,'12345678');assert.equal(bank.sort_code,'123456');
    await player.locator('[name="partnerChoice"][value="with"]').check();
    for(const [n,name] of [[1,'Payment One'],[2,'Payment Two']]){await player.locator(`#p${n}Name`).fill(name);await player.locator(`#p${n}Email`).fill(`payment${n}@example.test`);await player.locator(`#p${n}Phone`).fill('07123456789');}
    await player.locator('#privacy').check();await player.locator('#submitBtn').click();await player.getByText('Registration submitted 🏸',{exact:true}).waitFor();assert.ok(!(await player.locator('body').innerText()).includes('12345678'));
    await admin.locator('[data-action="refresh-registrations"]').click();const paidRow=admin.getByRole('row').filter({has:admin.getByText('Payment One / Payment Two',{exact:true})});await paidRow.getByRole('button',{name:'Approve / Confirm',exact:true}).click();await paidRow.getByText('Payment pending',{exact:true}).waitFor();await paidRow.getByRole('button',{name:'Details',exact:true}).click();await admin.getByText('sent ·',{exact:false}).first().waitFor();await admin.locator('.modal-head [data-action="close-modal"]').click();
    admin.once('dialog',dialog=>dialog.accept());await paidRow.getByRole('button',{name:'Mark payment received',exact:true}).click();await paidRow.getByText('Paid',{exact:true}).waitFor();await admin.screenshot({path:path.join(root,'test-results/registration-payments-admin.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log('Browser flow passed: publish → anonymous registration → approval → Entries; private bank settings → team payment → paid receipt.');
  }finally{if(browser)await browser.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

