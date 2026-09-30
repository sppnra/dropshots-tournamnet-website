const fs=require('node:fs');const path=require('node:path');const esbuild=require('esbuild');
const root=path.join(__dirname,'..'),out=path.join(root,'dist');
async function main(){
  fs.mkdirSync(out,{recursive:true});
  for(const name of ['index.html','register.html','app.js','register.js','registration-admin.js','api.js','config.js','styles.css','scoring-core.js','team-cup-ui.js','team-cup-admin.html','team-cup-admin.js','team-cup-register.html','team-cup-register.js','team-cup.html','team-cup-live.js','referee.html','referee.js'])fs.copyFileSync(path.join(root,name),path.join(out,name));
  await esbuild.build({entryPoints:[path.join(root,'identity-client.js')],bundle:true,platform:'browser',format:'iife',target:'es2020',outfile:path.join(out,'identity.js'),minify:true});
  console.log('Built frontend in dist/. Netlify Functions and database migrations deploy from netlify/.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
