/**
 * Bank Sync Run — shared surface for the two requisition workers
 * (`account.initial-sync.worker.ts`, `account-auto-sync.worker.ts`).
 *
 * Per-flow differences stay in the workers: the `treatmentMode` vs
 * `treatmentEligible` shape of `incidents.finalizeAttempt`, whether bank-recovery
 * is scheduled, the Enable Banking credential precheck, and the per-flow error
 * classes the worker rethrows. This module owns the duplication that has no
 * per-flow reason to differ.
 *
 * Three exports:
 *  - {@link safeAccountCount} / {@link safeInstitutionId}: sanitize phase output
 *    for incident persistence.
 *  - {@link classifyBankSyncError}: replaces the previous
 *    `isPermanentBankSyncError` + `safeThrownErrorCode` pair in each worker, with
 *    one parameterized classification.
 *  - {@link runBankSyncPhases}: runs account + transaction phases with an
 *    optional pre-phase hook (the credential check used by auto-sync).
 */
export type BankSyncPhaseStatus = 'failed' | 'full_success' | 'partial';

/**
 * Status strings produced by the underlying sync services
 * (`account-initial-sync-account.service.ts`, `…-transaction.service.ts`).
 * The run module normalizes `'completed'` to its own `'full_success'`.
 */
export interface BankSyncPhaseResult {
  accountsTotal?: number;
  institutionIds?: string[];
  status: BankSyncPhaseStatus;
}

export type ServicePhaseStatus = 'completed' | 'failed' | 'partial';

/**
 * Sanitize an account-phase count for the incident record. pg-boss / Postgres
 * numeric columns reject non-integers; treat anything outside that as
 * "the phase didn't report a count" rather than crashing the finalize.
 */
export function safeAccountCount(value: number | undefined): number | undefined {
  return Number.isInteger(value) && (value ?? -1) >= 0 ? value : undefined;
}

/**
 * Sanitize an account-phase institution id list. The bank-sync incident column
 * is a single id (not an array) — accept only when exactly one valid id is
 * present, drop everything else. The regex matches the same character class
 * the persisted id column allows.
 */
export interface BankSyncErrorClassification {
  code: string;
  isPermanent: boolean;
}

export interface BankSyncExtraCodeRule {
  /** Predicate that decides whether this rule applies to the thrown error. */
  match: (error: unknown) => boolean;
  /** The bank-sync error code to record when the rule matches. */
  code: string;
}

export interface ClassifyBankSyncErrorOpts {
  /**
   * Error class names treated as permanent for this run (auto-sync adds
   * `EnableBankingCredentialInvalidError` to the initial-sync set).
   */
  permanentErrorNames: readonly string[];
  /**
   * Optional extra mappings applied first. The auto-sync worker uses one to
   * pin `EnableBankingCredentialInvalidError` to the `authentication` code
   * instead of the generic `invalid_requisition`.
   */
  extraCodes?: readonly BankSyncExtraCodeRule[];
}

export function safeInstitutionId(values: string[] | undefined): string | undefined {
  const unique = [...new Set(values ?? [])];
  return unique.length === 1 && /^[\w.:/-]{1,128}$/.test(unique[0] ?? '') ? unique[0] : undefined;
}

/**
 * Classify a thrown error into the bank-sync error taxonomy that
 * `bank-sync-incident.service.ts` understands. Replaces the previous
 * `isPermanentBankSyncError` + `safeThrownErrorCode` pair — both workers now
 * share this classifier and pass in their per-flow extra rules.
 */
