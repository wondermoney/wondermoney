import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { enqueueRuleApplyJob } from '@app/jobs/rule-apply.queue';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { Transaction } from '@entity/Transaction';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { Enqueue } from '@service/queue/enqueue';
import { ConflictError, ERROR_CODE, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

import { applyRulesToBatch, loadRuleSet, loadSingleRule, ruleRunTransactionsWhere } from './rule-application.service';
import type { EvaluableRule } from './rule-engine';

/**
 * Applying rules to a household's existing transactions, after the person has seen how many would
 * change: one rule judged on its own (as the rule editor's preview judges it, even when switched
 * off), or every active rule in run order, as on new transactions.
 *
 * What a run reaches: the household's live transactions, hidden ones included, that both the
 * member who starts it and each rule's owner can see. So a member never changes, or learns the
 * count of, the other member's private-account transactions, and a rule still never acts beyond
 * its owner's sight. Fields a person set by hand stay as they are (the engine's protection), and
 * every change is audited naming its rule, as a rule's change to a new transaction is.
 *
 * `countRuleRun` is the dry run: it goes through the same batches and the same write checks
 * without writing, so its count is exactly what the run then changes (barring edits in between).
 *
 * The run itself is a pg-boss job tracked by a `rule.apply` `BackgroundOperation`. It works in
 * batches of {@link BATCH_SIZE} by transaction key, each in its own database transaction that
 * also records the progress (`RuleRunProgress`, with the key to carry on after). A worker that
 * dies loses at most its open batch, and the retried job carries on from the last committed one.
 * A household has at most one run queued or going at a time.
 */

const RULE_RUN_OPERATION = 'rule.apply';
const BATCH_SIZE = 500;
/** Advisory-lock namespace that serialises a household's run starts (any constant int4). */
const START_LOCK_NAMESPACE = 650_066;

export interface RuleRunScope {
  /** The member applying the rules. */
  appuserKey: number;
  /** One rule, or null for every active rule. */
  ruleKey: null | number;
  tenantKey: number;
}

/** A run's `BackgroundOperation.progress`. */
export interface RuleRunOptions {
  /** Called after each committed batch; for tests. */
  afterBatch?: (progress: RuleRunProgress) => Promise<void>;
  batchSize?: number;
}

export interface RuleRunProgress {
  /** Transactions changed so far. */
  changed: number;
  /** The last transaction key done: the run carries on after it. */
  cursor: number;
  /** Transactions gone through so far. */
  processed: number;
  ruleKey: null | number;
  /** Transactions the run goes through, counted when it started. */
  total: number;
}

/** The rules a run applies; null when the one rule asked for is not the household's. */
async function rulesFor(em: EntityManager, scope: RuleRunScope): Promise<EvaluableRule[] | null> {
  if (scope.ruleKey === null) return loadRuleSet(em, scope.tenantKey);
  const rule = await loadSingleRule(em, scope.tenantKey, scope.ruleKey);
  return rule ? [rule] : null;
}

/** How many transactions applying the rules now would change. Writes nothing. */
export async function countRuleRun(em: EntityManager, scope: RuleRunScope, options: Pick<RuleRunOptions, 'batchSize'> = {}): Promise<number> {
  const rules = await rulesFor(em, scope);
  if (!rules) throw new NotFoundError('Rule not found');
  if (rules.length === 0) return 0;
  const limit = options.batchSize ?? BATCH_SIZE;
  let changed = 0;
  let afterKey = 0;
  for (;;) {
    const batch = await applyRulesToBatch(em, { afterKey, dryRun: true, limit, rules, tenantKey: scope.tenantKey, viewerAppuserKey: scope.appuserKey });
    changed += batch.changed;
    if (batch.lastKey === null || batch.scanned < limit) return changed;
    afterKey = batch.lastKey;
  }
}

/**
 * Queue a run and return its operation id, which `GET /v1/operations/:id` reports on. Throws
 * `NotFoundError` for a rule that is not the household's and `ConflictError`
 * (`rule_apply_in_progress`) while the household has another run queued or going.
 */
export async function startRuleRun(em: EntityManager, scope: RuleRunScope, deps: { enqueue: Enqueue }): Promise<{ operationId: string }> {
  if (!(await rulesFor(em, scope))) throw new NotFoundError('Rule not found');
  const total = await em.count(Transaction, ruleRunTransactionsWhere(em, scope.tenantKey, scope.appuserKey), { filters: { [HIDDEN_FILTER]: false } });

  const correlationId = await em.transactional(async (tx) => {
    const connection = tx.getConnection();
    await connection.execute('select pg_advisory_xact_lock(?, ?)', [START_LOCK_NAMESPACE, scope.tenantKey], 'all', tx.getTransactionContext());
    const running = await connection.execute<{ correlation_id: string }[]>(
      `select correlation_id from background_operation
       where operation_type = ? and tenant_key = ? and status in ('queued', 'running') and deleted_at is null limit 1`,
      [RULE_RUN_OPERATION, scope.tenantKey],
      'all',
      tx.getTransactionContext(),
    );
    if (running.length > 0) throw new ConflictError('Rules are already being applied to this household\'s transactions', ERROR_CODE.RULE_APPLY_IN_PROGRESS);
    const id = `${RULE_RUN_OPERATION}:${randomUUID()}`;
    const operation = await backgroundOperationService.createQueuedOperation(
      { appuserKey: scope.appuserKey, correlationId: id, operationType: RULE_RUN_OPERATION, resourceId: scope.ruleKey === null ? 'rules:all' : `rule:${scope.ruleKey}`, retryable: false, tenantKey: scope.tenantKey },
      tx,
    );
    operation.progress = { changed: 0, cursor: 0, processed: 0, ruleKey: scope.ruleKey, total } satisfies RuleRunProgress;
    await tx.flush();
    return id;
  });

  try {
    const jobId = await enqueueRuleApplyJob({ correlationId }, deps);
    if (!jobId) throw new Error('The rule.apply queue returned no job id');
    await backgroundOperationService.attachQueueJob(correlationId, String(jobId));
  } catch (error) {
    await backgroundOperationService.markFailed(correlationId, 'rule.apply:enqueue-failed');
    throw error;
  }
  return { operationId: correlationId };
}

/**
 * The job: claim the operation (or take it back after a dead worker), then work through the
 * remaining batches from the recorded cursor and finish it as succeeded. Returns false when the
 * operation was not this job's to run. Throws when a batch fails, after its rollback; the worker
 * decides whether pg-boss retries.
 */
export async function runRuleRun(em: EntityManager, correlationId: string, queueJobId: string, options: RuleRunOptions = {}): Promise<boolean> {
  const bg = backgroundOperationService;
  if (!(await bg.claimJobStartOrResume(correlationId, queueJobId))) return false;
  const operation = await em.fork().findOneOrFail(BackgroundOperation, { correlationId, deletedAt: null }, { populate: ['appuserKey', 'tenantKey'] });
  const appuserKey = operation.appuserKey?.appuserKey;
  const tenantKey = operation.tenantKey?.tenantKey;
  const recorded = operation.progress as unknown as null | RuleRunProgress | undefined;
  if (appuserKey === undefined || tenantKey === undefined || !recorded) throw new Error('rule.apply operation has no scope');
  let progress = recorded;

  const rules = await rulesFor(em, { appuserKey, ruleKey: progress.ruleKey, tenantKey });
  if (!rules) {
    await bg.finishJob(correlationId, queueJobId, { errorCode: 'rule.apply:rule-not-found', stage: 'rule.apply:failed', status: BackgroundOperationStatus.FAILED });
    return true;
  }

  const limit = options.batchSize ?? BATCH_SIZE;
  while (rules.length > 0) {
    let next = progress;
    const batch = await applyRulesToBatch(
      em,
      { afterKey: progress.cursor, dryRun: false, limit, rules, tenantKey, viewerAppuserKey: appuserKey },
      async (txEm, result) => {
        next = { ...progress, changed: progress.changed + result.changed, cursor: result.lastKey ?? progress.cursor, processed: progress.processed + result.scanned };
        if (!(await recordProgress(txEm, correlationId, queueJobId, next))) throw new Error('rule.apply operation is no longer this job\'s');
      },
    );
    progress = next;
    await options.afterBatch?.(progress);
    if (batch.lastKey === null || batch.scanned < limit) break;
  }

  // Transactions that arrived during the run were gone through too.
  const final = { ...progress, total: Math.max(progress.total, progress.processed) };
  await bg.heartbeatJob(correlationId, queueJobId, { progress: { ...final }, stage: 'rule.apply:complete' });
  if (!(await bg.finishJob(correlationId, queueJobId, { stage: 'rule.apply:complete', status: BackgroundOperationStatus.SUCCEEDED }))) throw new Error('rule.apply job could not finish');
  logger.info({ changed: final.changed, correlationId, processed: final.processed, ruleKey: final.ruleKey, tenantKey }, 'Applied rules to existing transactions');
  return true;
}

/** Record a batch's progress inside its database transaction, while the job still owns the run. */
async function recordProgress(txEm: EntityManager, correlationId: string, queueJobId: string, progress: RuleRunProgress): Promise<boolean> {
  const rows = await txEm.getConnection().execute(
    `UPDATE background_operation SET progress = ?, stage = 'rule.apply:running', last_heartbeat_at = NOW(), updated_at = NOW()
     WHERE correlation_id = ? AND queue_job_id = ? AND status = 'running' AND deleted_at IS NULL RETURNING background_operation_key`,
    [JSON.stringify(progress), correlationId, queueJobId],
    'all',
    txEm.getTransactionContext(),
  );
  return Array.isArray(rows) && rows.length > 0;
}
