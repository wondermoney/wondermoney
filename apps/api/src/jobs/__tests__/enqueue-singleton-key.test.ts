import { describe, expect, it } from 'vitest';

import { LifecycleCampaign } from '@service/lifecycle/lifecycle-types';

import { enqueueAccountAutoSyncRequisitionJob } from '../account-auto-sync.queue';
import { enqueueAccountCsvImportJob } from '../account-csv-import.queue';
import { enqueueAccountInitialSyncJob } from '../account-initial-sync.queue';
import { enqueueBankRecoveryAfter } from '../bank-recovery.queue';
import { enqueueDemoDataRefreshJob } from '../demo-data-refresh.queue';
import { enqueueFinancialEmailCoordinator, enqueueFinancialEmailUser } from '../financial-emails.queue';
import { enqueueLifecycleSend } from '../lifecycle-send.queue';
import { enqueuePortfolioCsvImportConfirmedJob } from '../portfolio-csv-import-confirmed.queue';
import { enqueuePortfolioCsvParsePreviewJob } from '../portfolio-csv-parse-preview.queue';
import { enqueuePortfolioSnapshotManualJob } from '../portfolio-snapshot.queue';
import { enqueueFoundationJob } from '../queue';
import { enqueueTransactionEnrichmentGptJob } from '../transaction-enrichment.queue';

/**
 * Enqueue idempotency, asserted once.
 *
 * pg-boss dedups an in-flight job by `singletonKey`. Every producer in this repo can fire more
 * than once for the same logical unit of work — a retried HTTP request, a redelivered webhook, a
 * coordinator fan-out that resumes from a cursor — so a missing or empty `singletonKey` means
 * duplicate emails, duplicate imports, or duplicate bank syncs reaching a real user.
 *
 * This replaces ~15 per-queue `*.queue.test.ts` files that each restated their own module's
 * option literal back at it (`expect(createQueue).toHaveBeenCalledWith(QUEUE, QUEUE_OPTIONS)`).
 * Those could only fail when someone *changed* a value, never when a value was wrong. This one
 * asserts the single property that has a user-visible consequence, and — because the table is
 * exhaustive — a newly added `enqueue*` helper that forgets `singletonKey` fails here.
 *
 * Adding a queue? Add a row. If the new helper deliberately omits `singletonKey`, add it to
 * `DELIBERATELY_UNKEYED` with the reason, so the omission is a reviewed decision rather than an
 * oversight.
 */

interface CapturedSend {
  data: unknown;
  options: Record<string, unknown> | undefined;
  queue: string;
}

const createRecorder = () => {
  const calls: CapturedSend[] = [];
  const record = (...args: unknown[]) => {
    const [queue, data, options] = args as [string, unknown, Record<string, unknown> | undefined];
    calls.push({ data, options, queue });
    return Promise.resolve('job-id');
  };

  return {
    calls,
    // `send(queue, data, options)` and `sendAfter(queue, data, options, date)` both carry the
    // options bag in position 3, so one recorder serves both shapes.
    send: record,
    sendAfter: record,
  };
};

type Recorder = ReturnType<typeof createRecorder>;

/**
 * Each helper declares its own structural boss/deps type (`PgBossLike`, `PgBossSendAfterLike`, an
 * inline `{ send }` literal, …) and they are mutually incompatible at the type level even though
 * one recorder satisfies all of them at runtime. Funnel the casts through these helpers so
 * the table rows below stay readable.
 */
const asDeps = (recorder: Recorder) => ({ enqueue: recorder, send: recorder.send });
/** Producers migrated onto the `Enqueue` seam take `{ enqueue }`; the recorder's send/sendAfter match it. */
const asEnqueueDeps = (recorder: Recorder) => ({ enqueue: recorder });

const SCHEDULED_FOR = new Date('2026-01-15T09:00:00.000Z');
const SCHEDULED_FOR_ISO = '2026-01-15T09:00:00+00:00';
const INCIDENT_ID = '3f1d5b9a-6c2e-4d7b-8a1f-9e0c2b4d6a80';

