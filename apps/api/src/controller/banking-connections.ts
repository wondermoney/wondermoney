import { QueryOrder } from '@mikro-orm/core';
import type { Request, Response } from 'express';

import { bankConnectionSyncsRequestSchema } from '@app/validators/banking';
import { zParse } from '@app/validators/parser';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { NordigenRequisition, NordigenRequisitionStatus } from '@entity/NordigenRequisition';
import { authedUser } from '@middleware/authed-context';
import { BankSyncHistoryService, type BankSyncLastError, connectionRequisitionId } from '@service/bank-sync/bank-sync-history.service';
import { daysUntil, enableBankingConsentOf } from '@service/enable-banking/enable-banking-consent';
import { encodeEnableBankingInstitutionId } from '@utils/enable-banking-institution-id';
import { InternalServerError } from '@utils/errors';

import { DI } from '../app.js';

const PROVIDER = 'GoCardless' as const;
const ENABLE_BANKING_PROVIDER = 'EnableBanking' as const;
const ACCESS_TYPE = 'open_banking' as const;

interface AccountWithInstitution {
  accountFinancialInstitutionKey?: null | { displayName?: null | string; name?: null | string };
  accountOwnerAppuserKey?: null | { appuserKey?: number };
  deletedAt?: Date | null;
  isPrivate?: boolean;
  refreshedAt?: Date | null;
  transactionsRefreshedAt?: Date | null;
}

interface BankConnectionDto {
  accessType: typeof ACCESS_TYPE;
  /**
   * The id `GET /v1/banking/bank/:bankId/start` takes to connect this bank again, so a client can
   * offer "Reconnect" without searching the bank list. Null for the legacy provider, which can no
   * longer be connected.
   */
  bankId: null | string;
  /**
   * The local connection id `GET /v1/banking/connections/:connectionId/syncs` takes. Null for the
   * legacy provider, whose history is not exposed.
   */
  connectionId: null | number;
  dataFreshAsOf: null | string;
  /** Whole days until the consent ends, 0 once it has ended, null when there is no end date. */
  daysUntilExpiry: null | number;
  expiresAt: null | string;
  institutionName: null | string;
  /** The newest failure for this connection, or null when it has never failed. */
  lastError: BankSyncLastError | null;
  provider: typeof ENABLE_BANKING_PROVIDER | typeof PROVIDER;
  status: ConnectionStatus;
}

/**
 * `expiring`: linked, with the consent ending within 14 days. `revoked`: the bank ended the
 * consent before its end date. Both apply to Enable Banking only; see `enable-banking-consent.ts`.
 */
type ConnectionStatus = 'connected' | 'error' | 'expired' | 'expiring' | 'processing' | 'revoked';

interface OwnedEnableBankingConnection {
  accessValidUntil?: Date | null;
  accounts: { getItems: () => AccountWithInstitution[] };
  aspspCountry?: null | string;
  aspspName?: null | string;
  enableBankingConnectionKey: number;
  sessionId?: null | string;
  state: string;
  status: EnableBankingConnectionStatus;
}

interface OwnedRequisition {
  accounts: { getItems: () => AccountWithInstitution[] };
  expiresAt?: Date | null;
  status: NordigenRequisitionStatus;
}

function isNullOrBlank(value: null | string | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}

/**
 * A (legacy) GoCardless institution id is uppercase letters and digits, optionally
 * with underscores, and at least 5 chars long. The DTO is allowed to
 * surface a human-readable name only — anything that looks like an
 * upstream id is treated as a placeholder and collapsed to null.
 */
const PROVIDER_ID_PATTERN = /^[A-Z][A-Z0-9_]{4,}$/;

function isProviderIdPlaceholder(value: string): boolean {
  return PROVIDER_ID_PATTERN.test(value);
}

/**
 * The *only* place a GoCardless connection's institution name is derived.
 * `NordigenRequisition` stores no institution of its own, so the name comes from
 * the human-safe `displayName` of the institutions its accounts carry:
 *
 * - one distinct name: that name;
 * - several (one requisition spanning banks, as seeded data does): every
 *   distinct name, most accounts first, joined with ", ". Naming only the most
 *   common bank would mislabel the others, and a "4 banks" label would be
 *   untranslated copy from the API; a list of proper nouns needs no locale;
 * - none: null, and the client shows its provider fallback.
 *
 * The upstream `name` is a provider id (e.g. 'SANDBOXFINANCE_SFIN0000') and is
 * never used; a provider-id-shaped displayName is skipped too. Soft-deleted
 * accounts don't name the connection, and neither does another member's private
 * account (`viewerAppuserKey`), so its institution can't leak through the label.
 */
function isOwnedBy(account: AccountWithInstitution, viewerAppuserKey: number | undefined): boolean {
  if (viewerAppuserKey === undefined) return false;
  return account.accountOwnerAppuserKey?.appuserKey === viewerAppuserKey;
}

