import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addAccount, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { handleCreditCardDueReminderJob } from '@app/jobs/credit-card-due-reminder.worker';
import { SupportedLanguages } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { CreditCardDueReminderChannel, CreditCardDueReminderDelivery, CreditCardDueReminderStatus } from '@entity/CreditCardDueReminderDelivery';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { PushDevice, PushDevicePlatform } from '@entity/PushDevice';
import type { RenderedEmailInput, RenderedEmailOutcome } from '@service/email/email';
import { renderPush } from '@service/push/push-messages';

import { createCreditCardDueReminderEmailChannel } from '../credit-card-due-reminder-email.channel';
import { createCreditCardDueReminderPushChannel } from '../credit-card-due-reminder-push.channel';
import { sendCreditCardDueReminders } from '../credit-card-due-reminder.service';

const utc = (value: string) => new Date(`${value}T12:00:00.000Z`);

/*
 * A payment reminder is money advice with a deadline: it must arrive once, before the due date,
 * and only while the statement is actually unpaid. These tests drive the daily sweep directly.
 */
describe('credit card due reminders', () => {
  const db = useTestDatabase();

  /** A card closing on the 5th and due on the 25th; the January statement is due 25 January. */
  async function seedCard(em: EntityManager): Promise<Household> {
    const household = await seedHousehold(em);
    em.create(CreditCardDetail, {
      accountKey: household.account,
      creditLimit: 1000,
      paymentDueDay: 25,
      statementCloseDay: 5,
      tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    return household;
  }

  function harness(
    provider: (input: RenderedEmailInput) => RenderedEmailOutcome = () => ({ providerMessageIds: [randomUUID()], type: 'accepted' }),
    options: { emailConfigured?: () => boolean; pushEnabled?: boolean } = {},
  ) {
    const sent: RenderedEmailInput[] = [];
    const pushed: unknown[] = [];
    const push = createCreditCardDueReminderPushChannel({
      em: db.em(),
      enabled: () => options.pushEnabled ?? false,
      enqueue: () => ({
        send: (_queue: string, payload: unknown) => { pushed.push(payload); return Promise.resolve('job'); },
        sendAfter: () => Promise.resolve('job'),
      }),
    });
    const channel = createCreditCardDueReminderEmailChannel({
      isEmailConfigured: options.emailConfigured ?? (() => true),
      optOut: { generateCategoryToken: () => 'token' },
      send: (input) => {
        const outcome = provider(input);
        if (outcome.type === 'accepted') sent.push(input);
        return Promise.resolve(outcome);
      },
    });
    const run = (now: Date, daysBeforeDue = 3) => sendCreditCardDueReminders({
      channels: { email: channel, push },
      daysBeforeDue,
      em: db.em(),
      now,
    });
    return { channel, push, pushed, run, sent };
  }

  const deliveries = () => db.em().find(CreditCardDueReminderDelivery, {}, { orderBy: { creditCardDueReminderDeliveryKey: 'asc' } });

  it('emails once, three days before the due date, for a closed statement that still owes', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });

    const { run, sent } = harness();
    const result = await run(utc('2026-01-22'));

    expect(result).toEqual({ reminded: 1, retryable: 0, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain('Current account');
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ channel: 'email', status: CreditCardDueReminderStatus.SENT });
    expect(delivery?.periodEnd.toISOString().slice(0, 10)).toBe('2026-01-05');
  });

  it('pushes once, without the amount or the card, to an owner who turned card-reminder push on', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });
    em.create(EmailNotificationPreference, { appuserKey: household.appuser, pushCreditCardDueRemindersEnabled: true }, { partial: true });
    em.create(PushDevice, { appuserKey: household.appuser, platform: PushDevicePlatform.IOS, sessionId: 'session-1', token: 'ExponentPushToken[card-owner-1]' }, { partial: true });
    await em.flush();

    const { pushed, run, sent } = harness(undefined, { pushEnabled: true });
    expect(await run(utc('2026-01-22'))).toEqual({ reminded: 1, retryable: 0, sent: 2 });
    expect(await run(utc('2026-01-22'))).toEqual({ reminded: 1, retryable: 0, sent: 0 });

    expect(sent).toHaveLength(1);
    expect(pushed).toEqual([{ appuserKey: household.appuser.appuserKey, notification: { accountKey: household.account.accountKey, daysUntilDue: 3, kind: 'credit_card_due' }, type: 'send' }]);
    const rendered = renderPush({ accountKey: household.account.accountKey, daysUntilDue: 3, kind: 'credit_card_due' }, 'en');
    expect(`${rendered.title} ${rendered.body}`).not.toMatch(/120|Current account/u);
    expect((await deliveries()).map((delivery) => delivery.channel).sort()).toEqual(['email', 'push']);
  });

  it('records no push delivery while push is off on the server, and suppresses it for an owner who left it off', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });

    expect(await harness().run(utc('2026-01-22'))).toEqual({ reminded: 1, retryable: 0, sent: 1 });
    await expect(deliveries()).resolves.toHaveLength(1);

    const { pushed, run } = harness(undefined, { pushEnabled: true });
    await run(utc('2026-01-22'));
    expect(pushed).toHaveLength(0);
    const push = (await deliveries()).find((delivery) => delivery.channel === CreditCardDueReminderChannel.PUSH);
    expect(push).toMatchObject({ outcomeCode: 'push_credit_card_due_reminders_disabled', status: CreditCardDueReminderStatus.SUPPRESSED });
  });

  it('writes to a Spanish account in Spanish, dates and links included', async () => {
    const em = db.em();
    const english = await seedCard(em);
    const spanish = await seedCard(em);
    em.assign(spanish.appuser, { language: SupportedLanguages.ES });
    await em.flush();
    for (const household of [english, spanish]) await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });

    const { run, sent } = harness();
    await run(utc('2026-01-22'));

    const to = (household: Household) => sent.find((email) => email.to.email === household.appuser.emailAddress);
    expect(to(spanish)?.subject).not.toBe(to(english)?.subject);
    expect(to(spanish)?.text).toContain('25 de enero');
    expect(to(spanish)?.html).toContain(`/es/accounts/${spanish.account.accountKey}?tab=statements`);
    expect(to(english)?.text).toContain('25 January');
  });

  it('sends nothing on a second run the same day', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });

    const { run, sent } = harness();
    await run(utc('2026-01-22'));
    const second = await run(utc('2026-01-22'));

    expect(second).toEqual({ reminded: 1, retryable: 0, sent: 0 });
    expect(sent).toHaveLength(1);
    await expect(deliveries()).resolves.toHaveLength(1);
  });

  it('uses the persisted unique claim to keep concurrent sweeps from sending twice', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });
    const { run, sent } = harness();

    const results = await Promise.all([run(utc('2026-01-22')), run(utc('2026-01-22'))]);

    expect(results.map((result) => result.sent).sort()).toEqual([0, 1]);
    expect(sent).toHaveLength(1);
    await expect(deliveries()).resolves.toHaveLength(1);
  });

  it('does not remind about a statement that was paid after it closed', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });
    await addTransaction(em, household, { amount: 120, date: utc('2026-01-10'), status: 'BOOKED' });

    const { run, sent } = harness();

    expect(await run(utc('2026-01-22'))).toEqual({ reminded: 0, retryable: 0, sent: 0 });
    expect(sent).toHaveLength(0);
    await expect(deliveries()).resolves.toHaveLength(0);
  });

  it('reminds only for the remaining partial balance', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });
    await addTransaction(em, household, { amount: 60, date: utc('2026-01-10'), status: 'BOOKED' });
    const { run, sent } = harness();

    expect(await run(utc('2026-01-22'))).toEqual({ reminded: 1, retryable: 0, sent: 1 });
    expect(sent[0]?.text).toContain('60');
  });

  it('does not remind earlier than the lead time, nor once the due date has passed', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });

    const { run, sent } = harness();

    // Four days before the due date: too early.
    expect(await run(utc('2026-01-21'))).toEqual({ reminded: 0, retryable: 0, sent: 0 });
    // The day after the due date: overdue, past the point a reminder helps.
    expect(await run(utc('2026-01-26'))).toEqual({ reminded: 0, retryable: 0, sent: 0 });
    expect(sent).toHaveLength(0);
  });

  it('catches up the next day after a missed sweep, and says how many days are left', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });

    const { run, sent } = harness();

    expect(await run(utc('2026-01-23'))).toEqual({ reminded: 1, retryable: 0, sent: 1 });
    expect(sent[0]?.subject).toContain('2 days');
    expect(await run(utc('2026-01-24'))).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it('reminds on the due day itself when no earlier sweep did', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });

    const { run, sent } = harness();

    expect(await run(utc('2026-01-25'))).toMatchObject({ sent: 1 });
    expect(sent[0]?.subject).toMatch(/today/iu);
  });

  it('counts calendar days, whatever the hour the sweep runs', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });

    const early = harness();
    expect(await early.run(new Date('2026-01-21T23:59:00.000Z'))).toMatchObject({ sent: 0 });
    expect(await early.run(new Date('2026-01-22T00:01:00.000Z'))).toMatchObject({ sent: 1 });
    expect(early.sent[0]?.subject).toContain('3 days');
  });

  it('follows a short month: a card closing on the 31st and due on the 5th', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    em.create(CreditCardDetail, { accountKey: household.account, paymentDueDay: 5, statementCloseDay: 31, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    // In the statement that closes on 28 February (the 31st clamped) and is due on 5 March.
    await addTransaction(em, household, { amount: -50, date: utc('2026-02-20'), status: 'BOOKED' });

    const { run } = harness();

    expect(await run(utc('2026-03-01'))).toMatchObject({ sent: 0 });
    expect(await run(utc('2026-03-02'))).toMatchObject({ sent: 1 });
    const [delivery] = await deliveries();
    expect(delivery?.periodEnd.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('sends nothing and records nothing while no email provider is configured', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });
    let configured = false;
    const { run, sent } = harness(undefined, { emailConfigured: () => configured });

    expect(await run(utc('2026-01-22'))).toEqual({ reminded: 0, retryable: 0, sent: 0 });
    await expect(deliveries()).resolves.toHaveLength(0);

    configured = true;
    expect(await run(utc('2026-01-23'))).toMatchObject({ sent: 1 });
    expect(sent).toHaveLength(1);
  });

  it('emails the member who owns the card, not the household owner', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const card = await addAccount(em, household, { isPrivate: true, name: 'Partner card', owner: partner });
    em.create(CreditCardDetail, { accountKey: card, paymentDueDay: 25, statementCloseDay: 5, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    await addTransaction(em, household, { account: card, amount: -40, appuser: partner, date: utc('2026-01-04'), status: 'BOOKED' });

    const { run, sent } = harness();
    await run(utc('2026-01-22'));

    expect(sent.map((message) => message.to.email)).toEqual([partner.emailAddress]);
  });

  it('does not remind a member who has left the household about its card', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const card = await addAccount(em, household, { name: 'Partner card', owner: partner });
    em.create(CreditCardDetail, { accountKey: card, paymentDueDay: 25, statementCloseDay: 5, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    await addTransaction(em, household, { account: card, amount: -40, appuser: partner, date: utc('2026-01-04'), status: 'BOOKED' });
    const membership = await em.findOneOrFail(AppuserTenant, { appuserKey: partner });
    em.assign(membership, { deletedAt: new Date('2026-01-10T00:00:00.000Z'), recordActive: false });
    await em.flush();

    const { run, sent } = harness();

    expect(await run(utc('2026-01-22'))).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(0);
    await expect(deliveries()).resolves.toHaveLength(0);
  });

  it('honours a different lead time', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });

    const { run, sent } = harness();

    expect(await run(utc('2026-01-18'), 7)).toEqual({ reminded: 1, retryable: 0, sent: 1 });
    expect(sent).toHaveLength(1);
  });

  it('records a suppressed delivery and sends nothing when the person turned reminders off', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });
    em.create(EmailNotificationPreference, { appuserKey: household.appuser, creditCardDueRemindersEnabled: false }, { partial: true });
    await em.flush();

    const { run, sent } = harness();

    expect(await run(utc('2026-01-22'))).toEqual({ reminded: 1, retryable: 0, sent: 0 });
    expect(sent).toHaveLength(0);
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ outcomeCode: 'credit_card_due_reminders_disabled', status: CreditCardDueReminderStatus.SUPPRESSED });
  });

  it('stops reminding once the global unsubscribe is set', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });
    em.assign(household.appuser, { marketingOptOut: new Date('2026-01-01T00:00:00.000Z') });
    await em.flush();

    const { run, sent } = harness();

    await run(utc('2026-01-22'));
    expect(sent).toHaveLength(0);
    const [delivery] = await deliveries();
    expect(delivery?.outcomeCode).toBe('marketing_opt_out');
  });

  it('retries a provider refusal instead of recording it as sent', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });

    const { run, sent } = harness(() => ({ errorCode: 'rate_limited', retryable: true, type: 'rejected' }));

    expect(await run(utc('2026-01-22'))).toEqual({ reminded: 1, retryable: 1, sent: 0 });
    expect(sent).toHaveLength(0);
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ status: CreditCardDueReminderStatus.PENDING });
  });

  it('fails the job on a refusal that may clear, so pg-boss retries the sweep', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });
    const { channel, push } = harness(() => ({ errorCode: 'rate_limited', retryable: true, type: 'rejected' }));

    await expect(handleCreditCardDueReminderJob({ channels: { email: channel, push }, daysBeforeDue: 3, em: db.em(), logger: { info: () => undefined }, now: utc('2026-01-22') }))
      .rejects.toThrow(/retry/u);
  });

  it('reclaims a pending delivery after a known provider refusal, without allowing concurrent claims', async () => {
    const em = db.em();
    const household = await seedCard(em);
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-04'), status: 'BOOKED' });
    let attempts = 0;
    const { run, sent } = harness(() => {
      attempts += 1;
      return attempts === 1
        ? { errorCode: 'rate_limited', retryable: true, type: 'rejected' }
        : { providerMessageIds: [randomUUID()], type: 'accepted' };
    });

    await run(utc('2026-01-22'));
    await run(utc('2026-01-22'));

    expect(attempts).toBe(2);
    expect(sent).toHaveLength(1);
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ status: CreditCardDueReminderStatus.SENT });
  });
});
