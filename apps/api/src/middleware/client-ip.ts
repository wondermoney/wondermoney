import type { Express, NextFunction, Request, Response } from 'express';

import type { TrustProxySetting } from '@config/trust-proxy';

/**
 * One client address for every rate limiter.
 *
 * The API's own limiters (express-rate-limit) key on `req.ip`, which Express derives from the
 * `trust proxy` setting. better-auth's sign-in limiter runs inside its handler and reads the
 * address from request headers instead; left at its default it looks for a single-entry
 * `X-Forwarded-For`, finds none behind a proxy chain or with no proxy at all, and puts every
 * user in one shared bucket per path — so one client hammering sign-in locks everyone out.
 *
 * So the API resolves the address once, the Express way, and hands it to better-auth in a
 * header of its own. The header is overwritten on every request, so a value the client sent
 * never survives, and better-auth is told to read that header only.
 */
const CLIENT_IP_HEADER = 'x-wondermoney-client-ip';

/**
 * better-auth `advanced.ipAddress`. The /56 IPv6 grouping matches express-rate-limit's
 * `ipKeyGenerator` default, so both limiters treat one IPv6 customer allocation as one client.
 */
export const BETTER_AUTH_IP_ADDRESS_OPTIONS = {
  ipAddressHeaders: [CLIENT_IP_HEADER],
  ipv6Subnet: 56,
};

function stampClientIp(req: Request, _res: Response, next: NextFunction): void {
  if (req.ip) req.headers[CLIENT_IP_HEADER] = req.ip;
  else Reflect.deleteProperty(req.headers, CLIENT_IP_HEADER);
  next();
}

/** Apply the trust setting and stamp the resolved address. Call before any limiter or auth handler. */
export function configureClientIp(app: Express, trustProxy: TrustProxySetting): void {
  app.set('trust proxy', Array.isArray(trustProxy) ? [...trustProxy] : trustProxy);
  app.use(stampClientIp);
}
