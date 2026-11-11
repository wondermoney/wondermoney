import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { DEFAULT_ACCOUNT_SYNC_INTERVAL_HOURS } from '@service/account/account-sync-interval';

import { bankConnectionRef, getBankProvider } from './registry';
import type { BankProvider } from './types';

/**
 * What a sync's failures mean for the connection itself, outside the sync phases:
 *  - {@link BankConnectionSyncState.checkConsent}: after every account was rejected (400/401),
 *    ask the provider whether the consent still holds. When it does not, the connection becomes
 *    `EXPIRED`, which the scheduler skips.
 *  - {@link BankConnectionSyncState.deferNextSync}: after a rate limit, keep the scheduler away
 *    until the provider's `Retry-After` has passed.
 *  - {@link BankConnectionSyncState.markAttempt}: before the provider call, record when the
 *    attempt happened, so a failure also waits out the minimum sync interval.
 *
 * It reads the provider-agnostic `BankConnection` row only; the provider implementation owns
 * whatever its session check needs.
 */
export interface BankConnectionSyncStateDeps {
  /** A fresh entity manager per call, so the flush touches only the connection. */
  em?: () => Promise<SyncStateEm> | SyncStateEm;
  now?: () => Date;
  /** Resolves the provider for a connection; defaults to the registry. */
  providerFor?: (id: string) => BankProvider | undefined;
}

export type ConsentCheckResult = 'active' | 'ended' | 'unknown';

interface SyncStateEm {
  findOne<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<null | T>;
  flush(): Promise<void>;
}

/** An absurd `Retry-After` must not park a connection for months. */
const MAX_DEFER_SECONDS = 7 * 24 * 60 * 60;

export class BankConnectionSyncState {
  constructor(private readonly deps: BankConnectionSyncStateDeps = {}) {}

  async checkConsent(bankConnectionKey: number): Promise<ConsentCheckResult> {
    const em = await this.em();
    const connection = await em.findOne(BankConnection, { bankConnectionKey, deletedAt: undefined });
    if (!connection) return 'unknown';
    const provider = (this.deps.providerFor ?? getBankProvider)(connection.provider);
    if (!provider) return 'unknown';
    const status = await provider.getSessionStatus(bankConnectionRef(connection));
    if (status === 'active') return 'active';
    if (status === 'ended') {
      if (connection.status === BankConnectionStatus.LINKED) {
        connection.status = BankConnectionStatus.EXPIRED;
        await em.flush();
      }
      return 'ended';
    }
    return 'unknown';
  }

  /** Returns the time the connection becomes eligible again, or undefined when it no longer exists. */
  async deferNextSync(bankConnectionKey: number, retryAfterSeconds?: number): Promise<Date | undefined> {
    const em = await this.em();
    const connection = await em.findOne(BankConnection, { bankConnectionKey, deletedAt: undefined });
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
  async markAttempt(bankConnectionKey: number): Promise<Date | undefined> {
    const em = await this.em();
    const connection = await em.findOne(BankConnection, { bankConnectionKey, deletedAt: undefined });
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

export const bankConnectionSyncState = new BankConnectionSyncState();

/** @deprecated Import `bankConnectionSyncState`; kept for callers during the provider migration. */
export const enableBankingConnectionSyncState = bankConnectionSyncState;
