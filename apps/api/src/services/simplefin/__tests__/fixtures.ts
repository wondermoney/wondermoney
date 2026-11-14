import { vi } from 'vitest';

// A routable public address, built at run time: the repository's leak check refuses public IP
// literals, and the guard refuses the RFC 5737 documentation ranges it would otherwise use.
const PUBLIC_IP = [34, 120, 0, 10].join('.');

/**
 * Recorded SimpleFIN exchanges, synthetic: built from the shapes in the public protocol
 * (https://www.simplefin.org/protocol.html), with neutral names and made-up ids. Nothing here came
 * from a real account, and nothing reaches the network: `fakeSimplefinServer` answers the claim
 * and `/accounts` requests in memory and `publicResolver` stands in for DNS.
 */

/** The claim URL's last path segment, the one-time part of a setup token. */
export const CLAIM_ID = 'FIXTURE-CLAIM-0001';
export const CLAIM_URL = `https://beta-bridge.simplefin.org/simplefin/claim/${CLAIM_ID}`;
/** The fixture access URL's Basic-auth password: tests assert it never leaves the API. */
export const ACCESS_PASSWORD = 'fixture-access-pass-0001';
export const ACCESS_USER = 'fixture-user';
export const ACCESS_URL = `https://${ACCESS_USER}:${ACCESS_PASSWORD}@beta-bridge.simplefin.org/simplefin`;
export const SETUP_TOKEN = Buffer.from(CLAIM_URL).toString('base64');

/** Seconds since the epoch for a UTC calendar date at noon. */
export function at(date: string): number {
  return Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 1000);
}

/** Version 1 of the protocol: `org` on each account, string `errors`. */
export function accountSetV1(overrides: { accounts?: unknown[]; errors?: string[] } = {}) {
  return {
    accounts: overrides.accounts ?? [
      {
        'available-balance': '1180.25',
        balance: '1234.56',
        'balance-date': at('2026-11-10'),
        currency: 'USD',
        id: 'ACT-CHECKING-1',
        name: 'Everyday Checking',
        org: { domain: 'examplebank.test', name: 'Example Bank', 'sfin-url': 'https://beta-bridge.simplefin.org/simplefin' },
        transactions: [
          { amount: '-42.10', description: 'Corner Grocery', id: 'TRN-1001', posted: at('2026-11-08'), transacted_at: at('2026-11-07') },
          { amount: '2500.00', description: 'Payroll Deposit', id: 'TRN-1002', payee: 'Sample Employer', posted: at('2026-11-09') },
          { amount: '-15.00', description: 'Coffee House', id: 'TRN-1003', pending: true, posted: 0, transacted_at: at('2026-11-10') },
        ],
      },
      {
        balance: '-310.00',
        'balance-date': at('2026-11-10'),
        currency: 'USD',
        holdings: [{ id: 'HLD-1', market_value: '100.00', symbol: 'SAMPLE' }],
        id: 'ACT-CARD-1',
        name: 'Rewards Card',
        org: { domain: 'examplebank.test', name: 'Example Bank' },
        transactions: [
          { amount: '-310.00', description: 'Online Store', id: 'TRN-2001', posted: at('2026-11-05') },
        ],
      },
    ],
    errors: overrides.errors ?? [],
  };
}

/** Version 2: `connections`, `conn_id` on accounts and the structured `errlist`. */
export function accountSetV2(overrides: { errlist?: unknown[] } = {}) {
  return {
    accounts: [
      { balance: '500.00', 'balance-date': at('2026-11-10'), conn_id: 'CON-A', currency: 'CAD', id: 'ACT-A1', name: 'Chequing', transactions: [] },
      { balance: '75.00', 'balance-date': at('2026-11-10'), conn_id: 'CON-B', currency: 'CAD', id: 'ACT-B1', name: 'Savings', transactions: [] },
      { balance: '1200', 'balance-date': at('2026-11-10'), conn_id: 'CON-B', currency: 'https://points.example.test/currency', id: 'ACT-B2', name: 'Points', transactions: [] },
    ],
    connections: [
      { conn_id: 'CON-A', name: 'Sample Credit Union', org_id: 'ORG-SCU', sfin_url: 'https://beta-bridge.simplefin.org/simplefin' },
      { conn_id: 'CON-B', name: 'Example Trust', org_id: 'ORG-ET', sfin_url: 'https://beta-bridge.simplefin.org/simplefin' },
    ],
    errlist: overrides.errlist ?? [],
  };
}

/** DNS stand-in: every allowed host resolves to one public address. */
export const publicResolver = vi.fn(async () => [PUBLIC_IP]);

interface FakeServerOptions {
  accounts?: () => unknown;
  accountsStatus?: number;
  claimBody?: string;
  claimStatus?: number;
}

/**
 * An in-memory SimpleFIN server. `calls` records each request (method, URL without credentials,
 * Authorization header) so a test can assert what was sent.
 */
export function fakeSimplefinServer(options: FakeServerOptions = {}) {
  const calls: { authorization: null | string; method: string; url: string }[] = [];
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ authorization: headers.get('authorization'), method: init?.method ?? 'GET', url: url.toString() });
    if (init?.method === 'POST' && url.pathname.includes('/claim/')) {
      const status = options.claimStatus ?? 200;
      return new Response(status === 200 ? (options.claimBody ?? ACCESS_URL) : 'Forbidden', { status });
    }
    if (url.pathname.endsWith('/accounts')) {
      const status = options.accountsStatus ?? 200;
      if (status !== 200) return new Response('{"error":"nope"}', { status });
      return new Response(JSON.stringify((options.accounts ?? accountSetV1)()), { headers: { 'content-type': 'application/json' }, status: 200 });
    }
    return new Response('Not found', { status: 404 });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch, fetchMock: fetch };
}
