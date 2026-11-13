import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Which SimpleFIN URLs the API is willing to call.
 *
 * A setup token is user input: base64 of a URL the API then POSTs to, and the access URL that
 * comes back is called on every sync. Without a guard, a crafted token would make the API (and
 * the worker) send requests anywhere it can reach, internal services included. So every URL is
 * checked before every request:
 *  - `https:` only, on the default port;
 *  - the host is on the allowlist: the SimpleFIN Bridge hosts by default, or exactly the hosts the
 *    operator lists in `SIMPLEFIN_BRIDGE_HOSTS` (comma-separated) for another SimpleFIN server;
 *  - the host is not an IP literal, and every address it resolves to is public (no loopback,
 *    private, link-local, CGNAT, multicast or documentation range, in IPv4 or IPv6).
 *
 * Requests never follow redirects (`redirect: 'manual'` in the client), so a checked URL cannot
 * bounce the request elsewhere. Nothing here puts a URL, its credentials or the token in an error.
 */

/** The SimpleFIN Bridge's production and beta hosts. */
export const DEFAULT_SIMPLEFIN_BRIDGE_HOSTS = ['bridge.simplefin.org', 'beta-bridge.simplefin.org'] as const;

export type HostResolver = (hostname: string) => Promise<string[]>;

export type SimplefinUrlRefusal = 'bad_token' | 'credentials_in_claim_url' | 'host_not_allowed' | 'missing_credentials' | 'not_https' | 'private_address' | 'unresolvable';

/** A URL the guard refused. The message is fixed per reason and never repeats the URL. */
export class SimplefinUrlRefusedError extends Error {
  constructor(readonly reason: SimplefinUrlRefusal) {
    super(REFUSAL_MESSAGES[reason]);
    this.name = 'SimplefinUrlRefusedError';
  }
}

const REFUSAL_MESSAGES: Record<SimplefinUrlRefusal, string> = {
  bad_token: 'The setup token is not a SimpleFIN setup token',
  credentials_in_claim_url: 'The setup token is not a SimpleFIN setup token',
  host_not_allowed: 'The setup token points to a server this instance does not allow',
  missing_credentials: 'The SimpleFIN server returned an unexpected access URL',
  not_https: 'The setup token must point to an https address',
  private_address: 'The setup token points to a server this instance does not allow',
  unresolvable: 'The SimpleFIN server could not be found',
};

const BLOCKED = buildBlockList();

/** The operator's allowlist, lower-cased; the Bridge hosts when `SIMPLEFIN_BRIDGE_HOSTS` is unset or empty. */
export function allowedSimplefinHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env['SIMPLEFIN_BRIDGE_HOSTS'] ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
  return configured.length > 0 ? configured : [...DEFAULT_SIMPLEFIN_BRIDGE_HOSTS];
}

/**
 * The claim URL a setup token holds. The token is base64 (standard or URL-safe, padding
 * optional) of an https URL; anything else is `bad_token`.
 */
export function decodeSetupToken(token: string): URL {
  const compact = token.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length > 4096 || !/^[\w+/-]+={0,2}$/.test(compact)) throw new SimplefinUrlRefusedError('bad_token');
  const decoded = Buffer.from(compact.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').trim();
  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    throw new SimplefinUrlRefusedError('bad_token');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SimplefinUrlRefusedError('bad_token');
  if (url.username || url.password) throw new SimplefinUrlRefusedError('credentials_in_claim_url');
  return url;
}

/** The address list a host resolves to, through the system resolver. */
export const systemResolver: HostResolver = async (hostname) => (await lookup(hostname, { all: true, order: 'verbatim' })).map((entry) => entry.address);

/**
 * Checks a URL against the rules above, resolving its host. `requireCredentials` is for an
 * access URL, which must carry its Basic-auth user and password.
 */
export async function assertSimplefinUrlAllowed(url: URL, options: { env?: NodeJS.ProcessEnv; requireCredentials?: boolean; resolver?: HostResolver } = {}): Promise<void> {
  if (url.protocol !== 'https:') throw new SimplefinUrlRefusedError('not_https');
  if (url.port !== '' && url.port !== '443') throw new SimplefinUrlRefusedError('host_not_allowed');
  if (options.requireCredentials && (!url.username || !url.password)) throw new SimplefinUrlRefusedError('missing_credentials');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare) !== 0) throw new SimplefinUrlRefusedError(isPublicAddress(bare) ? 'host_not_allowed' : 'private_address');
  if (!allowedSimplefinHosts(options.env).includes(hostname)) throw new SimplefinUrlRefusedError('host_not_allowed');

  let addresses: string[];
  try {
    addresses = await (options.resolver ?? systemResolver)(hostname);
  } catch {
    throw new SimplefinUrlRefusedError('unresolvable');
  }
  if (addresses.length === 0) throw new SimplefinUrlRefusedError('unresolvable');
  if (!addresses.every(isPublicAddress)) throw new SimplefinUrlRefusedError('private_address');
}

/** True for a routable public unicast address; false for anything internal, reserved or malformed. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, 'ipv4');
  if (family !== 6) return false;
  const lower = address.toLowerCase();
  // An IPv4-mapped or NAT64 address reaches the embedded IPv4 one.
  const embedded = /^(?:::ffff:|64:ff9b::)(?<v4>\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower)?.groups?.['v4'];
  if (embedded) return isPublicAddress(embedded);
  return !BLOCKED.check(lower, 'ipv6');
}

function buildBlockList(): BlockList {
  const list = new BlockList();
  for (const [network, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ] as const) list.addSubnet(network, prefix, 'ipv4');
  for (const [network, prefix] of [
    // No `::ffff:0:0/96` rule: Node matches IPv4 addresses against IPv4-mapped IPv6 rules, so it
    // would block every IPv4 address. A mapped address is checked against the IPv4 rules instead.
    ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
    ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
  ] as const) list.addSubnet(network, prefix, 'ipv6');
  return list;
}