function resolveInstitutionName(accounts: AccountWithInstitution[], viewerAppuserKey?: number): null | string {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    if (account.deletedAt) continue;
    if (account.isPrivate && !isOwnedBy(account, viewerAppuserKey)) continue;
    const display = account.accountFinancialInstitutionKey?.displayName?.trim();
    if (!display || isProviderIdPlaceholder(display)) continue;
    counts.set(display, (counts.get(display) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  // Map preserves first-seen order and Array#sort is stable, so ties keep it.
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).join(', ');
}

/**
 * Account-level readiness. Per the ticket: connected only when every
 * active scoped account has been refreshed (refreshedAt or
 * transactionsRefreshedAt present) AND the requisition is unexpired. A
 * requisition with no active scoped accounts is processing, not connected
 * (initial sync has not produced accounts yet).
 */
function areAllAccountsRefreshed(accounts: AccountWithInstitution[]): boolean {
  if (accounts.length === 0) return false;
  return accounts.every((account) => {
    if (account.deletedAt) return false;
    return Boolean(account.refreshedAt ?? account.transactionsRefreshedAt);
  });
}

/**
 * Freshness is the *minimum* refreshedAt across the active scoped
 * accounts — the slowest account defines how fresh the connection is.
 * Whichever per-account timestamp the platform uses, we project to a
 * single ISO string or null. A single account that is null on both
 * refreshedAt and transactionsRefreshedAt makes the whole connection
 * unready (handled in areAllAccountsRefreshed).
 */
function computeFreshnessAsOf(accounts: AccountWithInstitution[]): null | string {
  let min: Date | null = null;
  for (const account of accounts) {
    if (account.deletedAt) continue;
    const candidate = account.refreshedAt ?? account.transactionsRefreshedAt;
    if (!candidate) continue;
    if (min === null || candidate.getTime() < min.getTime()) {
      min = candidate;
    }
  }
  return min ? min.toISOString() : null;
}

function computeStatus(req: OwnedRequisition, accounts: AccountWithInstitution[]): ConnectionStatus {
  if (req.status === NordigenRequisitionStatus.CR) return 'processing';
  if (req.status === NordigenRequisitionStatus.ER) return 'error';
  if (req.status === NordigenRequisitionStatus.EX) return 'expired';
  // status === LN
  return resolveLinkedConnectionStatus(req.expiresAt, accounts);
}

/**
 * Shared "is this expiry-bearing, linked connection actually usable" check —
 * factored out of `computeStatus` so `computeEnableBankingStatus` can reuse
 * the exact same freshness/expiry rules against `EnableBankingConnection`'s
 * `accessValidUntil` instead of `NordigenRequisition`'s `expiresAt`.
 */
function resolveLinkedConnectionStatus(expiresAt: Date | null | undefined, accounts: AccountWithInstitution[]): ConnectionStatus {
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return 'error';
  if (expiresAt.getTime() <= Date.now()) return 'expired';
  if (accounts.length === 0) return 'processing';
  if (!areAllAccountsRefreshed(accounts)) return 'processing';
  return 'connected';
}

/**
 * Maps an Enable Banking connection onto the `ConnectionStatus` vocabulary through its consent
 * state (`enableBankingConsentOf`). A consent that is still in force is `expiring` when it ends
 * within 14 days, whatever its accounts' freshness: renewing it is the action the user needs.
 * Otherwise the same freshness rules as a GoCardless `LN` requisition decide between
 * `processing` and `connected`.
 */
function computeEnableBankingStatus(connection: OwnedEnableBankingConnection, accounts: AccountWithInstitution[]): ConnectionStatus {
  const { state } = enableBankingConsentOf(connection);
  switch (state) {
    case 'active':
      return resolveLinkedConnectionStatus(connection.accessValidUntil, accounts);
    case 'error':
    case 'expired':
    case 'expiring':
    case 'revoked':
      return state;
    case 'pending':
      return 'processing';
  }
}

function mapRequisition(req: OwnedRequisition & { requisitionId?: null | string }, viewerAppuserKey?: number, lastError: BankSyncLastError | null = null): BankConnectionDto {
  const accounts = req.accounts.getItems();
  return {
    accessType: ACCESS_TYPE,
    bankId: null,
    connectionId: null,
    dataFreshAsOf: computeFreshnessAsOf(accounts),
    daysUntilExpiry: req.status === NordigenRequisitionStatus.LN ? daysUntil(req.expiresAt) : null,
    expiresAt: toIso(req.expiresAt),
    institutionName: resolveInstitutionName(accounts, viewerAppuserKey),
    lastError,
    provider: PROVIDER,
    status: computeStatus(req, accounts),
  };
}

/**
 * Enable Banking counterpart to `mapRequisition`. Unlike GoCardless,
 * `institutionName` doesn't need `resolveInstitutionName`'s account-derived
 * name + provider-id-placeholder rules: Enable Banking's `aspspName` is
 * always a human-readable ASPSP display name straight from Enable Banking's
 * own registry, not a raw upstream id, so a direct (blank-guarded) mapping is
 * enough.
 */
function mapEnableBankingConnection(connection: OwnedEnableBankingConnection, lastError: BankSyncLastError | null = null): BankConnectionDto {
  const accounts = connection.accounts.getItems();
  return {
    accessType: ACCESS_TYPE,
    bankId: connection.aspspCountry && !isNullOrBlank(connection.aspspName)
      ? encodeEnableBankingInstitutionId({ country: connection.aspspCountry, name: connection.aspspName ?? '' })
      : null,
    connectionId: connection.enableBankingConnectionKey,
    dataFreshAsOf: computeFreshnessAsOf(accounts),
    daysUntilExpiry: enableBankingConsentOf(connection).daysUntilExpiry,
    expiresAt: toIso(connection.accessValidUntil),
    institutionName: isNullOrBlank(connection.aspspName) ? null : (connection.aspspName?.trim() ?? null),
    lastError,
    provider: ENABLE_BANKING_PROVIDER,
    status: computeEnableBankingStatus(connection, accounts),
  };
}

function toIso(value: Date | null | undefined): null | string {
  if (!value) return null;
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

/**
 * Read-only, tenant-safe bank-connection status collection.
 *
 * Scopes by `req.tenant + req.user + deletedAt: undefined`, newest-first
 * within each provider's own query. The DTO is the *only* output: no provider
 * status payload and no nested entities. `connectionId` is the caller's own
 * Enable Banking connection key, needed to open its sync history (and, on
 * mobile, to disconnect it); it is not a provider identifier. Empty list is a
 * 200.
 *
 * Like `getRequisitions` in `controller/user.ts`, surfaces `EnableBankingConnection`
 * rows alongside legacy `NordigenRequisition` rows, discriminated by the DTO's
 * `provider` field. Enable Banking rows are scoped to `deletedAt: undefined`:
 * `unlinkRequisition` soft-deletes them, and a user shouldn't see an unlinked
 * connection back in this list. Both queries are scoped to `tenantKey: req.tenant`
 * to preserve household/tenant isolation.
 */
export async function getBankConnections(req: Request, res: Response) {
  const user = authedUser(req);
  if (!req.tenant || !Number.isInteger(req.tenant.tenantKey) || req.tenant.tenantKey <= 0) {
    throw new InternalServerError('Authenticated tenant is required to read bank connections');
  }
  const [requisitions, enableBankingConnections] = await Promise.all([
    DI.em.find(
      NordigenRequisition,
      {
        appuserKey: user,
        deletedAt: undefined,
        tenantKey: req.tenant,
      },
      {
        orderBy: { createdAt: QueryOrder.DESC },
        populate: ['accounts', 'accounts.accountFinancialInstitutionKey'],
      },
    ),
    DI.em.find(
      EnableBankingConnection,
      {
        appuserKey: user,
        deletedAt: undefined,
        tenantKey: req.tenant,
      },
      {
        orderBy: { createdAt: QueryOrder.DESC },
        populate: ['accounts'],
      },
    ),
  ]);
  const history = new BankSyncHistoryService(DI.em);
  const lastErrorByRequisitionId = await history
    .getLastErrorByRequisitionId(user, [
      ...requisitions.map((requisition) => requisition.requisitionId).filter((id): id is string => Boolean(id)),
      ...enableBankingConnections.map((connection) => connectionRequisitionId(connection)),
    ])
    .catch(() => new Map<string, BankSyncLastError>());
  return res.json({
    connections: [
      ...requisitions.map((requisition) => mapRequisition(
        requisition,
        user.appuserKey,
        requisition.requisitionId ? lastErrorByRequisitionId.get(requisition.requisitionId) ?? null : null,
      )),
      ...enableBankingConnections.map((connection) => mapEnableBankingConnection(
        connection,
        lastErrorByRequisitionId.get(connectionRequisitionId(connection)) ?? null,
      )),
    ],
  });
}

/**
 * The last 20 runs of one bank connection, newest first.
 *
 * Owner-only: a connection is per-user, so a partner's connection — or one from
 * another household — is a 404, not an empty history. See
 * `BankSyncHistoryService.getConnectionHistory`.
 */
export async function getBankConnectionSyncs(req: Request, res: Response) {
  const user = authedUser(req);
  if (!req.tenant || !Number.isInteger(req.tenant.tenantKey) || req.tenant.tenantKey <= 0) {
    throw new InternalServerError('Authenticated tenant is required to read bank sync history');
  }
  const { params: { connectionId } } = await zParse(bankConnectionSyncsRequestSchema, req);
  const syncs = await new BankSyncHistoryService(DI.em).getConnectionHistory(connectionId, user, req.tenant);
  return res.json({ syncs });
}

// Test-only helper: exposes the decision rules so the status matrix can be
// covered without a real database.
export const __testOnly = {
  ACCESS_TYPE,
  areAllAccountsRefreshed,
  computeEnableBankingStatus,
  computeFreshnessAsOf,
  computeStatus,
  ENABLE_BANKING_PROVIDER,
  isNullOrBlank,
  isProviderIdPlaceholder,
  mapEnableBankingConnection,
  mapRequisition,
  PROVIDER,
  resolveInstitutionName,
  resolveLinkedConnectionStatus,
  toIso,
};

export type { AccountWithInstitution, BankConnectionDto, ConnectionStatus, OwnedEnableBankingConnection, OwnedRequisition };
