import type { EntityManager } from '@mikro-orm/postgresql';
import { RequestContext } from '@mikro-orm/postgresql';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { DI } from '@app/database/di';
import type { Account } from '@entity/Account';
import { ApiToken } from '@entity/ApiToken';
import { type Appuser, SupportedLanguages } from '@entity/Appuser';
import { RecurringSeries } from '@entity/RecurringSeries';
import { requireCalendarFeedToken } from '@middleware/calendar-feed';
import { errorHandler } from '@middleware/error-handler';
import accountRoutes from '@route/account';
import calendarRoutes from '@route/calendar';
import userRoutes from '@route/user';
import {
  CALENDAR_FEED_TOKEN_EXPIRY_DAYS,
  CALENDAR_FEED_TOKEN_SCOPE,
  createApiToken,
  hashApiToken,
} from '@service/api-token/api-token.service';
import {
  RecurringAmountType,
  RecurringCadence,
  RecurringSeriesStatus,
  RecurringSeriesType,
} from '@service/recurring/recurring-types';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () =>
  (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession(),
);

const db = useTestDatabase();
useRequestContextEm(db);

const userHttp = tenantHttp('/v1/user', userRoutes);
const accountHttp = tenantHttp('/v1/account', accountRoutes);

/** The calendar mount as `app.ts` wires it: no session, no bearer, the token travels in the query. */
function calendarApp() {
  const app = express();
  app.use((_req, _res, next) => {
    if (!DI.orm) throw new Error('Test database is not started');
    RequestContext.create(DI.orm.em, next);
  });
  app.use('/v1/calendar', requireCalendarFeedToken, calendarRoutes);
  app.use(errorHandler);
  return app;
}

const feed = (token: string, extra = '') =>
  request(calendarApp()).get(`/v1/calendar/bills.ics?token=${encodeURIComponent(token)}${extra}`);

function icsLines(body: string): string[] {
  return body.split('\r\n');
}

function uids(body: string): string[] {
  return icsLines(body)
    .filter((line) => line.startsWith('UID:'))
    .map((line) => line.slice('UID:'.length));
}