/**
 * Helpers that intentionally send without a `singletonKey`, with the reason they are safe.
 * Keeping them in the table (rather than omitting them) means the exemption is visible and the
 * table stays a complete inventory of every producer.
 */
const DELIBERATELY_UNKEYED: Record<string, string> = {
  // The daily run is deduped by its *schedule* singletonKey (DEMO_DATA_REFRESH_SINGLETON_KEY) and
  // the queue is policy:'exclusive'. The ad-hoc call is an operator-triggered refresh of the demo
  // tenant only, where re-running on demand is the point and no customer data is touched.
  enqueueDemoDataRefreshJob: 'deduped by the cron schedule key + exclusive queue policy; ad-hoc reruns are intentional',
};

const ENQUEUE_HELPERS: { invoke: (recorder: Recorder) => Promise<unknown>; name: string }[] = [
  {
    invoke: (r) =>
      enqueueAccountAutoSyncRequisitionJob(
        {
          correlationId: 'account.auto-sync.requisition:run-1:42',
          incidentId: INCIDENT_ID,
          nordigenRequisitionKey: '42',
          requisitionId: 'req-1',
          scheduleRunId: 'run-1',
        },
        asDeps(r),
      ),
    name: 'enqueueAccountAutoSyncRequisitionJob',
  },
  {
    invoke: (r) =>
      enqueueAccountCsvImportJob(
        { accountKey: 7, bucket: 'bucket', correlationId: 'account.csv-import:7:abc', key: 'uploads/a.csv' },
        asDeps(r),
      ),
    name: 'enqueueAccountCsvImportJob',
  },
  {
    invoke: (r) =>
      enqueueAccountInitialSyncJob(
        {
          correlationId: 'account.initial-sync:42',
          incidentId: INCIDENT_ID,
          nordigenRequisitionKey: '42',
          requisitionId: 'req-1',
        },
        asDeps(r),
      ),
    name: 'enqueueAccountInitialSyncJob',
  },
  {
    invoke: (r) =>
      enqueueBankRecoveryAfter({ deliveryKey: 5, incidentId: INCIDENT_ID, templateVersion: 'v1' }, asEnqueueDeps(r), SCHEDULED_FOR),
    name: 'enqueueBankRecoveryAfter',
  },
  {
    invoke: (r) => Promise.resolve(enqueueDemoDataRefreshJob({ correlationId: 'demo-1' }, asEnqueueDeps(r))),
    name: 'enqueueDemoDataRefreshJob',
  },
  {
    invoke: (r) =>
      enqueueFinancialEmailCoordinator(asEnqueueDeps(r), 'budget', { correlationId: 'corr-1', scheduledFor: SCHEDULED_FOR_ISO }, '2026-01-15'),
    name: 'enqueueFinancialEmailCoordinator',
  },
  {
    invoke: (r) =>
      enqueueFinancialEmailUser(
        asEnqueueDeps(r),
        'budget',
        { appuserKey: 11, correlationId: 'corr-1', scheduledFor: SCHEDULED_FOR_ISO },
        '2026-01-15',
      ),
    name: 'enqueueFinancialEmailUser',
  },
  {
    invoke: (r) => Promise.resolve(enqueueFoundationJob({ correlationId: 'foundation-1' }, asEnqueueDeps(r))),
    name: 'enqueueFoundationJob',
  },
  {
    invoke: (r) =>
      enqueueLifecycleSend(
        { appuserKey: 11, campaign: LifecycleCampaign.DATA_HEALTH, step: 'consent_expiring', templateVersion: 'v1' },
        asEnqueueDeps(r),
        SCHEDULED_FOR,
      ),
    name: 'enqueueLifecycleSend',
  },
  {
    invoke: (r) => enqueuePortfolioCsvImportConfirmedJob({ correlationId: 'corr-1', importSessionId: 9 }, asEnqueueDeps(r)),
    name: 'enqueuePortfolioCsvImportConfirmedJob',
  },
  {
    invoke: (r) => enqueuePortfolioCsvParsePreviewJob({ correlationId: 'corr-1', importSessionId: 9 }, asEnqueueDeps(r)),
    name: 'enqueuePortfolioCsvParsePreviewJob',
  },
  {
    invoke: (r) => Promise.resolve(enqueuePortfolioSnapshotManualJob({ correlationId: 'corr-1', portfolioId: 9 }, asEnqueueDeps(r))),
    name: 'enqueuePortfolioSnapshotManualJob',
  },
  {
    invoke: (r) =>
      enqueueTransactionEnrichmentGptJob(
        {
          correlationId: 'corr-1',
          idempotencyKey: 'txn-enrichment:1:v1',
          modelVersion: 'DeepSeek-V4-Flash',
          promptVersion: 'v1',
          transactionEnrichmentKey: 1,
        },
        asDeps(r),
      ),
    name: 'enqueueTransactionEnrichmentGptJob',
  },
];

