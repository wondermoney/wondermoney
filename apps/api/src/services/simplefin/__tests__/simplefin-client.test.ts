import { describe, expect, it } from 'vitest';

import { ConsentExpiredError, RateLimitedError, UnavailableError, UserActionRequiredError } from '@service/bank-providers/errors';

import { claimSetupToken, fetchAccountSet, SimplefinAccessRevokedError, SimplefinClaimError } from '../simplefin-client';
import { SimplefinUrlRefusedError } from '../simplefin-url-guard';

import { ACCESS_PASSWORD, ACCESS_URL, accountSetV1, CLAIM_ID, CLAIM_URL, fakeSimplefinServer, publicResolver, SETUP_TOKEN } from './fixtures';

const secretsIn = (value: unknown) => {
  const text = value instanceof Error ? `${value.name} ${value.message} ${String(value.stack)}` : JSON.stringify(value);
  return [ACCESS_PASSWORD, ACCESS_URL, SETUP_TOKEN, CLAIM_ID].filter((secret) => text.includes(secret));
};

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('claimSetupToken', () => {
  it('POSTs once to the claim URL, without following redirects, and returns the access URL', async () => {
    const server = fakeSimplefinServer();

    const accessUrl = await claimSetupToken(SETUP_TOKEN, { fetch: server.fetch, resolver: publicResolver });

    expect(accessUrl).toBe(ACCESS_URL);
    expect(server.calls).toEqual([{ authorization: null, method: 'POST', url: CLAIM_URL }]);
    expect(server.fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('says an already-claimed token was used, without repeating it', async () => {
    const server = fakeSimplefinServer({ claimStatus: 403 });

    const error = await caught(claimSetupToken(SETUP_TOKEN, { fetch: server.fetch, resolver: publicResolver }));

    expect(error).toBeInstanceOf(SimplefinClaimError);
    expect((error as SimplefinClaimError).reason).toBe('already_claimed');
    expect(secretsIn(error)).toEqual([]);
  });

  it('refuses a bad or disallowed token before any request', async () => {
    const server = fakeSimplefinServer();
    for (const bad of ['not a token', Buffer.from('https://10.0.0.1/claim/X').toString('base64'), Buffer.from('https://attacker.example.test/claim/X').toString('base64')]) {
      await expect(claimSetupToken(bad, { fetch: server.fetch, resolver: publicResolver })).rejects.toBeInstanceOf(SimplefinUrlRefusedError);
    }
    expect(server.calls).toEqual([]);
  });

  it.each([
    ['an http access URL', 'http://u:p@beta-bridge.simplefin.org/simplefin'],
    ['an access URL on another host', 'https://u:p@attacker.example.test/simplefin'],
    ['an access URL pointing inside', 'https://u:p@127.0.0.1/simplefin'],
    ['an access URL without credentials', 'https://beta-bridge.simplefin.org/simplefin'],
    ['a body that is not a URL', '<html>oops</html>'],
  ])('refuses %s from the claim', async (_label, body) => {
    const server = fakeSimplefinServer({ claimBody: body });

    const error = await caught(claimSetupToken(SETUP_TOKEN, { fetch: server.fetch, resolver: publicResolver }));

    expect(error).toBeInstanceOf(SimplefinClaimError);
    expect((error as Error).message).not.toContain(body);
  });

  it('treats a redirect as a refusal instead of following it', async () => {
    const server = fakeSimplefinServer({ claimStatus: 302 });
    await expect(claimSetupToken(SETUP_TOKEN, { fetch: server.fetch, resolver: publicResolver })).rejects.toMatchObject({ reason: 'refused' });
  });

  it('reports SimpleFIN as unreachable when the request fails', async () => {
    const fetch = (() => Promise.reject(new TypeError(`fetch failed for ${CLAIM_URL}`))) as typeof globalThis.fetch;
    const error = await caught(claimSetupToken(SETUP_TOKEN, { fetch, resolver: publicResolver }));
    expect(error).toMatchObject({ reason: 'unavailable' });
    expect(secretsIn(error)).toEqual([]);
  });
});

describe('fetchAccountSet', () => {
  it('asks for the window with pending rows, authenticating with Basic auth and no credentials in the URL', async () => {
    const server = fakeSimplefinServer();

    const set = await fetchAccountSet(ACCESS_URL, { startDate: 1_760_000_000 }, { fetch: server.fetch, resolver: publicResolver });

    expect(set.accounts.map((account) => account.id)).toEqual(['ACT-CHECKING-1', 'ACT-CARD-1']);
    expect(server.calls).toHaveLength(1);
    const [call] = server.calls;
    expect(call?.url).toBe('https://beta-bridge.simplefin.org/simplefin/accounts?start-date=1760000000&pending=1');
    expect(call?.url).not.toContain(ACCESS_PASSWORD);
    expect(call?.authorization).toBe(`Basic ${Buffer.from(`fixture-user:${ACCESS_PASSWORD}`).toString('base64')}`);
  });

  it.each([
    [403, SimplefinAccessRevokedError],
    [402, UserActionRequiredError],
    [429, RateLimitedError],
    [500, UnavailableError],
    [503, UnavailableError],
  ])('maps HTTP %i to a typed provider error that carries no secret', async (status, type) => {
    const server = fakeSimplefinServer({ accountsStatus: status });

    const error = await caught(fetchAccountSet(ACCESS_URL, {}, { fetch: server.fetch, resolver: publicResolver }));

    expect(error).toBeInstanceOf(type);
    expect(secretsIn(error)).toEqual([]);
  });

  it('reads a revoked access as an ended consent', async () => {
    const server = fakeSimplefinServer({ accountsStatus: 403 });
    await expect(fetchAccountSet(ACCESS_URL, {}, { fetch: server.fetch, resolver: publicResolver })).rejects.toBeInstanceOf(ConsentExpiredError);
  });

  it('refuses an unreadable response as unavailable', async () => {
    const server = fakeSimplefinServer({ accounts: () => ({ accounts: 'nope' }) });
    await expect(fetchAccountSet(ACCESS_URL, {}, { fetch: server.fetch, resolver: publicResolver })).rejects.toBeInstanceOf(UnavailableError);
  });

  it('re-checks the stored access URL against the allowlist before every request', async () => {
    const server = fakeSimplefinServer();
    const error = await caught(fetchAccountSet(ACCESS_URL, {}, { env: { SIMPLEFIN_BRIDGE_HOSTS: 'other.example.test' }, fetch: server.fetch, resolver: publicResolver }));
    expect(error).toBeInstanceOf(UserActionRequiredError);
    expect(server.calls).toEqual([]);
  });

  it('accepts the version-1 shape the fixtures record', () => {
    expect(accountSetV1().accounts).toHaveLength(2);
  });
});
