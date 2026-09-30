const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function appContext(config={},search=''){
  const storage=new Map(),messages=[];
  const element={textContent:'',classList:{add(){},remove(){}},innerHTML:''};
  const ctx=vm.createContext({
    window:{DROPSHOT_CONFIG:config},document:{querySelector:()=>element,querySelectorAll:()=>[],visibilityState:'visible'},
    location:{origin:'https://example.test',pathname:'/',search},URLSearchParams,Date,Math,JSON,Map,Set,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    console,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},confirm:()=>true
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../registration-admin.js'),'utf8'),ctx);
  let source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  source=source.replace(/\nrender\(\);\s*initRegistration\(\);\s*$/,'');
  vm.runInContext(source,ctx);
  ctx.messages=messages;
  vm.runInContext('render=()=>{};toast=msg=>messages.push(msg);',ctx);
  return {ctx,storage,run:code=>vm.runInContext(code,ctx),plain:code=>JSON.parse(vm.runInContext(`JSON.stringify(${code})`,ctx)),messages};
}
module.exports={appContext};
