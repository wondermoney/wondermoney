import { QueryOrder } from '@mikro-orm/core';
import type { Request, Response } from 'express';

import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { NordigenRequisition, NordigenRequisitionStatus } from '@entity/NordigenRequisition';
import { authedUser } from '@middleware/authed-context';
import { InternalServerError } from '@utils/errors';

import { DI } from '../app.js';

const PROVIDER = 'GoCardless' as const;
const ENABLE_BANKING_PROVIDER = 'EnableBanking' as const;
const ACCESS_TYPE = 'open_banking' as const;

interface AccountWithInstitution {
  accountFinancialInstitutionKey?: null | { displayName?: null | string; name?: null | string };
  deletedAt?: Date | null;
  refreshedAt?: Date | null;
  transactionsRefreshedAt?: Date | null;
}

interface BankConnectionDto {
  accessType: typeof ACCESS_TYPE;
  dataFreshAsOf: null | string;
  expiresAt: null | string;
  institutionName: null | string;
  provider: typeof ENABLE_BANKING_PROVIDER | typeof PROVIDER;
  status: ConnectionStatus;
}

type ConnectionStatus = 'connected' | 'error' | 'expired' | 'processing';

interface OwnedEnableBankingConnection {
  accessValidUntil?: Date | null;
  accounts: { getItems: () => AccountWithInstitution[] };
  aspspName?: null | string;
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
 * A GoCardless institution id is uppercase letters and digits, optionally
 * with underscores, and at least 5 chars long. The DTO is allowed to
 * surface a human-readable name only — anything that looks like an
 * upstream id is treated as a placeholder and collapsed to null.
 */
const PROVIDER_ID_PATTERN = /^[A-Z][A-Z0-9_]{4,}$/;

function isProviderIdPlaceholder(value: string): boolean {
  return PROVIDER_ID_PATTERN.test(value);
}

/**
 * RAD-246 — the *only* place a tenant-resolved institution display name may
 * be surfaced. The rules are conservative: a name is returned only when one
 * distinct, human-safe display name exists across the requisition's
 * accounts. A conflict or a provider-ID placeholder collapses to null so
 * the DTO never leaks a value the mobile client cannot use.
 */
function resolveInstitutionName(accounts: AccountWithInstitution[]): null | string {
  // Only the human-safe `displayName` is eligible. A provider-id-shaped
  // displayName is also rejected: the underlying `name` on
  // AccountFinancialInstitution is the upstream provider id (e.g.
  // 'SANDBOXFINANCE_SFIN0000'), and the DTO must never surface a value
  // the mobile client cannot use. A null/blank displayName collapses to
  // "no candidate", the same outcome as a missing relation.
  const candidates: string[] = [];
  for (const account of accounts) {
    const institution = account.accountFinancialInstitutionKey;
    if (!institution) continue;
    const display = institution.displayName?.trim();
    if (!display || isProviderIdPlaceholder(display)) continue;
    candidates.push(display);
  }
  if (candidates.length === 0) return null;
  const first = candidates[0]!;
  return candidates.every((c) => c === first) ? first : null;
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
 * `accessValidUntil` instead of `NordigenRequisition`'s `expiresAt`. Logic is
 * unchanged from the pre-extraction `computeStatus` LN branch.
 */
function resolveLinkedConnectionStatus(expiresAt: Date | null | undefined, accounts: AccountWithInstitution[]): ConnectionStatus {
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return 'error';
  if (expiresAt.getTime() <= Date.now()) return 'expired';
  if (accounts.length === 0) return 'processing';
  if (!areAllAccountsRefreshed(accounts)) return 'processing';
  return 'connected';
}

/**
 * Maps `EnableBankingConnectionStatus` onto the existing `ConnectionStatus`
 * vocabulary. `created` and `authorized` are both pre-session, in-progress
 * states in Enable Banking's two-step `POST /auth` -> `POST /sessions` flow —
 * neither has an exact match in the existing vocabulary, so both collapse to
 * `processing`, the same value `NordigenRequisitionStatus.CR` (created) maps
 * to. `linked` reuses `resolveLinkedConnectionStatus` against
 * `accessValidUntil`, mirroring how a GoCardless `LN` requisition is resolved
 * against `expiresAt`.
 */
function computeEnableBankingStatus(connection: OwnedEnableBankingConnection, accounts: AccountWithInstitution[]): ConnectionStatus {
  switch (connection.status) {
    case EnableBankingConnectionStatus.AUTHORIZED:
    case EnableBankingConnectionStatus.CREATED:
      return 'processing';
    case EnableBankingConnectionStatus.ERROR:
      return 'error';
    case EnableBankingConnectionStatus.EXPIRED:
      return 'expired';
    case EnableBankingConnectionStatus.LINKED:
      return resolveLinkedConnectionStatus(connection.accessValidUntil, accounts);
    default:
      return 'error';
  }
}

function mapRequisition(req: OwnedRequisition): BankConnectionDto {
  const accounts = req.accounts.getItems();
  return {
    accessType: ACCESS_TYPE,
    dataFreshAsOf: computeFreshnessAsOf(accounts),
    expiresAt: toIso(req.expiresAt),
    institutionName: resolveInstitutionName(accounts),
    provider: PROVIDER,
    status: computeStatus(req, accounts),
  };
}

/**
 * Enable Banking counterpart to `mapRequisition`. Unlike GoCardless,
 * `institutionName` doesn't need `resolveInstitutionName`'s cross-account
 * agreement + provider-id-placeholder rules: Enable Banking's `aspspName` is
 * always a human-readable ASPSP display name straight from Enable Banking's
 * own registry, not a raw upstream id, so a direct (blank-guarded) mapping is
 * enough.
 */
function mapEnableBankingConnection(connection: OwnedEnableBankingConnection): BankConnectionDto {
  const accounts = connection.accounts.getItems();
  return {
    accessType: ACCESS_TYPE,
    dataFreshAsOf: computeFreshnessAsOf(accounts),
    expiresAt: toIso(connection.accessValidUntil),
    institutionName: isNullOrBlank(connection.aspspName) ? null : (connection.aspspName?.trim() ?? null),
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
 * RAD-246 — read-only, tenant-safe bank-connection status collection.
 *
 * Scopes by `req.tenant + req.user + deletedAt: undefined`, newest-first
 * within each provider's own query. The DTO is the *only* output: no entity
 * identifiers, no provider status payload, no nested entities. Empty list is
 * a 200.
 *
 * Widened (mirroring `getRequisitions` in `controller/user.ts`) to also
 * surface `EnableBankingConnection` rows alongside `NordigenRequisition`,
 * discriminated by the DTO's `provider` field. Deliberately scoped to
 * `deletedAt: undefined` for the same reason as that sibling widening:
 * `unlinkRequisition` soft-deletes `EnableBankingConnection` rows, and a user
 * shouldn't see an unlinked connection back in this list. Also scoped to
 * `tenantKey: req.tenant`, matching the pre-existing GoCardless query, to
 * preserve household/tenant isolation.
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
  return res.json({
    connections: [...requisitions.map(mapRequisition), ...enableBankingConnections.map(mapEnableBankingConnection)],
  });
}

// Re-export the institution entity to satisfy the loader's static analysis
// in case the controller is moved; the actual load happens through DI.
export { AccountFinancialInstitution };

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
