import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { handlePushSendJob } from '@app/jobs/push-send.worker';
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { PushDevice, PushDevicePlatform } from '@entity/PushDevice';
import type { Enqueue } from '@service/queue/enqueue';

import { ExpoPushClient } from '../expo-push-client';
import { PushDeviceService } from '../push-device.service';
import { renderPush } from '../push-messages';
import { queuePushNotification } from '../push-notifier';
import { checkPushReceipts, sendPushNotification } from '../push-sender';
import { removePushDevicesForSession } from '../push-session-cleanup';

const NOW = new Date('2026-11-13T09:00:00.000Z');
const LATER = new Date(NOW.getTime() + 60 * 60 * 1000);

/*
 * Sending is where the switches are enforced: the operator's PUSH_ENABLED, the person's category,
 * their devices and the sessions those devices signed in with. Expo is a fake `fetch` here; nothing
 * leaves the process.
 */
describe('push sending', () => {
  // The real migrations, because a device's session lives in better-auth's own table.
  const db = useTestDatabase({ schema: 'migrations' });

  async function session(em: EntityManager, household: Household, expiresAt = LATER): Promise<string> {
    const id = randomUUID();
    await em.getConnection().execute(
      'insert into better_auth."user" ("id", "name", "email", "emailVerified") values (?, ?, ?, false) on conflict do nothing',
      [household.appuser.externalUserId, 'Owner', household.appuser.emailAddress],
    );
    await em.getConnection().execute(
      'insert into better_auth."session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId") values (?, ?, ?, ?, ?, ?)',
      [id, expiresAt, randomUUID(), NOW, NOW, household.appuser.externalUserId],
    );
    return id;
  }

  async function device(em: EntityManager, household: Household, sessionId: string, token = `ExponentPushToken[${randomUUID()}]`): Promise<string> {
    await new PushDeviceService(em).register(household.appuser.appuserKey, sessionId, { platform: PushDevicePlatform.IOS, token }, NOW);
    return token;
  }

  async function optIn(em: EntityManager, household: Household, columns: Partial<EmailNotificationPreference>) {
    em.create(EmailNotificationPreference, { appuserKey: household.appuser, ...columns }, { partial: true });
    await em.flush();
  }

  /** A fake Expo: records every request and answers each message with the ticket `ticketFor` returns. */
  function expo(ticketFor: (message: { to: string }) => unknown = () => ({ id: randomUUID(), status: 'ok' }), receipts: Record<string, unknown> = {}) {
    const requests: { body: unknown; headers: Record<string, string>; url: string }[] = [];
    const fetch = vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push({ body, headers: init.headers as Record<string, string>, url });
      const data = url.endsWith('/getReceipts') ? receipts : (body as { to: string }[]).map(ticketFor);
      return Promise.resolve(new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' }, status: 200 }));
    });
    return { client: new ExpoPushClient({ accessToken: null, fetch: fetch as unknown as typeof globalThis.fetch }), fetch, requests };
  }

  function queue() {
    const later: { at: Date; payload: unknown }[] = [];
    const sent: unknown[] = [];
    const enqueue = {
      send: (_queue: string, payload: unknown) => { sent.push(payload); return Promise.resolve('job'); },
      sendAfter: (_queue: string, payload: unknown, _options: unknown, at: Date) => { later.push({ at, payload }); return Promise.resolve('job'); },
    } as unknown as Enqueue;
    return { enqueue, later, sent };
  }

  const testJob = (household: Household): Job<unknown> => ({ data: { appuserKey: household.appuser.appuserKey, notification: { kind: 'test' }, type: 'send' }, id: 'job-1' }) as Job<unknown>;

  const liveTokens = async (em: EntityManager) => (await em.find(PushDevice, { disabledAt: null }, { orderBy: { pushDeviceKey: 'asc' } })).map((row) => row.token);

  it('sends nothing at all while push is off on the server', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await device(em, household, await session(em, household));
    await optIn(em, household, { pushBudgetAlertsEnabled: true });
    const fake = expo();
    const { enqueue, sent } = queue();

    expect(await queuePushNotification(household.appuser.appuserKey, { kind: 'test' }, { em, enabled: () => false, enqueue })).toBe('disabled');
    expect(await sendPushNotification({ appuserKey: household.appuser.appuserKey, notification: { kind: 'test' } }, { client: fake.client, em, enabled: () => false, enqueue, now: () => NOW }))
      .toEqual({ reason: 'disabled', status: 'skipped' });
    expect(sent).toHaveLength(0);
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it('sends a category only to someone who turned it on, checked again at send time', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await device(em, household, await session(em, household));
    const fake = expo();
    const { enqueue, sent } = queue();
    const notification = { budgets: [{ budgetKey: 1, categoryName: 'Groceries', month: 11, state: 'over' as const, year: 2026 }], kind: 'budget_alert' as const };

    expect(await queuePushNotification(household.appuser.appuserKey, notification, { em, enabled: () => true, enqueue })).toBe('preference_off');
    expect(await sendPushNotification({ appuserKey: household.appuser.appuserKey, notification }, { client: fake.client, em, enabled: () => true, enqueue, now: () => NOW }))
      .toEqual({ reason: 'preference_off', status: 'skipped' });
    expect(sent).toHaveLength(0);
    expect(fake.fetch).not.toHaveBeenCalled();

    await optIn(em, household, { pushBudgetAlertsEnabled: true });
    expect(await queuePushNotification(household.appuser.appuserKey, notification, { em, enabled: () => true, enqueue })).toBe('queued');
    expect(await sendPushNotification({ appuserKey: household.appuser.appuserKey, notification }, { client: fake.client, em, enabled: () => true, enqueue, now: () => NOW }))
      .toMatchObject({ sent: 1, status: 'sent' });
    expect(fake.requests[0]?.body).toEqual([expect.objectContaining({ body: 'Your budget Groceries is over plan.', data: { url: '/budgets/1/2026/11' }, title: 'Budget alert' })]);
  });

  it('sends a test notification to every signed-in phone, in the person’s language, with the access token when one is set', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await em.nativeUpdate(Appuser, { appuserKey: household.appuser.appuserKey }, { language: SupportedLanguages.PT });
    const first = await device(em, household, await session(em, household));
    const second = await device(em, household, await session(em, household));
    const requests: { body: unknown; headers: Record<string, string> }[] = [];
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as unknown[];
      requests.push({ body, headers: init.headers as Record<string, string> });
      return Promise.resolve(new Response(JSON.stringify({ data: body.map(() => ({ id: randomUUID(), status: 'ok' })) }), { status: 200 }));
    });
    const { enqueue, later } = queue();

    const outcome = await handlePushSendJob(testJob(household), {
      client: new ExpoPushClient({ accessToken: 'expo-access-token', fetch: fetch as unknown as typeof globalThis.fetch }),
      em,
      enabled: () => true,
      enqueue,
      logger: { info: () => undefined, warn: () => undefined },
      now: () => NOW,
    });

    expect(outcome).toMatchObject({ sent: 2, status: 'sent' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers['authorization']).toBe('Bearer expo-access-token');
    const message = { body: 'As notificações push estão a funcionar neste telemóvel.', data: { url: '/settings/notifications' }, title: 'Notificação de teste' };
    expect(requests[0]?.body).toEqual([expect.objectContaining({ ...message, to: first }), expect.objectContaining({ ...message, to: second })]);
    // Receipts are read about 15 minutes later.
    expect(later).toHaveLength(1);
    expect(later[0]?.at.getTime()).toBe(NOW.getTime() + 15 * 60 * 1000);
  });

  it('writes to a Spanish account in Spanish', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await em.nativeUpdate(Appuser, { appuserKey: household.appuser.appuserKey }, { language: SupportedLanguages.ES });
    await device(em, household, await session(em, household));
    const requests: unknown[][] = [];
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as unknown[];
      requests.push(body);
      return Promise.resolve(new Response(JSON.stringify({ data: body.map(() => ({ id: randomUUID(), status: 'ok' })) }), { status: 200 }));
    });

    await handlePushSendJob(testJob(household), {
      client: new ExpoPushClient({ accessToken: null, fetch: fetch as unknown as typeof globalThis.fetch }),
      em,
      enabled: () => true,
      enqueue: queue().enqueue,
      logger: { info: () => undefined, warn: () => undefined },
      now: () => NOW,
    });

    const spanish = renderPush({ kind: 'test' }, 'es');
    expect(spanish.title).not.toBe(renderPush({ kind: 'test' }, 'en').title);
    expect(requests[0]).toEqual([expect.objectContaining({ body: spanish.body, title: spanish.title })]);
  });

  it('batches at most 100 messages per request', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const fake = expo();
    const messages = Array.from({ length: 205 }, (_, index) => ({ body: 'b', channelId: 'default' as const, data: {}, priority: 'high' as const, sound: 'default' as const, title: 't', to: `ExponentPushToken[batch-${index}]` }));

    const tickets = await fake.client.send(messages);

    expect(tickets).toHaveLength(205);
    expect(fake.requests.map((request) => (request.body as unknown[]).length)).toEqual([100, 100, 5]);
    expect(household).toBeDefined();
  });

  it('disables a token Expo reports as not registered, on the ticket or later on its receipt', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const sessionId = await session(em, household);
    const gone = await device(em, household, sessionId);
    const later = await device(em, household, sessionId);
    const kept = await device(em, household, sessionId);
    const receiptId = `receipt-${randomUUID()}`;
    const fake = expo(
      (message) => (message.to === gone ? { details: { error: 'DeviceNotRegistered' }, message: 'not registered', status: 'error' } : { id: message.to === later ? receiptId : randomUUID(), status: 'ok' }),
      { [receiptId]: { details: { error: 'DeviceNotRegistered' }, status: 'error' } },
    );
    const { enqueue, later: receiptJobs } = queue();

    const outcome = await sendPushNotification({ appuserKey: household.appuser.appuserKey, notification: { kind: 'test' } }, { client: fake.client, em, enabled: () => true, enqueue, now: () => NOW });
    expect(outcome).toEqual({ failed: 0, sent: 2, status: 'sent', unregistered: 1 });
    expect(await liveTokens(db.em())).toEqual([later, kept]);

    const check = receiptJobs[0]?.payload as { tickets: { id: string; pushDeviceKey: number }[] };
    expect(await checkPushReceipts(check.tickets, { client: fake.client, em: db.em(), now: () => NOW })).toMatchObject({ unregistered: 1 });
    expect(await liveTokens(db.em())).toEqual([kept]);

    // Registering the token again (the app reinstalled) turns it back on.
    await device(db.em(), household, sessionId, gone);
    expect((await liveTokens(db.em())).sort()).toEqual([gone, kept].sort());
  });

  it('retries the job when Expo is unavailable, and drops it when Expo refuses it for good', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await device(em, household, await session(em, household));
    const answer = (status: number) => new ExpoPushClient({ accessToken: null, fetch: (() => Promise.resolve(new Response('{}', { status }))) as unknown as typeof globalThis.fetch });
    const job = testJob(household);
    const deps = { em, enabled: () => true, enqueue: queue().enqueue, logger: { info: () => undefined, warn: () => undefined }, now: () => NOW };

    await expect(handlePushSendJob(job, { ...deps, client: answer(503) })).rejects.toThrow(/503/u);
    await expect(handlePushSendJob(job, { ...deps, client: answer(429) })).rejects.toThrow(/429/u);
    await expect(handlePushSendJob(job, { ...deps, client: answer(401) })).resolves.toBe(false);
  });

  it('stops sending to a phone once its session ends, and removes it', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const signedOut = await session(em, household);
    const expired = await session(em, household, new Date(NOW.getTime() - 1000));
    const signedIn = await session(em, household);
    await device(em, household, signedOut);
    await device(em, household, expired);
    const live = await device(em, household, signedIn);
    // better-auth deletes the session row on sign-out and calls the hook.
    await em.getConnection().execute('delete from better_auth."session" where "id" = ?', [signedOut]);
    const fake = expo();

    const outcome = await sendPushNotification({ appuserKey: household.appuser.appuserKey, notification: { kind: 'test' } }, { client: fake.client, em, enabled: () => true, enqueue: queue().enqueue, now: () => NOW });

    expect(outcome).toMatchObject({ sent: 1, status: 'sent' });
    expect(fake.requests[0]?.body).toEqual([expect.objectContaining({ to: live })]);
    expect(await liveTokens(db.em())).toEqual([live]);
  });

  it('removes the phones of a session as it ends, through the better-auth hook', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const ending = await session(em, household);
    const other = await session(em, household);
    await device(em, household, ending);
    const kept = await device(em, household, other);

    await removePushDevicesForSession(ending, (sql, params) => em.getConnection().execute(sql.replace('$1', '?'), params));

    expect(await liveTokens(db.em())).toEqual([kept]);
  });

  it('sends to nobody whose account is closed', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await device(em, household, await session(em, household));
    await em.nativeUpdate(Appuser, { appuserKey: household.appuser.appuserKey }, { recordActive: false });
    const fake = expo();

    expect(await sendPushNotification({ appuserKey: household.appuser.appuserKey, notification: { kind: 'test' } }, { client: fake.client, em, enabled: () => true, enqueue: queue().enqueue, now: () => NOW }))
      .toEqual({ reason: 'user_unavailable', status: 'skipped' });
    expect(fake.fetch).not.toHaveBeenCalled();
  });
});
