import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { addAccount, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { AnalyticsOutbox } from '@entity/AnalyticsOutbox';
import { Appuser } from '@entity/Appuser';
import { AssistantAuditEventType, AssistantAuditLog, AssistantAuditSource } from '@entity/AssistantAuditLog';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { BankSyncAlertChannel, BankSyncAlertDelivery, BankSyncAlertDeliveryStatus, BankSyncAlertEventType } from '@entity/BankSyncAlertDelivery';
import { CreditCardDueReminderChannel, CreditCardDueReminderDelivery, CreditCardDueReminderStatus } from '@entity/CreditCardDueReminderDelivery';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential, EnableBankingCredentialStatus } from '@entity/EnableBankingCredential';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioImportRow } from '@entity/PortfolioImportRow';
import { PortfolioImportSession, PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import { PushNotificationClaim } from '@entity/PushNotificationClaim';
import { SentEmail } from '@entity/SentEmail';
import { TransactionAttachment } from '@entity/TransactionAttachment';
import { TransactionOCRImport, TransactionOCRImportStatus } from '@entity/TransactionOCRImport';

import {
  purgeAssistantAuditLog,
  purgeBankSyncAlertDeliveries,
  purgeCreditCardReminderDeliveries,
  purgeDeliveredAnalyticsEvents,
  purgePortfolioImports,
  purgePushNotificationClaims,
  purgeReceiptScans,
  purgeRetiredEnableBankingKeys,
  purgeSentEmails,
  runRetentionPurge,
} from '../retention-purge.service';
import type { RetentionStorage } from '../retention-storage';

/*
 * The daily retention purge deletes each kind of personal data the privacy policy keeps for 30
 * days, in every household, once it is older than that: a row 31 days old goes, one 29 days old
 * stays. Where a row is still the only thing stopping a message going twice, or a file is still in
 * use, it stays for as long as that is so.
 */
describe('the daily retention purge', () => {
  const db = useTestDatabase();
  const now = new Date('2026-11-28T04:20:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const query = (sql: string, params: unknown[] = []) => db.em().getConnection().execute<Record<string, unknown>[]>(sql, params);
  const remaining = async (table: string, key: string) => new Set((await query(`select ${key} as k from ${table}`)).map((row) => Number(row['k'])));
  /** Sets a timestamp the entities write themselves (`created_at`, `updated_at`). */
  const age = (table: string, key: string, id: number, column: string, at: Date) => query(`update ${table} set ${column} = ? where ${key} = ?`, [at, id]);

  function storage(options: { failOn?: string } = {}) {
    const deleted: string[] = [];
    const store: RetentionStorage & { deleted: string[] } = {
      deleted,
      deleteObject: (bucket, key) => (key === options.failOn ? Promise.reject(new Error('store unavailable')) : Promise.resolve(void deleted.push(`${bucket}/${key}`))),
      filesBucket: () => 'files',
      isEnabled: () => true,
    };
    return store;
  }

  describe('assistant and MCP audit log', () => {
    async function logged(household: Household, at: Date, source = AssistantAuditSource.ASSISTANT) {
      const em = db.em();
      const row = em.create(AssistantAuditLog, { appuserKey: household.appuser, conversationId: randomUUID(), eventType: AssistantAuditEventType.TOOL_CALLED, source, tenantKey: household.tenant, toolName: 'get_accounts' }, { partial: true });
      await em.flush();
      await age('assistant_audit_log', 'assistant_audit_log_key', row.assistantAuditLogKey, 'created_at', at);
      return row.assistantAuditLogKey;
    }

    it('deletes rows written over 30 days ago, from every household and both surfaces', async () => {
      const ours = await seedHousehold(db.em());
      const theirs = await seedHousehold(db.em());
      const old = [await logged(ours, daysAgo(31)), await logged(theirs, daysAgo(31), AssistantAuditSource.MCP)];
      const young = [await logged(ours, daysAgo(29)), await logged(theirs, daysAgo(29), AssistantAuditSource.MCP)];

      expect(await purgeAssistantAuditLog(db.em(), now)).toEqual({ deleted: old.length, more: false });
      expect(await remaining('assistant_audit_log', 'assistant_audit_log_key')).toEqual(new Set(young));
    });

    it('works in bounded batches and says when rows are left for the next run', async () => {
      const household = await seedHousehold(db.em());
      for (let index = 0; index < 5; index += 1) await logged(household, daysAgo(40));

      expect(await purgeAssistantAuditLog(db.em(), now, { batchSize: 2, maxBatches: 2 })).toEqual({ deleted: 4, more: true });
      expect(await purgeAssistantAuditLog(db.em(), now, { batchSize: 2, maxBatches: 2 })).toEqual({ deleted: 1, more: false });
    });
  });

  describe('analytics events', () => {
    it('deletes our copy of an event 30 days after it was delivered, and leaves undelivered ones to the outbox', async () => {
      const em = db.em();
      const event = (sentAt: Date | undefined) => em.create(AnalyticsOutbox, { distinctId: randomUUID(), eventId: randomUUID(), eventName: 'signup', properties: {}, sentAt }, { partial: true });
      const old = event(daysAgo(31));
      const young = event(daysAgo(29));
      const undelivered = event(undefined);
      await em.flush();
      await age('analytics_outbox', 'analytics_outbox_key', undelivered.analyticsOutboxKey, 'created_at', daysAgo(10));

      expect(await purgeDeliveredAnalyticsEvents(db.em(), now)).toEqual({ deleted: 1, more: false });
      expect(await remaining('analytics_outbox', 'analytics_outbox_key')).toEqual(new Set([undelivered.analyticsOutboxKey, young.analyticsOutboxKey]));
      expect(old.analyticsOutboxKey).toBeGreaterThan(0);
    });
  });

  describe('sent email and push records', () => {
    async function sent(household: Household, emailType: string, at: Date) {
      const em = db.em();
      const row = em.create(SentEmail, { appuser: household.appuser, emailType, metadata: { deliveryKey: emailType }, sentAt: at, status: 'sent' }, { partial: true });
      await em.flush();
      await age('sent_email', 'sent_email_key', row.sentEmailKey, 'updated_at', at);
      return row.sentEmailKey;
    }

    async function claimed(household: Household, dedupeKey: string, at: Date) {
      const em = db.em();
      const row = em.create(PushNotificationClaim, { appuserKey: household.appuser, dedupeKey }, { partial: true });
      await em.flush();
      await age('push_notification_claim', 'push_notification_claim_key', row.pushNotificationClaimKey, 'created_at', at);
      return row.pushNotificationClaimKey;
    }

    it('deletes the records of emails sent over 30 days ago', async () => {
      const household = await seedHousehold(db.em());
      const weekly = await sent(household, 'wi:w:2026-W43', daysAgo(31));
      const daily = await sent(household, 'ba:d:20261028', daysAgo(31));
      const young = await sent(household, 'wi:w:2026-W44', daysAgo(29));

      expect(await purgeSentEmails(db.em(), now)).toEqual({ deleted: 2, more: false });
      expect(await remaining('sent_email', 'sent_email_key')).toEqual(new Set([young]));
      expect([weekly, daily]).toHaveLength(2);
    });

    it('keeps a budget crossing record until its month is over, so the alert does not go again that month', async () => {
      const household = await seedHousehold(db.em());
      const lateIn = new Date('2026-10-31T09:00:00Z');
      const sentOnTheFirst = new Date('2026-10-01T03:00:00Z');
      const key = (yyyymm: string) => `ba:c:${household.tenant.tenantKey}:7:9:${yyyymm}:80`;
      const october = await sent(household, key('202610'), sentOnTheFirst);
      const september = await sent(household, key('202609'), new Date('2026-09-20T09:00:00Z'));
      const octoberPush = await claimed(household, key('202610'), sentOnTheFirst);

      // 30 days on, still in October: the sweep would see the crossing again.
      expect(await purgeSentEmails(db.em(), lateIn)).toMatchObject({ deleted: 1 });
      expect(await purgePushNotificationClaims(db.em(), lateIn)).toMatchObject({ deleted: 0 });
      expect(await remaining('sent_email', 'sent_email_key')).toEqual(new Set([october]));
      expect(september).toBeGreaterThan(0);

      const novemberSecond = new Date('2026-11-02T04:20:00Z');
      expect(await purgeSentEmails(db.em(), novemberSecond)).toMatchObject({ deleted: 1 });
      expect(await purgePushNotificationClaims(db.em(), novemberSecond)).toMatchObject({ deleted: 1 });
      expect(await remaining('push_notification_claim', 'push_notification_claim_key')).not.toContain(octoberPush);
    });

    it('deletes push claims written over 30 days ago', async () => {
      const household = await seedHousehold(db.em());
      await claimed(household, 'other:1', daysAgo(31));
      const young = await claimed(household, 'other:2', daysAgo(29));

      expect(await purgePushNotificationClaims(db.em(), now)).toEqual({ deleted: 1, more: false });
      expect(await remaining('push_notification_claim', 'push_notification_claim_key')).toEqual(new Set([young]));
    });
  });

  describe('bank sync alert deliveries', () => {
    let sequence = 0;
    async function connection(household: Household, status: EnableBankingConnectionStatus, validUntil: Date) {
      const em = db.em();
      const id = ++sequence;
      const bankConnection = em.create(BankConnection, { accessValidUntil: validUntil, appuserKey: household.appuser, externalId: `session-${id}`, provider: 'enable_banking', status: BankConnectionStatus.LINKED, tenantKey: household.tenant }, { partial: true });
      const detail = em.create(EnableBankingConnection, { accessValidUntil: validUntil, appuserKey: household.appuser, aspspCountry: 'PT', aspspName: 'Example Bank', bankConnectionKey: bankConnection, sessionId: `session-${id}`, state: `state-${id}`, status, tenantKey: household.tenant }, { partial: true });
      await em.flush();
      const account = await addAccount(em, household, { name: `Bank ${id}` });
      account.enableBankingConnectionKey = detail;
      await em.flush();
      return detail;
    }

    async function delivery(household: Household, detail: EnableBankingConnection, event: BankSyncAlertEventType, episodeKey: string, at: Date) {
      const em = db.em();
      const row = em.create(BankSyncAlertDelivery, { appuserKey: household.appuser, channel: BankSyncAlertChannel.EMAIL, completedAt: at, enableBankingConnectionKey: detail, episodeKey, event, providerMessageId: 'msg-1', sentAt: at, status: BankSyncAlertDeliveryStatus.SENT }, { partial: true });
      await em.flush();
      await age('bank_sync_alert_delivery', 'bank_sync_alert_delivery_key', row.bankSyncAlertDeliveryKey, 'updated_at', at);
      return row.bankSyncAlertDeliveryKey;
    }

    it('deletes deliveries over 30 days old, but keeps one whose alert still applies, without its message id', async () => {
      const household = await seedHousehold(db.em());
      const healthyUntil = daysAgo(-120);
      const healthy = await connection(household, EnableBankingConnectionStatus.LINKED, healthyUntil);
      const revokedUntil = daysAgo(-60);
      const revoked = await connection(household, EnableBankingConnectionStatus.EXPIRED, revokedUntil);
      const resolved = await delivery(household, healthy, BankSyncAlertEventType.CONSENT_EXPIRING_7D, daysAgo(25).toISOString(), daysAgo(31));
      const stillRevoked = await delivery(household, revoked, BankSyncAlertEventType.CONSENT_REVOKED, revokedUntil.toISOString(), daysAgo(31));
      const young = await delivery(household, healthy, BankSyncAlertEventType.SYNC_FAILING, daysAgo(31).toISOString(), daysAgo(29));

      expect(await purgeBankSyncAlertDeliveries(db.em(), now)).toEqual({ deleted: 1, kept: 1 });
      expect(await remaining('bank_sync_alert_delivery', 'bank_sync_alert_delivery_key')).toEqual(new Set([stillRevoked, young]));
      const [kept] = await query('select provider_message_id from bank_sync_alert_delivery where bank_sync_alert_delivery_key = ?', [stillRevoked]);
      expect(kept?.['provider_message_id'] ?? null).toBeNull();
      expect(resolved).toBeGreaterThan(0);
    });
  });

  describe('payment-due reminder deliveries', () => {
    async function reminder(household: Household, periodEnd: string, at: Date) {
      const em = db.em();
      const row = em.create(CreditCardDueReminderDelivery, { accountKey: household.account, channel: CreditCardDueReminderChannel.EMAIL, completedAt: at, periodEnd: new Date(`${periodEnd}T00:00:00Z`), providerMessageId: 'msg-1', sentAt: at, status: CreditCardDueReminderStatus.SENT }, { partial: true });
      await em.flush();
      await age('credit_card_due_reminder_delivery', 'credit_card_due_reminder_delivery_key', row.creditCardDueReminderDeliveryKey, 'updated_at', at);
      return row.creditCardDueReminderDeliveryKey;
    }

    it('deletes a delivery over 30 days old once its statement is out of the window the reminder sweep reads, and clears the message id of one it keeps', async () => {
      const household = await seedHousehold(db.em());
      const old = await reminder(household, '2026-10-05', daysAgo(31));
      const stillInWindow = await reminder(household, '2026-10-26', daysAgo(31));
      const young = await reminder(household, '2026-09-30', daysAgo(29));

      expect(await purgeCreditCardReminderDeliveries(db.em(), now)).toEqual({ cleared: 1, deleted: 1, more: false });
      expect(await remaining('credit_card_due_reminder_delivery', 'credit_card_due_reminder_delivery_key')).toEqual(new Set([stillInWindow, young]));
      // The row kept as the dedupe names no message any more; the young one is untouched.
      const ids = await query('select credit_card_due_reminder_delivery_key as k, provider_message_id as id from credit_card_due_reminder_delivery order by 1');
      expect(ids).toEqual([{ id: null, k: stillInWindow }, { id: 'msg-1', k: young }]);
      expect(old).toBeGreaterThan(0);
    });
  });

  describe('retired Enable Banking keys', () => {
    async function key(appuser: Appuser, input: { deletedAt?: Date; status?: EnableBankingCredentialStatus }) {
      const em = db.em();
      const row = em.create(EnableBankingCredential, { applicationId: randomUUID(), appuserKey: appuser, deletedAt: input.deletedAt, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', status: input.status ?? EnableBankingCredentialStatus.ACTIVE }, { partial: true });
      await em.flush();
      return row;
    }

    async function connectedWith(household: Household, credential: EnableBankingCredential, deletedAt?: Date) {
      const em = db.em();
      const id = randomUUID();
      const bankConnection = em.create(BankConnection, { appuserKey: household.appuser, externalId: id, provider: 'enable_banking', status: BankConnectionStatus.LINKED, tenantKey: household.tenant }, { partial: true });
      const row = em.create(EnableBankingConnection, { appuserKey: household.appuser, aspspCountry: 'PT', aspspName: 'Example Bank', bankConnectionKey: bankConnection, deletedAt, enableBankingCredentialKey: credential, sessionId: id, state: id, status: EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant }, { partial: true });
      await em.flush();
      return row;
    }

    it('deletes a key 30 days after it was removed, unless a live connection still signs with it', async () => {
      const household = await seedHousehold(db.em());
      const removed = await key(household.appuser, { deletedAt: daysAgo(31) });
      const recentlyRemoved = await key(household.appuser, { deletedAt: daysAgo(29) });
      const inUse = await key(household.appuser, { deletedAt: daysAgo(31) });
      await connectedWith(household, inUse);
      const endedConnection = await connectedWith(household, removed, daysAgo(31));
      const current = await key(household.appuser, {});

      expect(await purgeRetiredEnableBankingKeys(db.em(), now)).toEqual({ deleted: 1, more: false });
      expect(await remaining('enable_banking_credential', 'enable_banking_credential_key')).toEqual(new Set([recentlyRemoved, inUse, current].map((row) => row.enableBankingCredentialKey)));
      const [ended] = await query('select enable_banking_credential_key as k from enable_banking_connection where enable_banking_connection_key = ?', [endedConnection.enableBankingConnectionKey]);
      expect(ended?.['k'] ?? null).toBeNull();
    });

    it('deletes the keys of an account deleted over 30 days ago', async () => {
      const gone = await seedHousehold(db.em());
      const recent = await seedHousehold(db.em());
      await key(gone.appuser, {});
      const recentKey = await key(recent.appuser, {});
      await query('update appuser set deleted_at = ? where appuser_key = ?', [daysAgo(31), gone.appuser.appuserKey]);
      await query('update appuser set deleted_at = ? where appuser_key = ?', [daysAgo(29), recent.appuser.appuserKey]);

      expect(await purgeRetiredEnableBankingKeys(db.em(), now)).toEqual({ deleted: 1, more: false });
      expect(await remaining('enable_banking_credential', 'enable_banking_credential_key')).toEqual(new Set([recentKey.enableBankingCredentialKey]));
    });
  });

  describe('receipt scans', () => {
    async function scan(household: Household, fileKey: null | string, at: Date, fileUrl = '') {
      const em = db.em();
      const row = em.create(TransactionOCRImport, { appuserKey: household.appuser, fileKey: fileKey ?? undefined, fileUrl, status: TransactionOCRImportStatus.SUCCESS, tenantKey: household.tenant, tokensSpent: 10 }, { partial: true });
      await em.flush();
      await age('transaction_ocr_import', 'transaction_ocrimport_key', row.transactionOCRImportKey, 'created_at', at);
      return row.transactionOCRImportKey;
    }

    it('deletes a scan 30 days after it was read, with its image, unless the image became an attachment', async () => {
      const household = await seedHousehold(db.em());
      const old = await scan(household, 'wmocr/old.png', daysAgo(31));
      const legacy = await scan(household, null, daysAgo(31), 'https://files.example.test/files/wmocr/legacy.png');
      const attached = await scan(household, 'wmocr/attached.png', daysAgo(31));
      const young = await scan(household, 'wmocr/young.png', daysAgo(29));
      const em = db.em();
      const transaction = await addTransaction(em, household, { amount: -9, date: daysAgo(31), status: 'BOOKED' });
      em.create(TransactionAttachment, { contentType: 'image/png', fileName: 'receipt', sizeBytes: 10, storageKey: 'wmocr/attached.png', tenantKey: household.tenant, transactionKey: transaction, uploadedByAppuserKey: household.appuser }, { partial: true });
      await em.flush();

      const files = storage();
      expect(await purgeReceiptScans(db.em(), now, files)).toEqual({ deleted: 3, fileErrors: 0, files: 2, more: false });
      expect(await remaining('transaction_ocr_import', 'transaction_ocrimport_key')).toEqual(new Set([young]));
      expect(files.deleted.sort()).toEqual(['files/wmocr/legacy.png', 'files/wmocr/old.png']);
      expect([old, legacy, attached]).toHaveLength(3);
    });

    it('keeps a scan whose image the store would not remove, for the next run', async () => {
      const household = await seedHousehold(db.em());
      const stuck = await scan(household, 'wmocr/stuck.png', daysAgo(31));

      expect(await purgeReceiptScans(db.em(), now, storage({ failOn: 'wmocr/stuck.png' }))).toMatchObject({ deleted: 0, fileErrors: 1 });
      expect(await remaining('transaction_ocr_import', 'transaction_ocrimport_key')).toEqual(new Set([stuck]));
    });
  });

  describe('portfolio imports', () => {
    async function imported(household: Household, portfolio: Portfolio, s3Key: string, at: Date) {
      const em = db.em();
      const session = em.create(PortfolioImportSession, { appuserKey: household.appuser, correlationId: randomUUID(), portfolioKey: portfolio, s3Bucket: 'portfolios', s3Key, status: PortfolioImportSessionStatus.SUCCEEDED, tenantKey: household.tenant }, { partial: true });
      em.create(PortfolioImportRow, { portfolioImportSessionKey: session, rawJson: { symbol: 'AAPL' }, rowNumber: 1 }, { partial: true });
      await em.flush();
      await age('portfolio_import_session', 'portfolio_import_session_key', session.portfolioImportSessionKey, 'updated_at', at);
      return session.portfolioImportSessionKey;
    }

    it('deletes an import 30 days after it last changed, with its rows and its file, unless another import still uses the file', async () => {
      const household = await seedHousehold(db.em());
      const em = db.em();
      const portfolio = em.create(Portfolio, { currencyKey: household.currency, name: 'Shares', portfolioOwnerAppuserKey: household.appuser, tenantKey: household.tenant }, { partial: true });
      await em.flush();
      const old = await imported(household, portfolio, 'old.csv', daysAgo(31));
      const sharedOld = await imported(household, portfolio, 'shared.csv', daysAgo(31));
      const sharedYoung = await imported(household, portfolio, 'shared.csv', daysAgo(29));

      const files = storage();
      expect(await purgePortfolioImports(db.em(), now, files)).toEqual({ deleted: 2, fileErrors: 0, files: 1, more: false });
      expect(await remaining('portfolio_import_session', 'portfolio_import_session_key')).toEqual(new Set([sharedYoung]));
      expect(await query('select 1 from portfolio_import_row where portfolio_import_session_key in (?, ?)', [old, sharedOld])).toHaveLength(0);
      expect(files.deleted).toEqual(['portfolios/old.csv']);
    });
  });

  it('runs every step even when one fails, and names the one that failed', async () => {
    const household = await seedHousehold(db.em());
    const em = db.em();
    const row = em.create(AssistantAuditLog, { appuserKey: household.appuser, conversationId: randomUUID(), eventType: AssistantAuditEventType.TOOL_CALLED, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    await age('assistant_audit_log', 'assistant_audit_log_key', row.assistantAuditLogKey, 'created_at', daysAgo(31));
    await query('create or replace function wm_test_refuse() returns trigger language plpgsql as $$ begin raise exception \'refused\'; end $$');
    await query('create trigger wm_test_refuse before delete on sent_email for each row execute function wm_test_refuse()');
    const old = em.create(SentEmail, { appuser: household.appuser, emailType: 'wi:w:2026-W40', sentAt: daysAgo(40), status: 'sent' }, { partial: true });
    await em.flush();
    await age('sent_email', 'sent_email_key', old.sentEmailKey, 'updated_at', daysAgo(40));
    const warn = vi.fn();

    const result = await runRetentionPurge({ em: db.em(), logger: { info: vi.fn(), warn }, now, storage: storage() });

    await query('drop trigger wm_test_refuse on sent_email');
    expect(result.failed).toEqual(['sentEmails']);
    expect(result.steps['assistantAuditLog']).toEqual({ deleted: 1, more: false });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ step: 'sentEmails' }), expect.any(String));
  });
});
