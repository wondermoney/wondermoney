import type { Job } from 'pg-boss';

import { enqueueFinancialEmailCoordinator, enqueueFinancialEmailUser, type FinancialEmailCoordinatorPayload } from '@app/jobs/financial-emails.queue';
import { getLisbonBudgetPeriod, getLisbonWeeklyPeriod, parseScheduledFor } from '@service/budget/aggregation-periods';
import { FinancialEmailCandidateRepository } from '@service/email/financial-email-candidate.repository';
import { createWorkerEnqueueAdapter, type PartialBossLike } from '@service/queue/enqueue';

interface CoordinatorDeps {
  boss: Pick<PartialBossLike, 'send' | 'sendAfter'>;
  candidates?: Pick<FinancialEmailCandidateRepository, 'page'>;
  pageSize?: number;
}

export async function handleFinancialEmailCoordinator(job: Job<Partial<FinancialEmailCoordinatorPayload>>, stream: 'budget' | 'monthlyStory' | 'weekly', deps: CoordinatorDeps) {
  const createdOn = (job as Job<Partial<FinancialEmailCoordinatorPayload>> & { createdOn?: Date | string }).createdOn;
  const scheduledFor = job.data.scheduledFor ?? (createdOn instanceof Date ? createdOn.toISOString() : typeof createdOn === 'string' ? new Date(createdOn).toISOString() : undefined);
  if (!scheduledFor) throw new Error('financial_email_scheduled_for_required');
  const instant = parseScheduledFor(scheduledFor).toISOString();
  const period = stream === 'budget'
    ? getLisbonBudgetPeriod(instant).localDate.replaceAll('-', '')
    : stream === 'monthlyStory'
      ? monthlyStorySubjectPeriodKey(instant)
      : `${getLisbonWeeklyPeriod(instant).isoWeekYear}-W${String(getLisbonWeeklyPeriod(instant).isoWeek).padStart(2, '0')}`;
  const candidates = deps.candidates ?? new FinancialEmailCandidateRepository();
  const correlationId = job.data.correlationId ?? `${stream}:${period}:${job.id}`;
  const cursor = job.data.cursor ?? 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('financial_email_cursor_invalid');
  const pageSize = Math.min(Math.max(deps.pageSize ?? 250, 1), 500);
  let queued = 0;
  // `continued` MUST be decided from the raw row count, before deduping.
  //
  // The repository is asked for `pageSize` rows; the `Set` then collapses duplicates. If
  // the underlying query ever fans out (a join against household membership returns the
  // same `appuserKey` twice — entirely plausible for a two-member household), the deduped
  // array drops below `pageSize` and the coordinator concludes there is no next page.
  // Every candidate after that cursor then silently never receives the email, while the
  // run reports `reason: 'queued'` and looks clean.
  const rows = await candidates.page(stream, cursor, pageSize);
  const appusers = [...new Set(rows)];
  for (const appuserKey of appusers) {
    const jobId = await enqueueFinancialEmailUser({ enqueue: createWorkerEnqueueAdapter(deps.boss) }, stream, { appuserKey, correlationId, scheduledFor: instant }, period);
    if (jobId != null) queued += 1;
  }
  const nextCursor = appusers.reduce((maximum, appuserKey) => Math.max(maximum, appuserKey), cursor);
  const continued = rows.length >= pageSize && nextCursor > cursor;
  const continuationResult = continued ? await enqueueFinancialEmailCoordinator({ enqueue: createWorkerEnqueueAdapter(deps.boss) }, stream, { correlationId, cursor: nextCursor, scheduledFor: instant }, period) : undefined;
  const continuation = !continued ? 'not_needed' : continuationResult == null ? 'deduplicated' : 'queued';
  return { candidates: appusers.length, continuation, continued, nextCursor, pages: appusers.length ? 1 : 0, queued, reason: appusers.length === 0 ? 'no_candidates' : queued === 0 ? 'deduplicated' : 'queued' } as const;
}

/**
 * The monthlyStory cron fires on the 1st of the month, so the trigger month is the month that
 * just STARTED. The email narrates (and dedups on) the just-closed month — one month before the
 * trigger — matching the subject-period offset in aggregateMonthlyStory. Key format: `YYYYMM`.
 */
function monthlyStorySubjectPeriodKey(instant: string): string {
  const current = getLisbonBudgetPeriod(instant);
  const subjectMonth = current.month === 1 ? 12 : current.month - 1;
  const subjectYear = current.month === 1 ? current.year - 1 : current.year;
  return `${subjectYear}${String(subjectMonth).padStart(2, '0')}`;
}
