import { getDatabase } from '@netlify/database';
let database;
export function getPool(){database||=getDatabase();return database.pool;}
export async function transaction(pool,fn){
  const client=await pool.connect();
  try{await client.query('begin');const result=await fn(client);await client.query('commit');return result;}
  catch(error){await client.query('rollback');throw error;}
  finally{client.release();}
}
