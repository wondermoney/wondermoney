import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, currencyFor, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { FX_RECONVERT_QUEUE } from '@app/jobs/fx-reconvert.queue';
import type { Appuser } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { ExchangeRateOverride } from '@entity/ExchangeRateOverride';
import { ExchangeRateOverrideAuditAction, ExchangeRateOverrideAuditLog } from '@entity/ExchangeRateOverrideAuditLog';
import currencyRoutes from '@route/currency';
import type { Enqueue } from '@service/queue/enqueue';

/*
 * A household's exchange-rate overrides: any member lists, adds, changes and deletes them; no other
 * household sees or touches them. Every change is audited with the member who made it and queues
 * the re-conversion of that household's amounts in the pair.
 */
describe('exchange-rate overrides', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const sent: { data: unknown; options: unknown; queue: string }[] = [];
  const enqueue = {
    send: (queue: string, data: unknown, options: unknown) => {
      sent.push({ data, options, queue });
      return Promise.resolve('job-id');
    },
    sendAfter: () => Promise.resolve('job-id'),
  } as unknown as Enqueue;
  const http = tenantHttp('/v1/currency', currencyRoutes, { enqueue });

  interface OverrideDto { date: string; fromCurrency: string; id: number; rate: number; toCurrency: string }

  async function households() {
    sent.length = 0;
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const neighbour = await seedHousehold(em);
    for (const code of ['USD', 'XOF']) {
      const currency = await currencyFor(em, code);
      currency.isActive = true;
    }
    const eur = await em.findOneOrFail(Currency, { code: 'EUR' });
    eur.isActive = true;
    await em.flush();
    return { neighbour: neighbour.appuser, owner, partner };
  }

  async function create(user: Appuser, body: Record<string, unknown> = { date: '2026-03-02', fromCurrency: 'XOF', rate: 0.00152, toCurrency: 'EUR' }): Promise<OverrideDto> {
    const response = await http.as(user).post('/v1/currency/rates').send(body);
    expect(response.status).toBe(201);
    return response.body.override as OverrideDto;
  }

  const list = async (user: Appuser) => (await http.as(user).get('/v1/currency/rates')).body.overrides as OverrideDto[];

  it('lists an override to both members of the household and to no other household', async () => {
    const { neighbour, owner, partner } = await households();
    await create(owner.appuser);

    expect(await list(partner)).toEqual([expect.objectContaining({ date: '2026-03-02', fromCurrency: 'XOF', rate: 0.00152, toCurrency: 'EUR' })]);
    expect(await list(neighbour)).toEqual([]);
  });

  it('names each member their own currency, the one their amounts are converted to', async () => {
    const em = db.em();
    const owner = await seedHousehold(em);
    const usd = await currencyFor(em, 'USD');
    const partner = await addPartner(em, owner, { currency: usd });

    expect((await http.as(owner.appuser).get('/v1/currency/rates')).body.currency).toBe(owner.currency.code);
    expect((await http.as(partner).get('/v1/currency/rates')).body.currency).toBe('USD');
  });

  it('lets the partner change and delete it, and nobody next door', async () => {
    const { neighbour, owner, partner } = await households();
    const override = await create(owner.appuser);

    const theirUpdate = await http.as(neighbour).patch(`/v1/currency/rates/${override.id}`).send({ rate: 1 });
    const theirDelete = await http.as(neighbour).delete(`/v1/currency/rates/${override.id}`);
    expect(theirUpdate.status).toBe(404);
    expect(theirDelete.status).toBe(404);
    expect(await db.em().findOneOrFail(ExchangeRateOverride, { exchangeRateOverrideKey: override.id }, { filters: false })).toMatchObject({ deletedAt: null, rate: 0.00152 });

    const update = await http.as(partner).patch(`/v1/currency/rates/${override.id}`).send({ date: '2026-03-03', rate: 0.0016 });
    expect(update.status).toBe(200);
    expect(update.body.override).toMatchObject({ date: '2026-03-03', rate: 0.0016 });

    const remove = await http.as(partner).delete(`/v1/currency/rates/${override.id}`);
    expect(remove.status).toBe(204);
    expect(await list(owner.appuser)).toEqual([]);
  });

  it('allows one override per pair and day in a household, and the same one next door', async () => {
    const { neighbour, owner, partner } = await households();
    await create(owner.appuser);

    const again = await http.as(partner).post('/v1/currency/rates').send({ date: '2026-03-02', fromCurrency: 'XOF', rate: 0.002, toCurrency: 'EUR' });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'exchange_rate_override_exists' });
    expect((await create(neighbour)).fromCurrency).toBe('XOF');
  });

  it('frees the day once the override is deleted', async () => {
    const { owner } = await households();
    const override = await create(owner.appuser);
    await http.as(owner.appuser).delete(`/v1/currency/rates/${override.id}`);

    const again = await create(owner.appuser);
    expect(again.id).not.toBe(override.id);
  });

  it('refuses a rate that is not a positive number, one currency twice, an unknown currency and a future day', async () => {
    const { owner } = await households();
    const valid = { date: '2026-03-02', fromCurrency: 'XOF', rate: 0.00152, toCurrency: 'EUR' };
    const tomorrowPlusOne = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    const statuses: number[] = [];
    for (const body of [
      { ...valid, rate: 0 },
      { ...valid, rate: -1 },
      { ...valid, rate: 'abc' },
      { ...valid, toCurrency: 'XOF' },
      { ...valid, fromCurrency: 'ZZZ' },
      { ...valid, date: '2026-02-30' },
      { ...valid, date: tomorrowPlusOne },
    ]) {
      statuses.push((await http.as(owner.appuser).post('/v1/currency/rates').send(body)).status);
    }
    expect(statuses).toEqual(statuses.map(() => 400));
    expect(await list(owner.appuser)).toEqual([]);
  });

  it('audits every change with the member who made it', async () => {
    const { owner, partner } = await households();
    const override = await create(owner.appuser);
    await http.as(partner).patch(`/v1/currency/rates/${override.id}`).send({ rate: 0.0016 });
    await http.as(partner).delete(`/v1/currency/rates/${override.id}`);

    const audits = await db.em().find(ExchangeRateOverrideAuditLog, { exchangeRateOverrideKey: { exchangeRateOverrideKey: override.id } }, { filters: false, orderBy: { exchangeRateOverrideAuditLogKey: 'asc' } });
    expect(audits.map((audit) => [audit.action, audit.actorAppuserKey?.appuserKey])).toEqual([
      [ExchangeRateOverrideAuditAction.CREATED, owner.appuser.appuserKey],
      [ExchangeRateOverrideAuditAction.UPDATED, partner.appuserKey],
      [ExchangeRateOverrideAuditAction.DELETED, partner.appuserKey],
    ]);
    expect(audits[1]?.changes).toEqual({ rate: { from: 0.00152, to: 0.0016 } });
    expect(audits.every((audit) => audit.tenantKey.tenantKey === owner.tenant.tenantKey)).toBe(true);
  });

  it('queues the re-conversion of the household pair on every change', async () => {
    const { owner } = await households();
    const override = await create(owner.appuser);
    await http.as(owner.appuser).patch(`/v1/currency/rates/${override.id}`).send({ rate: 0.0016 });
    await http.as(owner.appuser).delete(`/v1/currency/rates/${override.id}`);

    const pair = { fromCurrency: 'XOF', tenantKey: owner.tenant.tenantKey, toCurrency: 'EUR' };
    expect(sent).toHaveLength(3);
    for (const job of sent) expect(job).toMatchObject({ data: { override: pair }, queue: FX_RECONVERT_QUEUE });
  });
});
