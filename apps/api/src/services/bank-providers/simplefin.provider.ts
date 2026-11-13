import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { AccountFinancialInstitution, AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { SimplefinConnection } from '@entity/SimplefinConnection';
import { fetchAccountSet, SimplefinAccessRevokedError, type SimplefinClientDeps } from '@service/simplefin/simplefin-client';
import { decryptAccessUrl } from '@service/simplefin/simplefin-credential';
import { type MappedSimplefinAccount, type MappedSimplefinAccountSet, mapSimplefinAccountSet } from '@service/simplefin/simplefin-mapping';
import { BadRequestError } from '@utils/errors';
import logger from '@utils/logger';

import { ProviderReportedError, UserActionRequiredError } from './errors';
import type {
  BankAccountsResult,
  BankCompleteConnectionResult,
  BankConnectionInstitution,
  BankConnectionRef,
  BankInstitution,
  BankProvider,
  BankProviderBalance,
  BankProviderTransactions,
  BankSessionStatus,
  BankStartConnectionResult,
} from './types';

export const SIMPLEFIN_PROVIDER_ID = 'simplefin';

/** SimpleFIN Bridge serves at most 90 days per request; a day's margin keeps us inside it. */
const MAX_WINDOW_DAYS = 89;
/** A refresh re-reads a week before the last good sync, so late-posting rows are not missed. */
const REFRESH_OVERLAP_DAYS = 7;
/** How long one sync's account set serves its later balance and transaction calls. */
const ACCOUNT_SET_TTL_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SimplefinProviderDeps extends SimplefinClientDeps {
  em?: () => EntityManager;
  now?: () => Date;
}

interface CachedSet { fetchedAt: number; mapped: MappedSimplefinAccountSet }

/**
 * SimpleFIN behind the `BankProvider` interface. Off unless the operator lists `simplefin` in
 * `BANK_PROVIDERS` (see `registry.ts`).
 *
 * The connection is made with a setup token (`simplefin-connection.service.ts`), not the redirect
 * consent flow, so `listInstitutions`/`startConnection`/`completeConnection` are refused.
 *
 * **One request per sync.** SimpleFIN returns every account, balance and transaction in one
 * `GET /accounts`, and the SimpleFIN Bridge expects at most about 24 requests a day per access
 * token, so `listAccounts` makes the single request and the sync's balance and transaction calls
 * read that response, held in memory for the run. With the scheduler's minimum interval
 * (`BANK_SYNC_MIN_INTERVAL_HOURS`, default 20) a connection makes one or two requests a day.
 *
 * **Window.** The first sync asks for the last 89 days (the Bridge's limit is 90 per request); a
 * refresh asks from a week before the oldest account's last good transaction sync.
 *
 * **Revoked access.** A 403 from the access URL means the user disabled it: the connection
 * becomes `revoked`, which the scheduler skips, and the run fails as `consent_expired`.
 */
export class SimplefinProvider implements BankProvider {
  readonly consentExpires = false;
  readonly id = SIMPLEFIN_PROVIDER_ID;
  readonly institutionProvider = AccountFinancialInstitutionProvider.SIMPLEFIN;
  /**
   * SimpleFIN ids are stable and unique within an account, so rows use the generic provider-id
   * column under a `simplefin:` prefix, which the sync's id-first dedup and pending reconciliation
   * already handle. Enable Banking's column is for its own unstable-id rules.
   */
  readonly transactionIdentity = { column: 'nordigenInternalTransactionId' as const, prefix: 'nordigen' as const };

  private readonly cache = new Map<number, CachedSet>();

  constructor(private readonly deps: SimplefinProviderDeps = {}) {}

  completeConnection(): Promise<BankCompleteConnectionResult> {
    return Promise.reject(new BadRequestError('SimpleFIN connects with a setup token'));
  }

  /** The bank each connection's last sync found; several banks read as SimpleFIN itself. */
  async describeInstitutions(em: EntityManager, bankConnectionKeys: number[]): Promise<Map<number, BankConnectionInstitution>> {
    const institutions = new Map<number, BankConnectionInstitution>();
    if (bankConnectionKeys.length === 0) return institutions;
    const rows = await em.find(
      SimplefinConnection,
      { bankConnectionKey: { bankConnectionKey: { $in: bankConnectionKeys } } },
      { fields: ['bankConnectionKey', 'institutionId', 'institutionName'], filters: false },
    );
    for (const row of rows) {
      const key = keyOf(row.bankConnectionKey);
      if (!key || !row.institutionId) continue;
      institutions.set(key, { id: row.institutionId, name: row.institutionName ?? 'SimpleFIN' });
    }
    return institutions;
  }

  async getBalances(connection: BankConnectionRef, accountId: string): Promise<BankProviderBalance[]> {
    return (await this.accountOf(connection, accountId)).balances;
  }

  /** Never spends a request: a revoked access is already recorded on the connection by the 403. */
  async getSessionStatus(connection: BankConnectionRef): Promise<BankSessionStatus> {
    const row = await this.em().findOne(BankConnection, { bankConnectionKey: connection.bankConnectionKey });
    return row?.status === BankConnectionStatus.REVOKED ? 'ended' : 'unknown';
  }

  async getTransactions(connection: BankConnectionRef, accountId: string): Promise<BankProviderTransactions> {
    return (await this.accountOf(connection, accountId)).transactions;
  }

  async listAccounts(connection: BankConnectionRef): Promise<BankAccountsResult> {
    const mapped = await this.fetch(connection);
    await this.recordInstitutions(connection, mapped);
    return {
      accounts: mapped.accounts.map((entry) => entry.account),
      institutionId: mapped.connectionInstitution.id,
      ...(mapped.reportedErrorCode ? { reportedErrorCode: mapped.reportedErrorCode } : {}),
    };
  }

  listInstitutions(): Promise<BankInstitution[]> {
    return Promise.resolve([]);
  }

  async preflight(connection: BankConnectionRef): Promise<void> {
    const detail = await this.detailOf(connection);
    if (!detail) throw new UserActionRequiredError('SimpleFIN connection not found');
    try {
      decryptAccessUrl(detail);
    } catch {
      throw new UserActionRequiredError('The SimpleFIN access for this connection is not available; connect again');
    }
  }

  startConnection(): Promise<BankStartConnectionResult> {
    return Promise.reject(new BadRequestError('SimpleFIN connects with a setup token'));
  }

  private async accountOf(connection: BankConnectionRef, accountId: string): Promise<MappedSimplefinAccount> {
    const cached = this.cache.get(connection.bankConnectionKey);
    const mapped = cached && this.now().getTime() - cached.fetchedAt < ACCOUNT_SET_TTL_MS ? cached.mapped : await this.fetch(connection);
    const account = mapped.accounts.find((entry) => entry.account.externalId === accountId);
    if (!account) throw new ProviderReportedError('institution_unavailable', 'SimpleFIN did not return this account');
    if (account.reportedErrorCode) throw new ProviderReportedError(account.reportedErrorCode);
    return account;
  }

  private detailOf(connection: BankConnectionRef): Promise<null | SimplefinConnection> {
    return this.em().findOne(SimplefinConnection, { bankConnectionKey: { bankConnectionKey: connection.bankConnectionKey }, deletedAt: undefined }, { filters: false });
  }

  private em(): EntityManager {
    return this.deps.em ? this.deps.em() : DI.em.fork();
  }

  private async fetch(connection: BankConnectionRef): Promise<MappedSimplefinAccountSet> {
    const detail = await this.detailOf(connection);
    if (!detail) throw new UserActionRequiredError('SimpleFIN connection not found');
    let accessUrl: string;
    try {
      accessUrl = decryptAccessUrl(detail);
    } catch {
      throw new UserActionRequiredError('The SimpleFIN access for this connection is not available; connect again');
    }
    const now = this.now();
    const startDate = await this.windowStart(connection, now);
    let set;
    try {
      set = await fetchAccountSet(accessUrl, { startDate: Math.floor(startDate.getTime() / 1000) }, this.deps);
    } catch (error) {
      if (error instanceof SimplefinAccessRevokedError) await this.markRevoked(connection);
      throw error;
    }
    const mapped = mapSimplefinAccountSet(set);
    if (set.accounts.some((account) => (account.holdings?.length ?? 0) > 0)) {
      // Investment holdings are not synced yet (issue #22); their cash balance still is.
      logger.info({ bankConnectionKey: connection.bankConnectionKey }, 'SimpleFIN returned holdings; ignored until investment sync exists');
    }
    if (set.errlist.length > 0 || set.errors.length > 0) {
      // Codes only: SimpleFIN's message text is for the user's own screen, not our logs.
      logger.warn({ bankConnectionKey: connection.bankConnectionKey, codes: set.errlist.map((error) => error.code).slice(0, 20), deprecatedErrors: set.errors.length }, 'SimpleFIN reported errors with the account set');
    }
    this.cache.set(connection.bankConnectionKey, { fetchedAt: now.getTime(), mapped });
    for (const [key, entry] of this.cache) if (now.getTime() - entry.fetchedAt >= ACCOUNT_SET_TTL_MS) this.cache.delete(key);
    return mapped;
  }

  private async markRevoked(connection: BankConnectionRef): Promise<void> {
    try {
      const em = this.em();
      const row = await em.findOne(BankConnection, { bankConnectionKey: connection.bankConnectionKey, deletedAt: undefined });
      if (row && row.status !== BankConnectionStatus.REVOKED) {
        row.status = BankConnectionStatus.REVOKED;
        await em.flush();
      }
    } catch (error) {
      logger.warn({ bankConnectionKey: connection.bankConnectionKey, error: error instanceof Error ? error.name : 'unknown' }, 'Could not mark the SimpleFIN connection revoked');
    }
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  /** Institutions named after the bank, and the connection's own bank for sync-health. */
  private async recordInstitutions(connection: BankConnectionRef, mapped: MappedSimplefinAccountSet): Promise<void> {
    try {
      const em = this.em();
      const seen = new Set<string>();
      for (const entry of mapped.accounts) {
        const id = entry.account.institutionId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const existing = await em.findOne(AccountFinancialInstitution, { deletedAt: undefined, id, provider: AccountFinancialInstitutionProvider.SIMPLEFIN });
        if (existing) continue;
        em.create(AccountFinancialInstitution, { displayName: entry.institutionName, id, name: entry.institutionName, provider: AccountFinancialInstitutionProvider.SIMPLEFIN }, { partial: true });
      }
      const detail = await em.findOne(SimplefinConnection, { bankConnectionKey: { bankConnectionKey: connection.bankConnectionKey } }, { filters: false });
      if (detail) {
        detail.institutionId = mapped.connectionInstitution.id;
        detail.institutionName = mapped.connectionInstitution.name;
      }
      await em.flush();
    } catch (error) {
      // Labels only: the sync creates a bare institution itself if this failed.
      logger.warn({ bankConnectionKey: connection.bankConnectionKey, error: error instanceof Error ? error.name : 'unknown' }, 'Could not record SimpleFIN institutions');
    }
  }

  private async windowStart(connection: BankConnectionRef, now: Date): Promise<Date> {
    const earliest = new Date(now.getTime() - MAX_WINDOW_DAYS * DAY_MS);
    const accounts = await this.em().find(Account, { bankConnectionKey: { bankConnectionKey: connection.bankConnectionKey }, closed: false, deletedAt: undefined }, { fields: ['transactionsRefreshedAt'], filters: false });
    if (accounts.length === 0 || accounts.some((account) => !account.transactionsRefreshedAt)) return earliest;
    const oldest = Math.min(...accounts.map((account) => account.transactionsRefreshedAt?.getTime() ?? 0));
    return new Date(Math.max(earliest.getTime(), oldest - REFRESH_OVERLAP_DAYS * DAY_MS));
  }
}

function keyOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  return (value as undefined | { bankConnectionKey?: number })?.bankConnectionKey;
}

export const simplefinProvider = new SimplefinProvider();
