// Copies only repository sources into a fresh directory, then uses npm to install,
// test and build. No existing node_modules or dist are reused.
const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const target=path.join(root,'.verification',`clean-${Date.now()}`);
fs.mkdirSync(target,{recursive:true});
const files=['index.html','register.html','app.js','register.js','registration-admin.js','api.js','config.js','identity-client.js','styles.css','package.json','package-lock.json','pnpm-lock.yaml','pnpm-workspace.yaml','netlify.toml','.gitignore','.env.example','README.md','ARCHITECTURE.md'];
for(const file of files)if(fs.existsSync(path.join(root,file)))fs.copyFileSync(path.join(root,file),path.join(target,file));
for(const dir of ['scripts','netlify','server','tests'])fs.cpSync(path.join(root,dir),path.join(target,dir),{recursive:true});
const npmCli=process.argv[2];
if(!npmCli){console.error('Usage: node scripts/verify-clean.cjs /absolute/path/to/npm-cli.js');process.exit(1);}
const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,NODE_ENV:'development'};
for(const args of [['install','--no-audit','--no-fund','--cache',path.join(root,'.verification/npm-cache')],['test'],['run','build']]){
  const result=spawnSync(process.execPath,[npmCli,...args],{cwd:target,env,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
}
console.log(`Clean npm install, tests and production build passed: ${target}`);
