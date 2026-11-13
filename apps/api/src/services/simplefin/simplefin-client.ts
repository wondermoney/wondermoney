import { z } from 'zod';

import { ConsentExpiredError, RateLimitedError, UnavailableError, UserActionRequiredError } from '@service/bank-providers/errors';

import { assertSimplefinUrlAllowed, decodeSetupToken, type HostResolver, SimplefinUrlRefusedError } from './simplefin-url-guard';

/**
 * The SimpleFIN protocol (https://www.simplefin.org/protocol.html), client side:
 *  - **claim**: a setup token is base64 of a claim URL; one `POST` to it returns the access URL,
 *    which carries HTTP Basic credentials. A token works once: a second claim is a 403.
 *  - **account set**: `GET {access}/accounts?start-date&end-date&pending=1` with those
 *    credentials returns the accounts, their balances and transactions, and an error list.
 *    A 403 means the user revoked the access (or the credentials are wrong); a 402 means the
 *    SimpleFIN server wants payment.
 *
 * Every URL goes through the SSRF guard before the request, and no request follows a redirect.
 * Errors carry fixed, user-safe messages: never the token, the access URL, its credentials or the
 * server's response body.
 */

export interface SimplefinClientDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  resolver?: HostResolver;
  timeoutMs?: number;
}

/** The claim could not produce an access URL. `reason` picks the user-facing message. */
export class SimplefinClaimError extends Error {
  constructor(readonly reason: 'already_claimed' | 'refused' | 'unavailable', message: string) {
    super(message);
    this.name = 'SimplefinClaimError';
  }
}

