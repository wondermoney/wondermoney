import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { decryptSecret, encryptSecret } from '@service/crypto/secret-encryption.service';

/**
 * One-time secrets for background operations (`OperationSecret`): what a request hands to the job
 * that does the work when the job needs it in clear and it must not ride in the job payload, the
 * operation's progress or a log line: a data export's password, and a restore's (which a dry run
 * reads and the restore itself then takes).
 *
 * `put` stores it encrypted under the server's credential key; `take` deletes and returns it in
 * one statement, so it is read at most once; `read` returns it and leaves it for a later step; an
 * expired secret is never returned. Whatever is
 * left behind (a job that never ran, a download never made) is deleted by `purgeExpired`, which
 * the worker runs every 15 minutes, or by `discard` when the operation is given up.
 */
export class OperationSecretService {
  private get now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  constructor(private readonly em: EntityManager, private readonly deps: { now?: () => Date } = {}) {}

  /** Store `secret` for `correlationId` until `expiresAt`. Throws if the operation already has one. */
  async put(correlationId: string, secret: string, expiresAt: Date): Promise<void> {
    const { authTag, ciphertext, iv, keyVersion } = encryptSecret(secret);
    await this.em.getConnection().execute(
      'insert into operation_secret (correlation_id, ciphertext, iv, auth_tag, key_version, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
      [correlationId, ciphertext, iv, authTag, keyVersion, expiresAt, this.now, this.now],
      'run',
      this.em.getTransactionContext(),
    );
  }

  /** The secret, once: it is deleted whether or not it has expired. Null when there is none. */
  async take(correlationId: string): Promise<null | string> {
    const rows = await this.em.getConnection().execute<{ auth_tag: string; ciphertext: string; expires_at: Date | string; iv: string; key_version: number }[]>(
      'delete from operation_secret where correlation_id = ? returning auth_tag, ciphertext, iv, key_version, expires_at',
      [correlationId],
      'all',
      this.em.getTransactionContext(),
    );
    const row = rows[0];
    if (!row || new Date(row.expires_at).getTime() <= this.now.getTime()) return null;
    return decryptSecret({ authTag: row.auth_tag, ciphertext: row.ciphertext, iv: row.iv, keyVersion: row.key_version });
  }

  /** The secret, left in place for a later `take`. Null when there is none or it has expired. */
  async read(correlationId: string): Promise<null | string> {
    const rows = await this.em.getConnection().execute<{ auth_tag: string; ciphertext: string; expires_at: Date | string; iv: string; key_version: number }[]>(
      'select auth_tag, ciphertext, iv, key_version, expires_at from operation_secret where correlation_id = ?',
      [correlationId],
      'all',
      this.em.getTransactionContext(),
    );
    const row = rows[0];
    if (!row || new Date(row.expires_at).getTime() <= this.now.getTime()) return null;
    return decryptSecret({ authTag: row.auth_tag, ciphertext: row.ciphertext, iv: row.iv, keyVersion: row.key_version });
  }

  /** Delete the secrets of operations that will not run. */
  async discard(correlationIds: readonly string[]): Promise<void> {
    if (correlationIds.length === 0) return;
    await this.em.getConnection().execute('delete from operation_secret where correlation_id in (?)', [correlationIds], 'all', this.em.getTransactionContext());
  }

  /** Delete every expired secret; returns how many. */
  async purgeExpired(): Promise<number> {
    const rows = await this.em.getConnection().execute<{ operation_secret_key: number }[]>(
      'delete from operation_secret where expires_at <= ? returning operation_secret_key',
      [this.now],
      'all',
      this.em.getTransactionContext(),
    );
    return rows.length;
  }
}

/** The worker's sweep, run with background-operation recovery every 15 minutes. */
export const purgeExpiredOperationSecrets = (): Promise<number> => new OperationSecretService(DI.em).purgeExpired();