describe('enqueue idempotency', () => {
  it.each(ENQUEUE_HELPERS)('$name enqueues exactly one job', async ({ invoke }) => {
    const recorder = createRecorder();

    await invoke(recorder);

    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]?.queue).toEqual(expect.any(String));
  });

  it.each(ENQUEUE_HELPERS.filter(({ name }) => !(name in DELIBERATELY_UNKEYED)))(
    '$name passes a non-empty singletonKey so a duplicate producer run is deduped',
    async ({ invoke, name }) => {
      const recorder = createRecorder();

      await invoke(recorder);

      const singletonKey = recorder.calls[0]?.options?.['singletonKey'];

      expect(typeof singletonKey, `${name} must send a singletonKey`).toBe('string');
      expect(String(singletonKey).length, `${name} must send a non-empty singletonKey`).toBeGreaterThan(0);
    },
  );

  it.each(ENQUEUE_HELPERS.filter(({ name }) => name in DELIBERATELY_UNKEYED))(
    '$name is a reviewed exception and sends no singletonKey',
    async ({ invoke, name }) => {
      const recorder = createRecorder();

      await invoke(recorder);

      const reason = DELIBERATELY_UNKEYED[name];

      expect(reason, `${name} must document why it omits a singletonKey`).toBeTruthy();
      expect(recorder.calls[0]?.options?.['singletonKey']).toBeUndefined();
    },
  );

  it('derives a distinct singletonKey per logical unit of work', async () => {
    // A constant key would dedup unrelated jobs into one. Spot-check the two highest-fan-out
    // producers: per-user financial email delivery, and per-transaction GPT enrichment.
    const emails = createRecorder();
    await enqueueFinancialEmailUser(asEnqueueDeps(emails), 'budget', { appuserKey: 11, correlationId: 'c', scheduledFor: SCHEDULED_FOR_ISO }, '2026-01-15');
    await enqueueFinancialEmailUser(asEnqueueDeps(emails), 'budget', { appuserKey: 12, correlationId: 'c', scheduledFor: SCHEDULED_FOR_ISO }, '2026-01-15');

    expect(emails.calls[0]?.options?.['singletonKey']).not.toBe(emails.calls[1]?.options?.['singletonKey']);

    const enrichment = createRecorder();
    const gptJob = { correlationId: 'c', modelVersion: 'm', promptVersion: 'p', transactionEnrichmentKey: 1 };
    await enqueueTransactionEnrichmentGptJob({ ...gptJob, idempotencyKey: 'a' }, asDeps(enrichment));
    await enqueueTransactionEnrichmentGptJob({ ...gptJob, idempotencyKey: 'b' }, asDeps(enrichment));

    expect(enrichment.calls[0]?.options?.['singletonKey']).not.toBe(enrichment.calls[1]?.options?.['singletonKey']);
  });

  it('reuses the same singletonKey when the same unit of work is enqueued twice', async () => {
    // The dedup property itself: a retried producer must produce an identical key.
    const recorder = createRecorder();
    const job = { correlationId: 'account.initial-sync:42', incidentId: INCIDENT_ID, nordigenRequisitionKey: '42', requisitionId: 'req-1' };

    await enqueueAccountInitialSyncJob(job, asDeps(recorder));
    await enqueueAccountInitialSyncJob(job, asDeps(recorder));

    expect(recorder.calls[0]?.options?.['singletonKey']).toBe(recorder.calls[1]?.options?.['singletonKey']);
  });
});
