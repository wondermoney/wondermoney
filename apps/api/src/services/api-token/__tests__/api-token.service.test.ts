import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { ApiToken } from '@entity/ApiToken';
import { AppuserTenant } from '@entity/AppuserTenant';
import {
  API_TOKEN_PREFIX,
  apiTokenDisplayPrefix,
  authenticateApiToken,
  createApiToken,
  generateApiToken,
  hashApiToken,
} from '@service/api-token/api-token.service';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

const db = useTestDatabase();

describe('personal API tokens', () => {
  beforeEach(() => {
    DI.em = db.em();
  });

  it('creates a wm_pat_ token and stores only its prefix and SHA-256 hash', async () => {
    const household = await seedHousehold(db.em());
    const { apiToken, token } = await createApiToken({
      appuser: household.appuser,
      expiresInDays: 30,
      name: 'Home dashboard',
      scopes: ['read'],
      tenant: household.tenant,
    });

    expect(token).toMatch(/^wm_pat_[0-9A-Za-z]{43}$/);
    expect(apiToken.prefix).toBe(apiTokenDisplayPrefix(token));
    expect(apiToken.prefix).toHaveLength(API_TOKEN_PREFIX.length + 8);
    expect(apiToken.secretHash).toBe(hashApiToken(token));
    expect(apiToken.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(apiToken.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });

  it('never persists the plain token', async () => {
    const household = await seedHousehold(db.em());
    const { token } = await createApiToken({
      appuser: household.appuser,
      expiresInDays: 90,
      name: 'Spreadsheet',
      scopes: ['read', 'write'],
      tenant: household.tenant,
    });

    const rows = await db.em().getConnection().execute<Record<string, unknown>[]>('select * from api_token');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(JSON.stringify(rows)).not.toContain(token.slice(API_TOKEN_PREFIX.length));
  });

  it('resolves the token to its user and household and records last use', async () => {
    const household = await seedHousehold(db.em());
    const { apiToken, token } = await createApiToken({
      appuser: household.appuser,
      expiresInDays: 30,
      name: 'Script',
      scopes: ['read'],
      tenant: household.tenant,
    });

    const authenticated = await authenticateApiToken(token, { ip: '203.0.113.10' }, db.em());

    expect(authenticated?.apiToken.apiTokenKey).toBe(apiToken.apiTokenKey);
    expect(authenticated?.appuser.appuserKey).toBe(household.appuser.appuserKey);
    expect(authenticated?.tenant.tenantKey).toBe(household.tenant.tenantKey);

    const stored = await db.em().findOne(ApiToken, { apiTokenKey: apiToken.apiTokenKey });
    expect(stored?.lastUsedAt).toBeInstanceOf(Date);
    expect(stored?.lastUsedIp).toBe('203.0.113.10');
  });

  it('writes lastUsedAt at most once a minute', async () => {
    const household = await seedHousehold(db.em());
    const { apiToken, token } = await createApiToken({
      appuser: household.appuser,
      expiresInDays: 30,
      name: 'Poller',
      scopes: ['read'],
      tenant: household.tenant,
    });
    const first = new Date('2026-01-01T00:00:00Z');

    await authenticateApiToken(token, { now: first }, db.em());
    const stored = await db.em().findOne(ApiToken, { apiTokenKey: apiToken.apiTokenKey });
    const firstUsedAt = stored?.lastUsedAt?.getTime();

    await authenticateApiToken(token, { now: new Date(first.getTime() + 30_000) }, db.em());
    const afterThirtySeconds = await db.em().findOne(ApiToken, { apiTokenKey: apiToken.apiTokenKey });
    expect(afterThirtySeconds?.lastUsedAt?.getTime()).toBe(firstUsedAt);

    await authenticateApiToken(token, { now: new Date(first.getTime() + 61_000) }, db.em());
    const afterAMinute = await db.em().findOne(ApiToken, { apiTokenKey: apiToken.apiTokenKey });
    expect(afterAMinute?.lastUsedAt?.getTime()).toBe(first.getTime() + 61_000);
  });

  it('rejects an expired token', async () => {
    const household = await seedHousehold(db.em());
    const { token } = await createApiToken({
      appuser: household.appuser,
      expiresInDays: 30,
      name: 'Expired',
      scopes: ['read'],
      tenant: household.tenant,
    });

    const authenticated = await authenticateApiToken(
      token,
      { now: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000) },
      db.em(),
    );

    expect(authenticated).toBeNull();
  });

  it('rejects a revoked token immediately', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { apiToken, token } = await createApiToken({
      appuser: household.appuser,
      expiresInDays: 30,
      name: 'Revoked',
      scopes: ['read'],
      tenant: household.tenant,
    }, em);

    apiToken.revokedAt = new Date();
    await em.flush();

    await expect(authenticateApiToken(token, {}, db.em())).resolves.toBeNull();
  });

  it('rejects unknown and malformed tokens', async () => {
    await expect(authenticateApiToken('wm_pat_not-a-real-token', {}, db.em())).resolves.toBeNull();
    await expect(authenticateApiToken('sk_live_123', {}, db.em())).resolves.toBeNull();
  });

  it('stops working when the member leaves the household', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { token } = await createApiToken({
      appuser: household.appuser,
      expiresInDays: 30,
      name: 'Former member',
      scopes: ['read'],
      tenant: household.tenant,
    }, em);

    const membership = await em.findOneOrFail(AppuserTenant, { appuserKey: household.appuser, tenantKey: household.tenant });
    membership.recordActive = false;
    await em.flush();

    await expect(authenticateApiToken(token, {}, db.em())).resolves.toBeNull();
  });

  it('keeps the token bound to the household it was created in', async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    const { token } = await createApiToken({
      appuser: partner,
      expiresInDays: 30,
      name: 'Partner script',
      scopes: ['read'],
      tenant: household.tenant,
    });

    const authenticated = await authenticateApiToken(token, {}, db.em());
    expect(authenticated?.tenant.tenantKey).toBe(household.tenant.tenantKey);
  });

  it('generates distinct tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateApiToken()));
    expect(tokens.size).toBe(50);
  });
});
