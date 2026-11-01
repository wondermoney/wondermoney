import { isIP } from 'node:net';

/**
 * Which proxies in front of the API are allowed to tell it the client's address.
 *
 * Express reads `X-Forwarded-For` only from hops it trusts; everything to the left of the
 * last untrusted hop is whatever the client chose to send. Every per-IP rate limit, and
 * better-auth's sign-in limiter, keys on the address this produces, so trusting a hop that
 * isn't there lets a client pick a fresh bucket per request by rotating the header.
 *
 * - `false`: no proxy. The client address is the TCP peer. The default, because it is the
 *   only value that is safe when the API port is published directly.
 * - a number: that many proxies, each appending to `X-Forwarded-For`. One reverse proxy
 *   (Traefik, Caddy, nginx) is `1`; Cloudflare in front of it is `2`.
 * - a list: proxy addresses or CIDR ranges, or Express's named ranges (`loopback`,
 *   `linklocal`, `uniquelocal`). Use it when the proxies' addresses are known and fixed.
 *
 * `true` (trust every hop) is refused: it makes the leftmost, client-written entry the
 * client address.
 */
export type TrustProxySetting = false | number | readonly string[];

const NAMED_RANGES = new Set(['linklocal', 'loopback', 'uniquelocal']);

export class TrustProxyError extends Error {
  constructor(detail: string) {
    super(`TRUST_PROXY ${detail}. Use a hop count (e.g. 1 behind one reverse proxy), false, or a comma-separated list of proxy addresses or CIDR ranges.`);
    this.name = 'TrustProxyError';
  }
}

function isAddressOrRange(entry: string): boolean {
  if (NAMED_RANGES.has(entry)) return true;
  const slash = entry.indexOf('/');
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const family = isIP(address);
  if (family === 0) return false;
  if (slash === -1) return true;
  const prefix = entry.slice(slash + 1);
  if (!/^\d{1,3}$/u.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/** Parse the `TRUST_PROXY` environment value. Throws `TrustProxyError` on anything it can't use safely. */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (value === '' || value.toLowerCase() === 'false' || value === '0') return false;
  if (value.toLowerCase() === 'true') {
    throw new TrustProxyError('cannot be true: that trusts an X-Forwarded-For the client wrote itself');
  }
  if (/^\d+$/u.test(value)) return Number(value);

  const entries = value.split(',').map((entry) => entry.trim());
  const invalid = entries.filter((entry) => !isAddressOrRange(entry));
  if (invalid.length > 0) {
    throw new TrustProxyError(`has entries that are not a hop count, IP address or CIDR range: ${invalid.map((entry) => JSON.stringify(entry)).join(', ')}`);
  }
  return entries;
}