/** The access URL answered 403: the user disabled the token at the SimpleFIN server. */
export class SimplefinAccessRevokedError extends ConsentExpiredError {
  constructor() {
    super('SimpleFIN access was revoked');
    this.name = 'SimplefinAccessRevokedError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ACCESS_URL_LENGTH = 2048;

const numeric = z.union([z.string(), z.number()]).transform((value) => String(value).trim());
const timestamp = z.union([z.number(), z.string()]).transform((value) => Number(value)).pipe(z.number());

const transactionSchema = z.object({
  amount: numeric,
  description: z.string().optional().default(''),
  id: z.union([z.string(), z.number()]).transform(String),
  memo: z.string().optional(),
  payee: z.string().optional(),
  pending: z.boolean().optional(),
  posted: timestamp.optional().default(0),
  transacted_at: timestamp.optional(),
});

const accountSchema = z.object({
  'available-balance': numeric.optional(),
  balance: numeric,
  'balance-date': timestamp.optional(),
  conn_id: z.string().optional(),
  currency: z.string(),
  /** Investment holdings. Ignored for now; investment sync is issue #22. */
  holdings: z.array(z.unknown()).optional(),
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().optional().default(''),
  org: z.object({ domain: z.string().optional(), id: z.string().optional(), name: z.string().optional() }).optional(),
  transactions: z.array(transactionSchema).optional().default([]),
});

const errorSchema = z.object({
  account_id: z.string().optional(),
  code: z.string(),
  conn_id: z.string().optional(),
  msg: z.string().optional(),
});

const accountSetSchema = z.object({
  accounts: z.array(accountSchema).default([]),
  connections: z.array(z.object({ conn_id: z.string(), name: z.string().optional(), org_id: z.string().optional(), org_url: z.string().optional() })).optional().default([]),
  errlist: z.array(errorSchema).optional().default([]),
  errors: z.array(z.string()).optional().default([]),
});

export type SimplefinAccount = z.infer<typeof accountSchema>;
export type SimplefinAccountSet = z.infer<typeof accountSetSchema>;
export type SimplefinError = z.infer<typeof errorSchema>;
export type SimplefinTransaction = z.infer<typeof transactionSchema>;

/**
 * Claims a setup token. Returns the access URL; the caller encrypts it straight away.
 * Throws `SimplefinUrlRefusedError` for a token the guard refuses and `SimplefinClaimError` when
 * the server would not hand out an access URL.
 */
export async function claimSetupToken(setupToken: string, deps: SimplefinClientDeps = {}): Promise<string> {
  const claimUrl = decodeSetupToken(setupToken);
  await assertSimplefinUrlAllowed(claimUrl, { env: deps.env, resolver: deps.resolver });

  let response: Response;
  try {
    response = await (deps.fetch ?? globalThis.fetch)(claimUrl, {
      headers: { 'Content-Length': '0' },
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new SimplefinClaimError('unavailable', 'SimpleFIN could not be reached. Try again in a moment.');
  }
  if (response.status === 403) {
    throw new SimplefinClaimError('already_claimed', 'This setup token was already used or does not exist. If you did not use it, disable it at your SimpleFIN server, since someone else may have claimed it, and create a new one.');
  }
  if (!response.ok) throw new SimplefinClaimError(response.status >= 500 ? 'unavailable' : 'refused', 'SimpleFIN did not accept this setup token.');

  const body = (await response.text().catch(() => '')).trim();
  let accessUrl: URL;
  try {
    if (body.length === 0 || body.length > MAX_ACCESS_URL_LENGTH) throw new Error('bad access url');
    accessUrl = new URL(body);
  } catch {
    throw new SimplefinClaimError('refused', 'SimpleFIN returned an unexpected response.');
  }
  try {
    await assertSimplefinUrlAllowed(accessUrl, { env: deps.env, requireCredentials: true, resolver: deps.resolver });
  } catch (error) {
    if (error instanceof SimplefinUrlRefusedError) throw new SimplefinClaimError('refused', 'SimpleFIN returned an access address this instance does not allow.');
    throw error;
  }
  return accessUrl.toString();
}

/**
 * `GET /accounts` on an access URL. `startDate`/`endDate` are Unix seconds. Pending
 * transactions are always asked for (`pending=1`); a server without them ignores it.
 * Failures are the bank-provider typed errors, so the sync path can read them.
 */
export async function fetchAccountSet(accessUrl: string, query: { endDate?: number; startDate?: number }, deps: SimplefinClientDeps = {}): Promise<SimplefinAccountSet> {
  let url: URL;
  try {
    url = new URL(accessUrl);
  } catch {
    throw new UserActionRequiredError('The stored SimpleFIN access is unreadable; connect again');
  }
  try {
    await assertSimplefinUrlAllowed(url, { env: deps.env, requireCredentials: true, resolver: deps.resolver });
  } catch (error) {
    if (error instanceof SimplefinUrlRefusedError) {
      throw error.reason === 'unresolvable'
        ? new UnavailableError('SimpleFIN could not be reached')
        : new UserActionRequiredError('This instance no longer allows the SimpleFIN server of this connection');
    }
    throw error;
  }

  const credentials = Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64');
  const endpoint = new URL(`${url.pathname.replace(/\/+$/, '')}/accounts`, url.origin);
  if (query.startDate !== undefined) endpoint.searchParams.set('start-date', String(Math.floor(query.startDate)));
  if (query.endDate !== undefined) endpoint.searchParams.set('end-date', String(Math.floor(query.endDate)));
  endpoint.searchParams.set('pending', '1');

  let response: Response;
  try {
    response = await (deps.fetch ?? globalThis.fetch)(endpoint, {
      headers: { Accept: 'application/json', Authorization: `Basic ${credentials}` },
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new UnavailableError('SimpleFIN could not be reached');
  }
  if (response.status === 403) throw new SimplefinAccessRevokedError();
  if (response.status === 402) throw new UserActionRequiredError('The SimpleFIN server needs payment before it shares data');
  if (response.status === 429) throw new RateLimitedError('SimpleFIN rate limit reached', retryAfterSeconds(response.headers.get('retry-after')));
  if (!response.ok) throw new UnavailableError('SimpleFIN is temporarily unavailable');

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new UnavailableError('SimpleFIN returned an unreadable response');
  }
  const parsed = accountSetSchema.safeParse(json);
  if (!parsed.success) throw new UnavailableError('SimpleFIN returned an unreadable response');
  return parsed.data;
}

function retryAfterSeconds(header: null | string): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}
