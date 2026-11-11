import type { AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { BankConnectionStatus } from '@entity/BankConnection';

export { BankConnectionStatus };

/**
 * The seam every bank aggregator implements.
 *
 * The sync services (`account-initial-sync-{account,transaction}.service.ts`) were written
 * against a Berlin-Group-ish shape and carry the balance preference, dedup and pending
 * reconciliation logic. They read only this interface, never a provider's own client or
 * entity, so a new aggregator is one implementation of {@link BankProvider} plus a registry
 * entry — not a new branch in the sync path.
 *
 * Enable Banking is the first implementation
 * (`enable-banking.provider.ts`); the fake provider in the tests proves the seam.
 */

/** Stable provider id, e.g. `enable_banking`. Matches `AccountFinancialInstitution.provider`. */
export type BankProviderId = string;

/**
 * A connection as the sync path sees it: our own `BankConnection` row, reduced to the fields
 * that are not provider-specific. The provider implementation loads its own detail row from
 * `bankConnectionKey` when it needs provider-specific data.
 */
export interface BankAccountsResult {
  accounts: BankProviderAccount[];
  /** The connection's institution id, known even when every account fails. */
  institutionId?: string;
  /** The provider's raw connection status, surfaced in the zero-accounts log. */
  providerStatus?: string;
}

export interface BankCompleteConnectionInput {
  /** The provider's callback correlation value. */
  state: string;
  /** The authorization code the provider redirected back with. */
  code: string;
}

export interface BankCompleteConnectionResult {
  /** Accounts the provider linked, already persisted as `Account` rows. */
  accountsCreated: number;
  bankConnectionKey: number;
  /** Set when the consent linked but persisting accounts failed; the link itself succeeded. */
  postLinkError?: unknown;
  /** Where the callback should send the browser afterwards. */
  returnTo?: null | string;
}

export interface BankConnectionRef {
  /** `BankConnection.bankConnectionKey`. */
  bankConnectionKey: number;
  /** Provider-issued session / consent id, used for incident analytics. */
  externalId: string;
  /** The owning `Appuser.appuserKey`. */
  appuserId: number;
  /** Provider id, e.g. `enable_banking`. */
  provider: BankProviderId;
  status: BankConnectionStatus;
  /** The owning `Tenant.tenantKey`, when the connection was made inside a household. */
  tenantId?: number;
}

export interface BankInstitution {
  /** Opaque id the client hands back to `startConnection`. */
  country?: string;
  id: string;
  logo?: string;
  name: string;
}

export interface BankProviderAccount {
  /** Provider account id used by `getBalances` / `getTransactions`. */
  currency?: string;
  externalId: string;
  iban?: string;
  /** The provider's institution id for this account, when it has one. */
  institutionId?: string;
  name?: string;
  ownerName?: string;
}

export interface BankProviderBalance {
  balanceAmount?: { amount?: string };
  balanceType?: string;
}

export type BankSessionStatus = 'active' | 'ended' | 'unknown';

export interface BankStartConnectionInput {
  appuserId: number;
  /** The id `listInstitutions` returned. */
  institutionId: string;
  redirectUrl: string;
  returnTo?: null | string;
  tenantId: number;
}

export interface BankStartConnectionResult {
  /** Where the browser goes to authorize the consent. */
  redirectUrl: string;
}

/** One transaction row, in the shape the sync services already read. */
export interface BankProviderTransaction {
  /** Legacy unsigned amount some providers send instead of `transactionAmount`. */
  amount?: string;
  bookingDate?: string;
  creditDebitIndicator?: string;
  creditorName?: string;
  creditorReference?: string;
  currency?: string;
  currencyExchange?: { exchangeRate?: number | string; instructedAmount?: { amount?: string; currency?: string }; sourceCurrency?: string };
  debtorName?: string;
  entryReference?: string;
  internalTransactionId?: string;
  /** The provider's raw status, kept for audit and reporting. Not part of any id. */
  providerStatus?: string;
  remittanceInformationStructured?: string;
  remittanceInformationUnstructured?: string;
  /** The amount and indicator an id-less row's stable hash is computed from. */
  stableIdFields?: BankStableIdFields;
  /** Set by `withStableIdOccurrences`: the nth (0-based) id-less row with this content in its fetch. */
  stableIdOccurrence?: number;
  transactionAmount?: { amount?: string; currency?: string };
  transactionDate?: string;
  transactionId?: string;
  valueDate?: string;
}

export interface BankProviderTransactions {
  booked?: BankProviderTransaction[];
  pending?: BankProviderTransaction[];
  /** Rejected or cancelled rows: never ingested, only used to retract a stored copy. */
  voided?: BankProviderTransaction[];
}

export interface BankStableIdFields { amount?: string; creditDebitIndicator?: string }

export interface BankTransactionsInput {
  country?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * How this provider's transaction identities are stored. The sync services read only these
 * two facts, never the provider id: which `Transaction` column holds the provider id, and the
 * prefix used in the stable-id hash for id-less rows. Enable Banking keeps its own column so
 * rows ingested before the interface existed keep their identity.
 */
export interface BankProvider {
  /** `AccountFinancialInstitution.provider` value its accounts belong to. */
  readonly institutionProvider: AccountFinancialInstitutionProvider;

  /** `listInstitutions` / `startConnection` / `completeConnection` are the consent flow. */
  completeConnection(input: BankCompleteConnectionInput): Promise<BankCompleteConnectionResult>;

  getBalances(connection: BankConnectionRef, accountId: string): Promise<BankProviderBalance[]>;

  /** The connection's current consent state, used after every account was rejected. */
  getSessionStatus(connection: BankConnectionRef): Promise<BankSessionStatus>;

  getTransactions(connection: BankConnectionRef, accountId: string, input?: BankTransactionsInput): Promise<BankProviderTransactions>;

  readonly id: BankProviderId;

  listAccounts(connection: BankConnectionRef): Promise<BankAccountsResult>;

  listInstitutions(input: { appuserId: number; country?: string }): Promise<BankInstitution[]>;

  /**
   * Optional pre-flight check before a sync reaches the bank (the Enable Banking BYOK
   * credential check). Throwing `UserActionRequiredError` makes the run permanent.
   */
  preflight?(connection: BankConnectionRef): Promise<void>;

  startConnection(input: BankStartConnectionInput): Promise<BankStartConnectionResult>;

  readonly transactionIdentity: BankTransactionIdentity;
}

export interface BankTransactionIdentity {
  column: 'enableBankingTransactionId' | 'nordigenInternalTransactionId';
  prefix: 'enable_banking' | 'nordigen';
}
