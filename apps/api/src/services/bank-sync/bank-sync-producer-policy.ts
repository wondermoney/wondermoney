import type { BankSyncEnvironment } from '@app/analytics/bank-sync-contract';

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function bankSyncEnvironment(env: NodeJS.ProcessEnv = process.env): BankSyncEnvironment {
  const value = env['APP_ENV'] ?? env['DEPLOY_ENV'] ?? env['NODE_ENV'] ?? 'development';
  return value === 'production' || value === 'staging' ? value : 'development';
}

export function canonicalBankSyncDistinctId(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UUID.test(value)) {
    throw new Error('Bank sync owner must have a canonical lowercase external UUID');
  }
  return value;
}

/**
 * The treatment mode snapshotted onto an incident when a failure is persisted.
 * Bank recovery is now live for every incident owner — the RAD-178 rollout gate
 * (BANK_RECOVERY_MODE off/internal-allowlist/live + production-env guard) was
 * removed when the owner took bank recovery fully live. Kept as a function (and
 * keeping the `'internal-allowlist'` union member) so historical snapshots and
 * the incident-enrollment call sites stay type-compatible.
 */
export function bankRecoveryTreatmentMode(_distinctId: string, _env: NodeJS.ProcessEnv = process.env): 'internal-allowlist' | 'live' | null {
  return 'live';
}