export interface RunBankSyncPhasesInput {
  accountService: {
    syncAccountsForRequisition: (input: {
      correlationId: string;
      enableBankingConnectionKey: number;
      queueJobId: string;
    }) => Promise<{
      accountsTotal?: number;
      institutionIds?: string[];
      status: ServicePhaseStatus;
    }>;
  };
  correlationId: string;
  enableBankingConnectionKey: number;
  enqueue?: import('@service/queue/enqueue').Enqueue;
  fetchWindowDays: number;
  queueJobId: string;
  transactionService: {
    syncTransactionsForRequisition: (input: {
      correlationId: string;
      enableBankingConnectionKey: number;
      fetchWindowDays: number;
      queueJobId: string;
    }, deps?: { enqueue?: import('@service/queue/enqueue').Enqueue }) => Promise<{
      accountsTotal?: number;
      institutionIds?: string[];
      status: ServicePhaseStatus;
    }>;
  };
  /**
   * Optional hook that runs before the account phase. Auto-sync uses this for
   * the Enable Banking credential precheck; initial-sync omits it.
   */
  prePhase?: () => Promise<void>;
}

export function classifyBankSyncError(error: unknown, opts: ClassifyBankSyncErrorOpts): BankSyncErrorClassification {
  for (const rule of opts.extraCodes ?? []) {
    if (rule.match(error)) return { code: rule.code, isPermanent: true };
  }
  const name = error instanceof Error ? error.name : '';
  const status = (error as { status?: unknown }).status;
  const isPermanent = opts.permanentErrorNames.includes(name)
    || status === 400
    || status === 404;
  if (isPermanent) return { code: 'invalid_requisition', isPermanent: true };
  const code = (error as { code?: unknown }).code;
  if (code === 'ETIMEDOUT') return { code: 'timeout', isPermanent: false };
  if (code === 'ECONNREFUSED') return { code: 'provider_unavailable', isPermanent: false };
  return { code: 'internal', isPermanent: false };
}

const toPhaseResult = (input: {
  accountsTotal?: number;
  institutionIds?: string[];
  status: ServicePhaseStatus;
}): BankSyncPhaseResult => ({
  ...input,
  status: input.status === 'completed' ? 'full_success' : input.status,
});

export interface RunBankSyncPhasesResult {
  status: BankSyncPhaseStatus;
  /** Account-phase result (always present). */
  account: BankSyncPhaseResult;
  /** Transaction-phase result, or undefined if the account phase failed first. */
  transaction: BankSyncPhaseResult | undefined;
  /** Which phase failed first, if any. */
  failedAt: 'account' | 'transaction' | undefined;
}

/**
 * Run the account and transaction phases for a bank-sync run.
 *
 * Behaviour mirrors the prior inline flow in each worker:
 *  - optional `prePhase` (credential precheck)
 *  - account phase
 *  - transaction phase only if account succeeded
 *  - either phase `failed` returns immediately
 *  - `partial` collapses: any partial anywhere returns `partial`
 *  - both full success returns `full_success`
 *
 * The combined `status` matches what the workers used to compute inline so
 * downstream finalize callers can stay unchanged.
 */
export async function runBankSyncPhases(input: RunBankSyncPhasesInput): Promise<RunBankSyncPhasesResult> {
  await input.prePhase?.();
  const rawAccount = await input.accountService.syncAccountsForRequisition({
    correlationId: input.correlationId,
    enableBankingConnectionKey: input.enableBankingConnectionKey,
    queueJobId: input.queueJobId,
  });
  const account = toPhaseResult(rawAccount);
  if (account.status === 'failed') {
    return { account, failedAt: 'account', status: 'failed', transaction: undefined };
  }
  const rawTransaction = await input.transactionService.syncTransactionsForRequisition({
    correlationId: input.correlationId,
    enableBankingConnectionKey: input.enableBankingConnectionKey,
    fetchWindowDays: input.fetchWindowDays,
    queueJobId: input.queueJobId,
  }, { enqueue: input.enqueue });
  const transaction = toPhaseResult(rawTransaction);
  if (transaction.status === 'failed') {
    return { account, failedAt: 'transaction', status: 'failed', transaction };
  }
  if (account.status === 'partial' || transaction.status === 'partial') {
    return { account, failedAt: undefined, status: 'partial', transaction };
  }
  return { account, failedAt: undefined, status: 'full_success', transaction };
}
