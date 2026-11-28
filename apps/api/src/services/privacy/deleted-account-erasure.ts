import type { EntityManager } from '@mikro-orm/postgresql';
import type { Logger } from 'pino';

import { retentionCutoff } from './retention-period';
import type { RetentionStorage } from './retention-storage';
import { eraseRows, ErasureRefused, type ErasureSchema, loadErasureSchema, type StoredFile, TENANT_TABLE } from './row-erasure';

/**
 * Thirty days after an account deletion (`account-deletion.service.ts`), erases what it left:
 *
 * - **The households it dissolved.** Deleting an owner's account ends every other membership of
 *   the households they owned. Each such household still without an active member is erased:
 *   every row that belongs to it, in every table, and the files stored for them (attachments,
 *   receipt images, imported files). A household someone is an active member of again is left
 *   alone, and erasing one never touches a row of any other household (`row-erasure.ts`).
 * - **The anonymised account record** (`appuser`, with its placeholder name and address), with
 *   every row that is the person's alone. When the person was a member of a household that goes
 *   on, the accounts and transactions they added stay with it and point at the record, so the
 *   record stays as that pointer: its key, the placeholder name and address, its language and
 *   currency. Its preferences and its sign-in and onboarding times are cleared.
 *
 * One person per transaction, so a refusal or a failure for one leaves the others to go ahead.
 * Their files are removed before the transaction commits: when the store refuses one, the person
 * is rolled back and retried the next day, so no file is left behind without its row.
 */

export interface DeletedAccountErasureInput {
  em: EntityManager;
  logger?: Pick<Logger, 'info' | 'warn'>;
  /**
   * People whose erasure runs per run, erased, refused or failed (those only checked, with nothing
   * to erase, do not count); the rest wait for the next run.
   */
  maxAccounts?: number;
  now: Date;
  storage: RetentionStorage;
}

export interface DeletedAccountErasureResult {
  /** Anonymised account records deleted. */
  accounts: number;
  /** People whose erasure failed or was refused; retried the next run. */
  failed: number;
  files: number;
  /** Households erased. */
  households: number;
  /** Anonymised records kept as the pointer a household still has to them. */
  keptAccounts: number;
  /** Households of a deleted owner that have an active member again. */
  keptHouseholds: number;
  more: boolean;
  rows: number;
}

/**
 * Household tables whose rows are one person's own, not the household's: they carry the household
 * key only because it was written beside the owner. An Enable Banking key is personal (Restricted
 * Production ties an application to one person's own bank logins) and follows the person to their
 * next household. Erasing a household detaches these rows from it instead, for every owner who is
 * not the deleted account; the deleted account's own go with it.
 */
const PERSONAL_ROWS = [{ owner: 'appuser_key', table: 'enable_banking_credential' }] as const;

const DEFAULT_MAX_ACCOUNTS = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

interface OneOutcome {
  account: boolean;
  files: number;
  households: number;
  keptHouseholds: number;
  rows: number;
}

export async function eraseDeletedAccounts(input: DeletedAccountErasureInput): Promise<DeletedAccountErasureResult> {
  const maxAccounts = input.maxAccounts ?? DEFAULT_MAX_ACCOUNTS;
  const result: DeletedAccountErasureResult = { accounts: 0, failed: 0, files: 0, households: 0, keptAccounts: 0, keptHouseholds: 0, more: false, rows: 0 };
  const candidates = rotate(await deletedAccounts(input.em, retentionCutoff(input.now)), input.now);
  if (candidates.length === 0) return result;
  const schema = await loadErasureSchema(input.em.fork());

  // Every person whose erasure ran counts, refused or failed too: a run's work stays bounded.
  let attempted = 0;
  for (const appuserKey of candidates) {
    if (attempted >= maxAccounts) {
      result.more = true;
      return result;
    }
    try {
      const outcome = await eraseOne(input.em.fork(), schema, appuserKey, input.storage);
      result.households += outcome.households;
      result.keptHouseholds += outcome.keptHouseholds;
      result.rows += outcome.rows;
      result.files += outcome.files;
      if (outcome.account) result.accounts += 1;
      else result.keptAccounts += 1;
      if (outcome.account || outcome.households > 0) attempted += 1;
    } catch (error) {
      attempted += 1;
      result.failed += 1;
      input.logger?.warn(
        { appuserKey, error: error instanceof Error ? error.message : String(error), refused: error instanceof ErasureRefused },
        'Erasing a deleted account failed',
      );
    }
  }
  return result;
}

