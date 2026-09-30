import {getUser} from '@netlify/identity';
import {getPool} from '../../server/db.mjs';
import {RegistrationService} from '../../server/registration-service.mjs';
import {createApiHandler} from '../../server/api-handler.mjs';
export default createApiHandler({service:()=>new RegistrationService(getPool()),getUser});
export const config={path:'/api/*',rateLimit:{windowLimit:1200,windowSize:60,aggregateBy:['ip','domain']}};
