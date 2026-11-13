import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { DEFAULT_ACCOUNT_SYNC_INTERVAL_HOURS } from '@service/account/account-sync-interval';
import logger from '@utils/logger';

import { createEnableBankingClient, type EnableBankingClient } from './enable-banking-client.service';
import { enableBankingCredentialService } from './enable-banking-credential.service';

/**
 * What a sync's failures mean for the connection itself, outside the sync phases:
 *  - {@link EnableBankingConnectionSyncState.checkConsent}: after every account was rejected
 *    (400/401), ask Enable Banking whether the session is still `AUTHORIZED`. When it is not, the
 *    bank ended the consent early: the connection becomes `EXPIRED`, which the scheduler skips.
 *  - {@link EnableBankingConnectionSyncState.deferNextSync}: after a rate limit, keep the
 *    scheduler away until the provider's `Retry-After` has passed.
 *  - {@link EnableBankingConnectionSyncState.markAttempt}: before the provider call, record when
 *    the attempt happened, so a failure also waits out the minimum sync interval.
 */
export type ConsentCheckResult = 'active' | 'ended' | 'unknown';

export interface EnableBankingConnectionSyncStateDeps {
  /** Builds the provider client for a connection; defaults to its own decrypted credential. */
  clientFor?: (connection: EnableBankingConnection) => Pick<EnableBankingClient, 'getSession'>;
  /** A fresh entity manager per call, so the flush touches only the connection. */
  em?: () => Promise<SyncStateEm> | SyncStateEm;
  now?: () => Date;
}

interface SyncStateEm {
  findOne<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<null | T>;
  flush(): Promise<void>;
}

/** An absurd `Retry-After` must not park a connection for months. */
const MAX_DEFER_SECONDS = 7 * 24 * 60 * 60;

export class EnableBankingConnectionSyncState {
  constructor(private readonly deps: EnableBankingConnectionSyncStateDeps = {}) {}

  async checkConsent(enableBankingConnectionKey: number): Promise<ConsentCheckResult> {
    const em = await this.em();
    const connection = await em.findOne(EnableBankingConnection, { deletedAt: undefined, enableBankingConnectionKey }, { populate: ['enableBankingCredentialKey'] });
    if (!connection?.sessionId) return 'unknown';
    let status: string;
    try {
      ({ status } = await (this.deps.clientFor ?? defaultClientFor)(connection).getSession(connection.sessionId));
    } catch (error) {
      // The session lookup failing (our credential, an outage) says nothing about the consent.
      logger.warn({ enableBankingConnectionKey, error: error instanceof Error ? error.name : 'unknown' }, 'Enable Banking session check failed');
      return 'unknown';
    }
    if (status === 'AUTHORIZED') return 'active';
    if (connection.status === EnableBankingConnectionStatus.LINKED) {
      connection.status = EnableBankingConnectionStatus.EXPIRED;
      await em.flush();
    }
    logger.info({ enableBankingConnectionKey, sessionStatus: status }, 'Enable Banking consent ended early; connection expired');
    return 'ended';
  }

  /** Returns the time the connection becomes eligible again, or undefined when it no longer exists. */
  async deferNextSync(enableBankingConnectionKey: number, retryAfterSeconds?: number): Promise<Date | undefined> {
    const em = await this.em();
    const connection = await em.findOne(EnableBankingConnection, { deletedAt: undefined, enableBankingConnectionKey });
    if (!connection) return undefined;
    const seconds = Math.min(retryAfterSeconds ?? DEFAULT_ACCOUNT_SYNC_INTERVAL_HOURS * 60 * 60, MAX_DEFER_SECONDS);
    const now = (this.deps.now ?? (() => new Date()))();
    connection.nextEligibleSyncAt = new Date(now.getTime() + seconds * 1000);
    await em.flush();
    return connection.nextEligibleSyncAt;
  }

  /**
   * Records that a sync is about to reach the bank, before the provider call, so the scheduler
   * waits the minimum interval from the attempt even when the call fails. Returns the recorded
   * time, or undefined when the connection no longer exists.
   */
  async markAttempt(enableBankingConnectionKey: number): Promise<Date | undefined> {
    const em = await this.em();
    const connection = await em.findOne(EnableBankingConnection, { deletedAt: undefined, enableBankingConnectionKey });
    if (!connection) return undefined;
    connection.lastSyncAttemptAt = (this.deps.now ?? (() => new Date()))();
    await em.flush();
    return connection.lastSyncAttemptAt;
  }

  private async em(): Promise<SyncStateEm> {
    if (this.deps.em) return this.deps.em();
    const { DI } = await import('@app/database/di');
    return DI.em.fork();
  }
}

function defaultClientFor(connection: EnableBankingConnection) {
  return createEnableBankingClient(enableBankingCredentialService.decryptForConnection(connection));
}

export const enableBankingConnectionSyncState = new EnableBankingConnectionSyncState();