/** Every account deleted (and anonymised) before the cutoff. */
async function deletedAccounts(em: EntityManager, cutoff: Date): Promise<number[]> {
  const rows = await em.getConnection().execute<{ appuser_key: number }[]>(
    `select appuser_key from appuser
      where deleted_at is not null and deleted_at < ? and record_active = false
        and external_user_id = 'deleted:' || appuser_key::text
      order by appuser_key`,
    [cutoff],
  );
  return rows.map((row) => row.appuser_key);
}

async function eraseOne(em: EntityManager, schema: ErasureSchema, appuserKey: number, storage: RetentionStorage): Promise<OneOutcome> {
  return em.transactional(async (tx) => {
    const connection = tx.getConnection();
    const context = tx.getTransactionContext();
    const exec = <T>(sql: string, params: unknown[], method: 'all' | 'run' = 'all') => connection.execute(sql, params, method, context) as Promise<T>;
    const outcome: OneOutcome = { account: false, files: 0, households: 0, keptHouseholds: 0, rows: 0 };
    const files: StoredFile[] = [];

    await exec('select appuser_key from appuser where appuser_key = ? for update', [appuserKey]);
    const owned = await exec<{ tenant_key: number }[]>('select tenant_key from tenant where owner_appuser_key = ? order by tenant_key for update', [appuserKey]);
    for (const { tenant_key: tenantKey } of owned) {
      const members = await exec<unknown[]>('select 1 from appuser_tenant where tenant_key = ? and record_active = true and deleted_at is null limit 1', [tenantKey]);
      if (members.length > 0) {
        outcome.keptHouseholds += 1;
        continue;
      }
      for (const { owner, table } of PERSONAL_ROWS) {
        await exec(`update ${table} set tenant_key = null where tenant_key = ? and ${owner} <> ?`, [tenantKey, appuserKey], 'run');
      }
      const erased = await eraseRows(tx, schema, { params: [tenantKey], table: TENANT_TABLE, where: 'r.tenant_key = ?' }, { allowedTenantKeys: [tenantKey] });
      outcome.households += 1;
      outcome.rows += erased.rows;
      files.push(...erased.files);
    }

    // Still a member of, or the owner of, a household that goes on: the record is its pointer.
    const anchored = await exec<unknown[]>(
      `select 1 where exists (select 1 from appuser_tenant where appuser_key = ?) or exists (select 1 from tenant where owner_appuser_key = ?)`,
      [appuserKey, appuserKey],
    );
    if (anchored.length === 0) {
      await exec('savepoint wm_erasure_account', [], 'run');
      try {
        const erased = await eraseRows(tx, schema, { params: [appuserKey], table: 'public.appuser', where: 'r.appuser_key = ?' }, { allowedTenantKeys: [] });
        await exec('release savepoint wm_erasure_account', [], 'run');
        outcome.account = true;
        outcome.rows += erased.rows;
        files.push(...erased.files);
      } catch (error) {
        if (!(error instanceof ErasureRefused)) throw error;
        await exec('rollback to savepoint wm_erasure_account', [], 'run');
      }
    }
    if (!outcome.account) {
      await exec(
        `update appuser set preferences = '{}'::jsonb, email_authenticated = null, mobile_authenticated = null,
                onboarding_completed_at = null, onboarding_completed_version = null
          where appuser_key = ? and (preferences <> '{}'::jsonb or email_authenticated is not null or mobile_authenticated is not null
                or onboarding_completed_at is not null or onboarding_completed_version is not null)`,
        [appuserKey],
        'run',
      );
    }

    // Before the commit: a file the store refuses rolls this person back, to be retried.
    if (storage.isEnabled()) {
      for (const file of files) await storage.deleteObject(file.bucket ?? storage.filesBucket(), file.key);
      outcome.files = files.length;
    }
    return outcome;
  });
}

/**
 * The candidates, starting at a place that moves on each day: someone whose erasure keeps being
 * refused (it needs a person to look) does not take the same place at the front of every run.
 */
function rotate(keys: number[], now: Date): number[] {
  if (keys.length === 0) return keys;
  const start = Math.floor(now.getTime() / DAY_MS) % keys.length;
  return [...keys.slice(start), ...keys.slice(0, start)];
}
