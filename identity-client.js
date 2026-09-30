import {getUser,login,logout,handleAuthCallback,acceptInvite,updateUser,requestPasswordRecovery,onAuthChange} from '@netlify/identity';
window.DropshotIdentity={getUser,login,logout,acceptInvite,updateUser,requestPasswordRecovery,onAuthChange};
window.DropshotIdentityReady=(async()=>{
  try{return await handleAuthCallback();}catch(error){return {error:error.message};}
})();
