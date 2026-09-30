// Test/local adapter only; production uses Netlify Database's real pg.Pool.
export function createPGlitePool(db){
  let tail=Promise.resolve();
  async function connect(){
    let release;const previous=tail;tail=new Promise(resolve=>{release=resolve;});await previous;
    return {query:(sql,args)=>db.query(sql,args),release};
  }
  return {connect,query:async(sql,args)=>{const c=await connect();try{return await c.query(sql,args);}finally{c.release();}}};
}
