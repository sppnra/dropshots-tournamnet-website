async function registrationApi(path,options={}){
  const base=window.DROPSHOT_CONFIG?.apiBase||'/api';
  let response;
  try{
    response=await fetch(`${base}/${path}`,{method:options.method||'GET',credentials:'same-origin',cache:'no-store',
      headers:options.body?{'Content-Type':'application/json'}:{},body:options.body?JSON.stringify(options.body):undefined,signal:AbortSignal.timeout(20000)});
  }catch{throw new Error('Could not connect. Check your internet connection and try again.');}
  if(response.status===429)throw new Error('Too many requests. Please wait a minute and try again.');
  let result;
  try{result=await response.json();}catch{throw new Error('The registration API is not deployed yet. Deploy this project with its Netlify Functions.');}
  if(!response.ok){const error=new Error(result.error||'Request failed');error.status=response.status;throw error;}
  return result;
}
