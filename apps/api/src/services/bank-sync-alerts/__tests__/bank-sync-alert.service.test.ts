import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { type Appuser, SupportedLanguages } from '@entity/Appuser';
import { BankSyncAlertDelivery, BankSyncAlertDeliveryStatus, BankSyncAlertEventType } from '@entity/BankSyncAlertDelivery';
import { BankSyncFinality, BankSyncFlow, BankSyncIncident, BankSyncResult, BankSyncRolloutMode } from '@entity/BankSyncIncident';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { PushDevice, PushDevicePlatform } from '@entity/PushDevice';
import type { RenderedEmailInput, RenderedEmailOutcome } from '@service/email/email';
import { renderPush } from '@service/push/push-messages';

import { createBankSyncAlertEmailChannel } from '../bank-sync-alert-email.channel';
import { createBankSyncAlertPushChannel } from '../bank-sync-alert-push.channel';
import { sendBankSyncAlert, sweepBankSyncAlerts } from '../bank-sync-alert.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = new Date('2026-11-09T09:00:00.000Z');
const day = (n: number) => new Date(START.getTime() + n * DAY);

describe('bank sync alerts', () => {
  const db = useTestDatabase();
  let sequence = 0;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function connection(em: EntityManager, household: Household, input: { accessValidUntil?: Date; owner?: Appuser; status?: EnableBankingConnectionStatus } = {}) {
    sequence += 1;
    const owner = input.owner ?? household.appuser;
    const credential = em.create(EnableBankingCredential, {
      applicationId: `app-${sequence}`, appuserKey: owner, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'ciphertext', privateKeyIv: 'iv', tenantKey: household.tenant,
    }, { partial: true });
    const created = em.create(EnableBankingConnection, {
      accessValidUntil: input.accessValidUntil ?? day(120), appuserKey: owner, aspspCountry: 'PT', aspspName: 'Banco Exemplo',
      enableBankingCredentialKey: credential, sessionId: `session-${sequence}`, state: `state-${sequence}`, status: input.status ?? EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    const account = await addAccount(em, household, { owner });
    em.assign(account, { enableBankingConnectionKey: created });
    await em.flush();
    return created;
  }

  async function syncRun(conn: EnableBankingConnection, at: Date, outcome: string) {
    const em = db.em();
    const success = outcome === 'success';
    em.create(BankSyncIncident, {
      appuserKey: conn.appuserKey, attempts: 1, createdAt: at, errorCategory: success ? undefined : 'provider', errorCode: success ? undefined : outcome,
      finality: success ? BankSyncFinality.TERMINAL_SUCCESS : BankSyncFinality.TERMINAL_FAILURE, flow: BankSyncFlow.SCHEDULED_REFRESH, incidentId: randomUUID(),
      requisitionId: conn.sessionId, result: success ? BankSyncResult.SUCCESS : BankSyncResult.FAILURE, rolloutMode: BankSyncRolloutMode.OFF, successAt: success ? at : undefined, updatedAt: at,
    }, { partial: true });
    await em.flush();
  }

  /** A pg-boss stand-in: what a sweep enqueues, then delivered through the real email channel with a fake provider. */
  function harness(provider: (input: RenderedEmailInput) => RenderedEmailOutcome = () => ({ providerMessageIds: [randomUUID()], type: 'accepted' })) {
    const sent: RenderedEmailInput[] = [];
    const channel = createBankSyncAlertEmailChannel({
      optOut: { generateCategoryToken: () => 'token' },
      send: (input) => {
        const outcome = provider(input);
        if (outcome.type === 'accepted') sent.push(input);
        return Promise.resolve(outcome);
      },
    });
    const pushed: unknown[] = [];
    const push = createBankSyncAlertPushChannel({
      em: db.em(),
      enqueue: () => ({
        send: (_queue: string, payload: unknown) => { pushed.push(payload); return Promise.resolve('job'); },
        sendAfter: () => Promise.resolve('job'),
      }),
    });
    const run = async (now: Date) => {
      const queued: number[] = [];
      await sweepBankSyncAlerts({ em: db.em(), enqueueSend: (key) => { queued.push(key); return Promise.resolve(); }, now });
      const results = [];
      for (const key of queued) results.push(await sendBankSyncAlert(key, { channels: { email: channel, push }, em: db.em(), now: () => now }));
      return results;
    };
    return { channel, push, pushed, run, sent };
  }

  const deliveries = () => db.em().find(BankSyncAlertDelivery, {}, { orderBy: { bankSyncAlertDeliveryKey: 'asc' } });

  it('emails an expiring connection exactly once at seven days and once in the last day, however often the sweep runs', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await connection(em, household, { accessValidUntil: day(10) });
    const { run, sent } = harness();

    for (let n = 0; n < 10; n += 1) {
      await run(day(n));
      await run(new Date(day(n).getTime() + 6 * HOUR));
    }

    expect(sent).toHaveLength(2);
    expect((await deliveries()).map((d) => [d.event, d.status])).toEqual([
      ['consent_expiring_7d', BankSyncAlertDeliveryStatus.SENT],
      ['consent_expiring_1d', BankSyncAlertDeliveryStatus.SENT],
    ]);
    expect(sent[0]?.to.email).toBe(household.appuser.emailAddress);
    expect(sent[0]?.text).toContain('Banco Exemplo');
    expect(sent[0]?.headers['List-Unsubscribe']).toContain('token');
  });

  it('pushes an expiring connection to an owner who turned bank-alert push on, without naming the bank', async () => {
    vi.stubEnv('PUSH_ENABLED', 'true');
    const em = db.em();
    const household = await seedHousehold(em);
    await connection(em, household, { accessValidUntil: day(10) });
    em.create(EmailNotificationPreference, { appuserKey: household.appuser, pushBankSyncAlertsEnabled: true }, { partial: true });
    em.create(PushDevice, { appuserKey: household.appuser, platform: PushDevicePlatform.ANDROID, sessionId: 'session-1', token: 'ExponentPushToken[bank-owner-1]' }, { partial: true });
    await em.flush();
    const { pushed, run, sent } = harness();

    await run(day(3));
    await run(day(3));

    expect(sent).toHaveLength(1);
    expect(pushed).toEqual([{ appuserKey: household.appuser.appuserKey, notification: { event: 'consent_expiring_7d', kind: 'bank_sync_alert' }, type: 'send' }]);
    expect(renderPush({ event: BankSyncAlertEventType.CONSENT_EXPIRING_7D, kind: 'bank_sync_alert' }, 'en').body).not.toContain('Banco Exemplo');
    expect((await deliveries()).map((d) => [d.channel, d.status])).toEqual([
      ['email', BankSyncAlertDeliveryStatus.SENT],
      ['push', BankSyncAlertDeliveryStatus.SENT],
    ]);
  });

  it('records no push delivery while push is off on the server', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await connection(em, household, { accessValidUntil: day(10) });
    em.create(EmailNotificationPreference, { appuserKey: household.appuser, pushBankSyncAlertsEnabled: true }, { partial: true });
    await em.flush();
    const { pushed, run } = harness();

    await run(day(3));

    expect(pushed).toHaveLength(0);
    expect((await deliveries()).map((d) => d.channel)).toEqual(['email']);
  });

  it('emails a failing connection once after 48 hours, not on every run', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const conn = await connection(em, household);
    await syncRun(conn, day(-1), 'success');
    const { run, sent } = harness();

    for (let n = 0; n < 6; n += 1) {
      await syncRun(conn, day(n), 'account_phase_failed');
      await run(new Date(day(n).getTime() + HOUR));
      expect(sent).toHaveLength(n < 2 ? 0 : 1);
    }
    expect((await deliveries()).map((d) => d.event)).toEqual(['sync_failing']);
  });

  it('never emails about transient failures, however long they last', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const conn = await connection(em, household);
    const { run, sent } = harness();

    for (let n = 0; n < 6; n += 1) {
      await syncRun(conn, day(n), n % 2 ? 'rate_limited' : 'provider_unavailable');
      await run(new Date(day(n).getTime() + HOUR));
    }

    expect(sent).toHaveLength(0);
    expect(await deliveries()).toHaveLength(0);
  });

  it('emails a consent the bank ended early right away', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await connection(em, household, { accessValidUntil: day(60), status: EnableBankingConnectionStatus.EXPIRED });
    const { run, sent } = harness();

    await run(day(0));
    await run(day(1));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain('Banco Exemplo');
  });

  it('sends nothing once the owner turns bank connection alerts off', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await connection(em, household, { accessValidUntil: day(5) });
    em.create(EmailNotificationPreference, { appuserKey: household.appuser, bankSyncAlertsEnabled: false }, { partial: true });
    await em.flush();
    const { run, sent } = harness();

    const [result] = await run(day(0));

    expect(sent).toHaveLength(0);
    expect(result).toMatchObject({ outcomeCode: 'bank_sync_alerts_disabled', status: BankSyncAlertDeliveryStatus.SUPPRESSED });
  });

  it('respects the account-wide unsubscribe', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await connection(em, household, { accessValidUntil: day(5) });
    em.assign(household.appuser, { marketingOptOut: day(-30) });
    await em.flush();
    const { run, sent } = harness();

    const [result] = await run(day(0));

    expect(sent).toHaveLength(0);
    expect(result?.outcomeCode).toBe('marketing_opt_out');
  });

  it('tells only the member who owns the connection, never their partner', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    await connection(em, household, { accessValidUntil: day(5), owner: partner });
    const { run, sent } = harness();

    await run(day(0));

    expect(sent.map((email) => email.to.email)).toEqual([partner.emailAddress]);
  });

  it('writes in the owner\'s language', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    em.assign(household.appuser, { language: SupportedLanguages.PT });
    await em.flush();
    await connection(em, household, { accessValidUntil: day(5) });
    const { run, sent } = harness();

    await run(day(0));

    expect(sent[0]?.subject).toMatch(/ligação/u);
    expect(sent[0]?.html).toContain('/pt/settings?tab=connections');
  });

  it('writes to a Spanish account in Spanish, with an es-ES date and links that open the app in Spanish', async () => {
    const em = db.em();
    const spanish = await seedHousehold(em);
    em.assign(spanish.appuser, { language: SupportedLanguages.ES });
    await em.flush();
    await connection(em, spanish, { accessValidUntil: day(5) });
    const { run, sent } = harness();

    await run(day(0));

    const date = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Lisbon' }).format(day(5));
    expect(date).toMatch(/^\d{1,2} de \p{Ll}+$/u);
    expect(sent[0]?.subject).toMatch(new RegExp(`^Tu conexión con .+ termina el ${date}$`, 'u'));
    expect(sent[0]?.text).toContain('Volver a conectar el banco');
    expect(sent[0]?.text).toContain('ajustes de notificaciones');
    expect(sent[0]?.html).toContain('/es/settings?tab=connections');
    expect(sent[0]?.html).not.toContain('/en/settings');
  });

  it('drops an alert that no longer applies by the time it is sent', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const conn = await connection(em, household, { accessValidUntil: day(5) });
    const queued: number[] = [];
    await sweepBankSyncAlerts({ em: db.em(), enqueueSend: (key) => { queued.push(key); return Promise.resolve(); }, now: day(0) });
    // Reconnected before the send ran: the consent now ends months later.
    await db.em().nativeUpdate(EnableBankingConnection, { enableBankingConnectionKey: conn.enableBankingConnectionKey }, { accessValidUntil: day(180) });
    const { push, sent } = harness();
    const channel = createBankSyncAlertEmailChannel({ optOut: { generateCategoryToken: () => 'token' }, send: (input) => { sent.push(input); return Promise.resolve({ providerMessageIds: ['id'], type: 'accepted' }); } });

    const result = await sendBankSyncAlert(queued[0] ?? 0, { channels: { email: channel, push }, em: db.em(), now: () => day(0) });

    expect(result).toMatchObject({ outcomeCode: 'resolved', status: BankSyncAlertDeliveryStatus.SUPPRESSED });
    expect(sent).toHaveLength(0);
  });

  it('retries a send the provider refused for now, and never repeats one that may have gone out', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await connection(em, household, { accessValidUntil: day(5) });
    const outcomes: RenderedEmailOutcome[] = [{ errorCode: 'rate_limit_exceeded', retryable: true, type: 'rejected' }, { type: 'unknown' }];
    const { run, sent } = harness(() => outcomes.shift() ?? { providerMessageIds: ['late'], type: 'accepted' });

    const [first] = await run(day(0));
    expect(first).toMatchObject({ retry: true, status: BankSyncAlertDeliveryStatus.PENDING });

    const [second] = await run(day(0));
    expect(second).toMatchObject({ retry: false, status: BankSyncAlertDeliveryStatus.UNKNOWN });

    expect(await run(day(1))).toEqual([]);
    expect(sent).toHaveLength(0);
  });
});
