import type { AuthContext } from '@service/auth/better-auth';
import { Appuser } from '../database/entity/Appuser';
import { Tenant } from '../database/entity/Tenant';
import type { Enqueue } from '@service/queue/enqueue';

// type MySession = Express.Session & SessionContainerInterface;

declare global {
  namespace Express {
    interface User extends Appuser {}
    interface Request {
      authUser?: AuthContext;
      user?: User;
      tenant?: Tenant;
      enqueue?: Enqueue;
    }
    // interface Session extends SessionContainerInterface {}
    // interface Request {
    //   // session?: SessionContainerInterface;
    //   session?: MySession;
    // }
    // interface SessionRequest extends Request {
    //   session?: SessionContainerInterface;
    // }
  }
}

// declare module 'express-session' {
//   interface SessionData extends SessionContainerInterface {}
// }

// declare module 'express-serve-static-core' {
//   interface Session extends SessionContainerInterface {}
// }