/** A UTC midnight `days` from today, so a seeded series falls inside the feed's 90-day window. */
function utcDayOffset(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}
describe('GET /v1/calendar/bills.ics', () => {
  let em: EntityManager;
  let household: Household;
  let partner: Appuser;

  beforeEach(async () => {
    em = db.em();
    household = await seedHousehold(em);
    partner = await addPartner(em, household);
  });

  async function calendarTokenFor(appuser: Appuser = household.appuser): Promise<string> {
    const { token } = await createApiToken(
      {
        appuser,
        expiresInDays: CALENDAR_FEED_TOKEN_EXPIRY_DAYS,
        name: 'Calendar feed',
        scopes: [CALENDAR_FEED_TOKEN_SCOPE],
        tenant: household.tenant,
      },
      em,
    );
    return token;
  }

  async function addSeries(input: {
    account?: Account;
    amount?: number;
    displayName: string;
    nextExpectedAt?: Date;
    status?: RecurringSeriesStatus;
    type?: RecurringSeriesType;
  }): Promise<RecurringSeries> {
    const series = em.create(RecurringSeries, {
      accountKey: input.account ?? household.account,
      amountType: RecurringAmountType.fixed,
      cadence: RecurringCadence.monthly,
      currencyKey: household.currency,
      displayName: input.displayName,
      expectedAmount: input.amount ?? 45,
      nextExpectedAt: input.nextExpectedAt ?? utcDayOffset(10),
      normalizedMerchantKey: input.displayName.toLowerCase(),
      status: input.status ?? RecurringSeriesStatus.confirmed,
      tenantKey: household.tenant,
      type: input.type ?? RecurringSeriesType.bill,
    }, { partial: true });
    await em.flush();
    return series;
  }

  it('returns 404 for an unknown token', async () => {
    const response = await feed('wm_pat_unknownunknownunknownunknownunknownunknownunknown');

    expect(response.status).toBe(404);
  });

  it('returns 404 when no token is given', async () => {
    const response = await request(calendarApp()).get('/v1/calendar/bills.ics');

    expect(response.status).toBe(404);
  });

  it('returns 404 once the token is revoked', async () => {
    const token = await calendarTokenFor();
    await em.nativeUpdate(ApiToken, { secretHash: hashApiToken(token) }, { revokedAt: new Date() });

    expect((await feed(token)).status).toBe(404);
  });

  it('returns 404 once the token has expired', async () => {
    const token = await calendarTokenFor();
    await em.nativeUpdate(ApiToken, { secretHash: hashApiToken(token) }, { expiresAt: new Date(Date.now() - 1_000) });

    expect((await feed(token)).status).toBe(404);
  });

  it('returns 404 for a read/write personal token that is not a calendar token', async () => {
    const { token } = await createApiToken(
      { appuser: household.appuser, expiresInDays: 90, name: 'Script', scopes: ['read', 'write'], tenant: household.tenant },
      em,
    );

    expect((await feed(token)).status).toBe(404);
  });

  it('does not turn a calendar token into a general read token on the bearer routes', async () => {
    const token = await calendarTokenFor();

    const response = await accountHttp.asToken(token).get('/v1/account');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('api_token_scope_required');
  });

  it('serves an all-day event per occurrence, with a stable UID and a 12-hour refresh hint', async () => {
    await addSeries({ amount: 45, displayName: 'Electricity' });
    const token = await calendarTokenFor();

    const response = await feed(token);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/calendar/);
    expect(response.text).toContain('BEGIN:VCALENDAR');
    expect(response.text).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT12H');
    expect(response.text).toContain('DTSTART;VALUE=DATE:');
    expect(response.text).toContain('DTEND;VALUE=DATE:');
    expect(response.text).toContain('SUMMARY:Electricity - €45.00');
    expect(response.text).not.toMatch(/[^\r]\n/);

    const first = uids(response.text);
    expect(first.length).toBeGreaterThan(0);
    expect(new Set(first).size).toBe(first.length);
    for (const uid of first) expect(uid).toMatch(/^wm-bill-\d+-\d{8}@wonder\.money$/);

    const again = await feed(token);
    expect(uids(again.text)).toEqual(first);
  });

  it('holds bills only: no balance, account name or account number', async () => {
    const account = await addAccount(em, household, { balance: 987_654.32, name: 'Secret savings' });
    account.accountNumber = 'PT50000201231234567890154';
    await em.flush();
    await addSeries({ account, amount: 45, displayName: 'Electricity' });
    const token = await calendarTokenFor();

    const response = await feed(token);

    expect(response.status).toBe(200);
    expect(response.text).toContain('Electricity');
    expect(response.text).not.toContain('987654');
    expect(response.text).not.toContain('987,654');
    expect(response.text).not.toContain('Secret savings');
    expect(response.text).not.toContain('PT50000201231234567890154');
  });

  it('shows a member only the bills they can see', async () => {
    const privateAccount = await addAccount(em, household, { isPrivate: true, name: 'Partner private', owner: partner });
    await addSeries({ displayName: 'Shared rent' });
    await addSeries({ account: privateAccount, displayName: 'Partner private gym' });

    const ownerToken = await calendarTokenFor();
    const partnerToken = await calendarTokenFor(partner);

    const ownerFeed = await feed(ownerToken);
    expect(ownerFeed.text).toContain('Shared rent');
    expect(ownerFeed.text).not.toContain('Partner private gym');

    const partnerFeed = await feed(partnerToken);
    expect(partnerFeed.text).toContain('Shared rent');
    expect(partnerFeed.text).toContain('Partner private gym');
  });

  it('omits unconfirmed series', async () => {
    await addSeries({ displayName: 'Confirmed rent' });
    await addSeries({ displayName: 'Unconfirmed gym', status: RecurringSeriesStatus.candidate });
    const token = await calendarTokenFor();

    const response = await feed(token);

    expect(response.text).toContain('Confirmed rent');
    expect(response.text).not.toContain('Unconfirmed gym');
  });

  it('localizes the amount for the requested locale', async () => {
    await addSeries({ amount: 1234.56, displayName: 'Rent' });
    const token = await calendarTokenFor();

    const english = await feed(token, '&locale=en');
    const portuguese = await feed(token, '&locale=pt');
    const spanish = await feed(token, '&locale=es');

    expect(english.text).toContain('Rent - €1\\,234.56');
    expect(portuguese.text).toContain('Rent - 1234\\,56');
    expect(spanish.text).toContain('Rent - 1234\\,56');
  });

  it('writes in the account language when the calendar app sends no locale', async () => {
    await addSeries({ amount: 1234.56, displayName: 'Rent' });
    em.assign(household.appuser, { language: SupportedLanguages.ES });
    await em.flush();
    const token = await calendarTokenFor();

    const events = async (extra = '') => icsLines((await feed(token, extra)).text).filter((line) => !line.startsWith('DTSTAMP:'));

    expect(await events()).toEqual(await events('&locale=es'));
    expect(await events()).not.toEqual(await events('&locale=en'));
  });
});

describe('calendar feed token management', () => {
  let em: EntityManager;
  let household: Household;

  beforeEach(async () => {
    em = db.em();
    household = await seedHousehold(em);
  });

  it('creates a link once, rotates it, and revoking it stops the feed', async () => {
    const session = userHttp.as(household.appuser);

    const created = await session.post('/v1/user/calendar-feed-token').send({});
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^wm_pat_[0-9A-Za-z]{43}$/);
    expect(created.body.calendarFeedToken.scopes).toEqual([CALENDAR_FEED_TOKEN_SCOPE]);

    const first = created.body.token as string;
    expect((await feed(first)).status).toBe(200);

    const listed = await session.get('/v1/user/calendar-feed-token');
    expect(listed.status).toBe(200);
    expect(listed.body.calendarFeedToken).toMatchObject({ prefix: created.body.calendarFeedToken.prefix });
    expect(listed.body.token).toBeUndefined();

    const rotated = await session.post('/v1/user/calendar-feed-token').send({});
    expect(rotated.status).toBe(201);
    const second = rotated.body.token as string;
    expect(second).not.toBe(first);

    expect((await feed(first)).status).toBe(404);
    expect((await feed(second)).status).toBe(200);

    const revoked = await session.delete('/v1/user/calendar-feed-token');
    expect(revoked.status).toBe(204);
    expect((await feed(second)).status).toBe(404);

    const afterRevoke = await session.get('/v1/user/calendar-feed-token');
    expect(afterRevoke.body.calendarFeedToken).toBeNull();
  });

  it('does not let a personal token manage the calendar link', async () => {
    const { token } = await createApiToken(
      { appuser: household.appuser, expiresInDays: 90, name: 'Script', scopes: ['read', 'write'], tenant: household.tenant },
      em,
    );

    const response = await userHttp.asToken(token).post('/v1/user/calendar-feed-token').send({});

    expect(response.status).toBe(403);
  });
});
