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
    await player.goto(`${url}/register?tournament=local-demo-tournament`);
    await player.locator('[data-event="local-singles"]').click();
    await player.locator('#p1Name').fill('Browser Player');await player.locator('#p1Email').fill('browser.player@example.test');await player.locator('#p1Phone').fill('07123456789');await player.locator('#privacy').check();
    await player.locator('#submitBtn').click();await player.getByText('You’re registered 🏸',{exact:true}).waitFor();await player.getByText('Pending confirmation',{exact:true}).waitFor();
    assert.equal(await player.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile registration has horizontal overflow');
    await admin.locator('[data-action="refresh-registrations"]').click();
    const row=admin.getByRole('row').filter({has:admin.getByText('Browser Player',{exact:true})});await row.getByRole('button',{name:'Confirm',exact:true}).click();await row.getByText('Confirmed',{exact:true}).waitFor();
    await admin.locator('[data-route="entries"]').first().click();await admin.locator('[data-event="local-singles"]').click();await admin.getByRole('cell',{name:'Browser Player',exact:true}).first().waitFor();
    const roster=await admin.evaluate(()=>JSON.parse(localStorage.getItem('dropshot-folks-v1')).tournaments.find(t=>t.id==='local-demo-tournament').events.find(e=>e.id==='local-singles').entries);
    assert.equal(roster.length,1);assert.equal(roster[0].source,'registration');assert.ok(!JSON.stringify(roster).includes('@'));
    await admin.locator('[data-action="public-view"]').first().click();assert.ok(!(await admin.locator('body').innerText()).includes('browser.player@example.test'));
    const anonymous=await playerContext.request.get(`${url}/api/admin/registrations?tournament=local-demo-tournament`);assert.equal(anonymous.status(),401);
    await player.locator('#another').click();await player.locator('[data-event="local-doubles"]').click();await player.locator('[name="partnerChoice"][value="need"]').check();
    assert.equal(await player.locator('#p2Name').isDisabled(),true);
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await player.screenshot({path:path.join(root,'test-results/registration-mobile.png'),fullPage:true});
    await admin.locator('[data-action="admin-view"]').click();await admin.locator('[data-route="registrations"]').first().click();await admin.screenshot({path:path.join(root,'test-results/registration-admin.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log('Browser flow passed: mobile registration → central save → admin confirmation → local Entries → public privacy.');
  }finally{if(browser)await browser.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
