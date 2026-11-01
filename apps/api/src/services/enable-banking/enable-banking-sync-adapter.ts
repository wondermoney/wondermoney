import type { Account } from '@entity/Account';
import type { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { buildEnableBankingInstitutionRecordId } from '@utils/enable-banking-institution-id';
import { InternalServerError } from '@utils/errors';

import { createEnableBankingClient, type EnableBankingClient } from './enable-banking-client.service';
import { enableBankingCredentialService } from './enable-banking-credential.service';

/**
 * Shape adapter. Enable Banking's low-level client
 * (`enable-banking-client.service.ts`) speaks Enable Banking's *own* shapes — flat
 * `transactions[]` with a per-row `status` (`TransactionStatus`), cursor `continuation_key` pagination, `debtor`/
 * `creditor` party objects, ISO 20022 `balance_type` codes. The sync services
 * (`account-initial-sync-{account,transaction}.service.ts`) were built against a
 * Berlin-Group-ish shape and contain ~250 lines of hard-won balance
 * preference / dedup / pending-reconciliation logic that must not change. This file is the
 * single seam that translates one into the other, so that logic never has to know which
 * provider it's looking at.
 *
 * **Field-mapping table (Enable Banking → the internal `BankSyncClient` fields the sync
 * services already read):**
 *
 * | Enable Banking field                          | Internal field                                    | Note |
 * |------------------------------------------------|----------------------------------------------------|------|
 * | `transaction_amount.{amount,currency}`          | `transactionAmount.{amount,currency}`               | **signed** from the indicator: debit negative, credit positive |
 * | `credit_debit_indicator: 'CRDT'\|'DBIT'`        | `creditDebitIndicator: 'credit'\|'debit'`           | `DBTR` also maps to `'debit'`; see caveat below |
 * | `status` (`TransactionStatus`)                 | split into `transactions.booked[]` / `.pending[]` / `.voided[]` | EB is flat, target is pre-split; see "Transaction status" below |
 * | `booking_date`                                  | `bookingDate`                                       | direct rename |
 * | `value_date`                                    | `valueDate`                                         | direct rename |
 * | `transaction_date`                              | `transactionDate`                                   | last-resort date, for a pending row with no booking or value date yet |
 * | `transaction_id`                                | `transactionId`                                     | direct rename; not an identity |
 * | `entry_reference`                                | `entryReference`                                    | direct rename; the row's identity when present |
 * | `creditor.name`                                  | `creditorName`                                      | party object → flat name |
 * | `debtor.name`                                    | `debtorName`                                        | party object → flat name |
 * | `remittance_information[]`                       | `remittanceInformationUnstructured`                 | array joined with a single space |
 * | `continuation_key` (top-level, alongside `transactions[]`) | (not exposed — pages are exhausted internally) | see pagination note |
 * | `balance_amount.amount`                          | `balanceAmount.amount`                              | direct rename |
 * | `balance_type` (ISO 20022: CLBD/ITBD/OPBD/XPCD/ITAV/FWAV/CLAV/OPAV/INFO/OTHR/PRCD/VALU) | `balanceType` (Berlin-Group camelCase) | see mapping table below; unmapped codes pass through unchanged and fall through `selectProviderBalanceAmount`'s "first usable" fallback |
 *
 * **Balance type mapping** (`ENABLE_BANKING_BALANCE_TYPE_MAP`): only the codes with a clear
 * Berlin-Group counterpart that `BALANCE_TYPE_PREFERENCE` (in `account-initial-sync-account
 * .service.ts`) actually ranks are mapped; the rest (`CLAV`, `OPAV`, `INFO`, `OTHR`, `PRCD`,
 * `VALU`) have no such counterpart and are passed through as-is, which the existing preference
 * walk already treats correctly (falls to the first usable entry). `nonInvoiced` has no ISO 20022
 * equivalent found in Enable Banking's documented enum, so that preference tier is effectively
 * unreachable for Enable Banking accounts — acceptable since it is the lowest-priority fallback.
 *
 * **Amount sign.** Enable Banking documents `AmountType.amount` only as a decimal string
 * (its examples are unsigned) and gives the direction in the required `credit_debit_indicator`
 * (`CRDT` "Credit type transaction" / `DBIT` "Debit type transaction",
 * https://enablebanking.com/docs/api/reference/#creditdebitindicator). Production confirmed it:
 * every Enable Banking debit arrived positive.
 * Every consumer downstream (dedup, the generated internal id, pending↔booked matching,
 * `originalAmount`, `appuserSettlementAmount`, the balance chain and every aggregate) reads the
 * stored sign as the direction, so this adapter signs the amount here, once: debit → `-|amount|`,
 * credit → `|amount|`. The indicator wins over any sign a bank might send, so a value is never
 * negated twice. With no recognised indicator the amount passes through as sent.
 *
 * **Transaction status.** Enable Banking's `TransactionStatus`
 * (https://enablebanking.com/docs/api/reference/#transactionstatus) is
 * `BOOK` "Accounted transaction (ISO20022 Closing Booked)" · `PDNG` "Instant Balance Transaction
 * (ISO20022 Expected)" · `HOLD` "Account hold" · `SCHD` "Scheduled transaction" · `OTHR`
 * "Transaction with unknown status or not fitting the other options" · `RJCT` "Rejected
 * transaction" · `CNCL` "Cancelled transaction". `status` is required on `Transaction`. Enable Banking never sends `PEND`, so
 * treating only `PEND` as pending would book every hold and scheduled payment. The mapping
 * (`classifyStatus`) is:
 *   - `BOOK` → booked. The only status whose money has moved.
 *   - `PDNG`, `HOLD`, `SCHD`, `OTHR`, `PEND` and a missing status → pending. None of them is known
 *     to have settled: a hold reserves funds that may be released, a scheduled payment has not run,
 *     and an unknown status is not evidence of a booking. Pending is the safe side: it stays out of
 *     the running balance and the booked totals, is promoted in place when its booked version
 *     arrives, and expires if it drops out of the feed.
 *   - `RJCT`, `CNCL` → `voided`. Never ingested; the sync uses them only to retract a copy it stored
 *     before (see `account-initial-sync-transaction.service.ts`).
 * The status takes no part in the stable id below, so re-classifying a row never changes its
 * identity: a row stored under an earlier classification is found by the same id and updated in place.
 *
 * **Stable-id input stays as it was.** A row with neither `transaction_id` nor `entry_reference`
 * is identified by a hash of its fields (`buildStableId` in the transaction sync service). That
 * hash is computed from the unsigned amount and a frozen indicator mapping (`CRDT`→`credit`,
 * `DBTR`→`debit`, `DBIT` passed through), and it is stored in `enableBankingTransactionId`.
 * `stableIdFields` carries exactly those inputs so the hash, and with it the identity of every
 * row already ingested, does not change.
 *
 * **`credit_debit_indicator` caveat (flag for live verification):** the existing
 * `account-initial-sync-transaction.service.ts#resolveType` does
 * `(row.creditDebitIndicator ?? '').toLowerCase() === 'credit'` — i.e. it expects the *word*
 * `"credit"`, not Berlin Group's `"CRDT"` enum value. This adapter therefore maps Enable
 * Banking's `CRDT`/`DBIT` (and `DBTR`) to the words `'credit'`/`'debit'` to match that check
 * (credit → DEPOSIT, debit → PAYMENT/CARD_PAYMENT).
 *
 * **Pagination:** the sync services call `getTransactions()` once per account and expect the
 * full window back as one `{booked, pending}` pair. Enable Banking paginates with a `continuation_key` cursor instead, so this
 * adapter's `getTransactions()` loops `getAccountTransactions` internally, following
 * `continuation_key` until the response omits it, and returns the fully-accumulated,
 * already-split `{booked, pending}` result — the sync services never see a partial page.
 *
 * **Account discovery / details (no live equivalent):** the sync services expect a requisition
 * that can be re-queried for its accounts, and live per-account `getDetails()`/`getMetadata()`
 * calls. Enable Banking has no equivalent "list this
 * session's accounts again" or "account details" endpoint in the low-level client — the account
 * list and identity fields (IBAN, holder name, currency) are only ever returned once, in
 * `exchangeSession`'s response, at link time. The callback (`enableBankingCallback`
 * calling `createInitialEnableBankingAccounts`, see `enable-banking-initial-accounts.service.ts`)
 * persists `Account` rows from that response immediately. This adapter's `requisition
 * .getRequisitionById()` / `.getDetails()` / `.getMetadata()` therefore read those
 * already-persisted `Account` rows back out of the database instead of making a live provider
 * call — the interface shape the sync services expect is preserved, but the *source* of truth for
 * "which accounts exist and what are their identity fields" is our own DB, not a live Enable
 * Banking endpoint, because Enable Banking genuinely has none for this purpose. Only balances and
 * transactions are live provider calls, which is the actual point of running a sync.
 *
 * **Dedup / idempotency key:** this adapter passes `transaction_id` and `entry_reference` through
 * unchanged. The transaction sync service derives the `enableBankingTransactionId` it stores from
 * them (`enableBankingTransactionIdFor`): the `entry_reference`, which Enable Banking documents as
 * unique and immutable per account, then `transaction_id`, then a stable hash. `transaction_id`
 * "may change if the list of transactions is retrieved again", so it is not preferred.
 * Never written into `nordigenInternalTransactionId`.
 */

export interface AdaptedAccountBalance { balanceAmount?: { amount?: string }; balanceType?: string }

export interface AdaptedAccountBalancesResponse { balances?: AdaptedAccountBalance[] }

export interface AdaptedAccountDetailsResponse { account?: { currency?: string; name?: string; ownerName?: string } }
export interface AdaptedAccountMetadataResponse { iban?: string; institution_id?: string }
export interface AdaptedTransaction {
  bookingDate?: string;
  creditDebitIndicator?: string;
  creditorName?: string;
  debtorName?: string;
  entryReference?: string;
  remittanceInformationUnstructured?: string;
  /** Enable Banking's raw `status` (`TransactionStatus`), kept for audit and reporting. Not part of any id. */
  providerStatus?: string;
  /** The amount and indicator the id-less stable hash was always computed from; see the module docblock. */
  stableIdFields?: StableIdFields;
  transactionAmount?: { amount?: string; currency?: string };
  /** Enable Banking `transaction_date`; only a date fallback, never part of the stable id. */
  transactionDate?: string;
  transactionId?: string;
  valueDate?: string;
}
/**
 * `voided` holds rejected and cancelled rows (`RJCT`, `CNCL`): never to be ingested, but the sync
 * needs them to retract a copy it stored earlier.
 */
export interface AdaptedTransactionsResponse { transactions?: { booked?: AdaptedTransaction[]; pending?: AdaptedTransaction[]; voided?: AdaptedTransaction[] } }
/** Where a row goes, by its Enable Banking `status`. See "Transaction status" in the module docblock. */
export type EnableBankingStatusClass = 'booked' | 'pending' | 'voided';
export interface EnableBankingSyncAdapterDeps {
  client?: EnableBankingClient;
  em?: EnableBankingSyncAdapterEm;
}
export interface EnableBankingSyncClient {
  account: (accountId: string) => {
    getBalances: () => Promise<AdaptedAccountBalancesResponse>;
    getDetails: () => Promise<AdaptedAccountDetailsResponse>;
    getMetadata: () => Promise<AdaptedAccountMetadataResponse>;
    getTransactions: (input?: { country?: string; dateFrom?: string; dateTo?: string }) => Promise<AdaptedTransactionsResponse>;
  };
  requisition: { getRequisitionById: (id: string) => Promise<{ accounts?: string[]; institution_id?: string }> };
}
/** The amount and indicator an id-less row's stable hash is computed from (see the module docblock). */
export interface StableIdFields { amount?: string; creditDebitIndicator?: string }

interface EnableBankingSyncAdapterEm {
  find<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<T[]>;
}

/**
 * Enable Banking `balance_type` (ISO 20022 `BalanceType13Code`, confirmed against
 * https://enablebanking.com/docs/api/reference/) → the Berlin-Group camelCase values
 * `BALANCE_TYPE_PREFERENCE` in `account-initial-sync-account.service.ts` actually ranks. Only
 * documented Enable Banking codes are keyed here — anything else (or a future undocumented code)
 * simply passes through unmapped and falls into that preference list's "first usable entry"
 * fallback.
 */
const ENABLE_BANKING_BALANCE_TYPE_MAP: Record<string, string> = {
  CLBD: 'closingBooked',
  FWAV: 'forwardAvailable',
  ITAV: 'interimAvailable',
  ITBD: 'interimBooked',
  OPBD: 'openingBooked',
  XPCD: 'expected',
};

/** Enable Banking documents `CRDT` | `DBIT`; `DBTR` is kept in case a bank ever sends it. */
const CREDIT_DEBIT_INDICATOR_MAP: Record<string, 'credit' | 'debit'> = { CRDT: 'credit', DBIT: 'debit', DBTR: 'debit' };

/**
 * The indicator mapping the stable hash is computed with. `DBIT` is deliberately not mapped.
 * Frozen: changing it changes the stored identity of every id-less row.
 */
const STABLE_ID_INDICATOR_MAP: Record<string, string> = { CRDT: 'credit', DBTR: 'debit' };

/** Statuses that will never settle. Everything that is neither this nor `BOOK` is pending. */
const VOIDED_STATUSES = new Set(['CNCL', 'RJCT']);

/** See "Transaction status" in the module docblock. */
interface RawEnableBankingBalance { balance_amount?: { amount?: string; currency?: string }; balance_type?: string }


interface RawEnableBankingBalancesResponse { balances?: RawEnableBankingBalance[] }
interface RawEnableBankingParty { name?: string }
interface RawEnableBankingTransaction {
  booking_date?: string;
  credit_debit_indicator?: string;
  creditor?: RawEnableBankingParty;
  debtor?: RawEnableBankingParty;
  entry_reference?: string;
  remittance_information?: string[];
  status?: string;
  transaction_amount?: { amount?: string; currency?: string };
  transaction_date?: string;
  transaction_id?: string;
  value_date?: string;
}
interface RawEnableBankingTransactionsResponse { continuation_key?: string; transactions?: RawEnableBankingTransaction[] }
export function classifyStatus(status: string | undefined): EnableBankingStatusClass {
  if (status === 'BOOK') return 'booked';
  if (status !== undefined && VOIDED_STATUSES.has(status)) return 'voided';
  return 'pending';
}

/**
 * Builds an object satisfying the exact `{account(id): {getDetails, getMetadata, getBalances,
 * getTransactions}, requisition: {getRequisitionById}}` interface the sync services
 * declare (see `account-initial-sync-{account,transaction}.service.ts`'s local
 * `BankSyncClient` types), backed by Enable Banking's real API + our own already-persisted
 * `Account` rows for identity/discovery (see the module docblock above for why).
 *
 * `deps.client` / `deps.em` are injectable for tests; production callers omit both and get a real
 * `createEnableBankingClient(...)` (decrypting `connection.enableBankingCredentialKey`, which must
 * already be populated/loaded — see `EnableBankingConnectionRepository.findByState`'s populate for
 * the pattern) and `DI.em`.
 */
export function createEnableBankingSyncAdapter(connection: EnableBankingConnection, deps: EnableBankingSyncAdapterDeps = {}): EnableBankingSyncClient {
  const em = deps.em ?? getDefaultEm();
  const client = deps.client ?? buildDefaultClient(connection);
  const institutionId = buildEnableBankingInstitutionRecordId({ country: connection.aspspCountry, name: connection.aspspName });

  // Memoized: the account-phase sync calls getDetails/getMetadata/getBalances concurrently
  // (Promise.all) per account, and getRequisitionById once up front — without this every one of
  // those would re-run the same "accounts for this connection" query.
  let accountsPromise: Promise<Account[]> | undefined;
  async function loadAccounts(): Promise<Account[]> {
    accountsPromise ??= em.find<Account>(await loadAccountEntity(), { deletedAt: undefined, enableBankingConnectionKey: connection }, { populate: ['currencyKey'] });
    return accountsPromise;
  }

  async function findAccount(accountId: string): Promise<Account | undefined> {
    const accounts = await loadAccounts();
    return accounts.find((account) => account.accountId === accountId);
  }

  return {
    account: (accountId: string) => ({
      getBalances: async () => {
        const raw = await client.getAccountBalances(accountId) as RawEnableBankingBalancesResponse;
        return {
          balances: (raw.balances ?? []).map((balance) => ({
            balanceAmount: { amount: balance.balance_amount?.amount },
            balanceType: balance.balance_type ? ENABLE_BANKING_BALANCE_TYPE_MAP[balance.balance_type] ?? balance.balance_type : undefined,
          })),
        };
      },
      getDetails: async () => {
        const account = await findAccount(accountId);
        const currencyKey = account?.currencyKey as undefined | { code?: string };
        return { account: { currency: currencyKey?.code, name: account?.accountName, ownerName: account?.holderName } };
      },
      getMetadata: async () => {
        const account = await findAccount(accountId);
        return { iban: account?.accountNumber, institution_id: institutionId };
      },
      getTransactions: async (input) => {
        const rows = await fetchAllTransactionPages(client, accountId, input);
        const split: Record<EnableBankingStatusClass, AdaptedTransaction[]> = { booked: [], pending: [], voided: [] };
        for (const row of rows) split[classifyStatus(row.status)].push(mapTransaction(row));
        return { transactions: split };
      },
    }),
    requisition: {
      getRequisitionById: async () => {
        const accounts = await loadAccounts();
        return { accounts: accounts.map((account) => account.accountId).filter((id): id is string => Boolean(id)), institution_id: institutionId };
      },
    },
  };
}

/**
 * `Account` is imported type-only above (to avoid a runtime import cycle risk with the entity
 * decorators); the adapter needs the actual class reference at runtime for `em.find`, so it's
 * lazily required here. Kept as its own function so tests can inject `deps.em` without needing a
 * real MikroORM entity graph at all.
 */
function buildDefaultClient(connection: EnableBankingConnection): EnableBankingClient {
  const credential = enableBankingCredentialService.decryptCredentialEntity(connection.enableBankingCredentialKey);
  return createEnableBankingClient(credential);
}

async function fetchAllTransactionPages(client: EnableBankingClient, accountId: string, input?: { dateFrom?: string; dateTo?: string }): Promise<RawEnableBankingTransaction[]> {
  const rows: RawEnableBankingTransaction[] = [];
  let continuationKey: string | undefined;
  // No documented upper bound on continuation pages; cap defensively so a provider bug (a
  // `continuation_key` that never terminates) can't spin this into an infinite loop / OOM.
  const MAX_PAGES = 500;
  for (let page = 0; page < MAX_PAGES; page++) {
    const raw = await client.getAccountTransactions(accountId, { continuationKey, dateFrom: input?.dateFrom, dateTo: input?.dateTo }) as RawEnableBankingTransactionsResponse;
    rows.push(...(raw.transactions ?? []));
    if (!raw.continuation_key) return rows;
    continuationKey = raw.continuation_key;
  }
  throw new InternalServerError(`Enable Banking transaction pagination for account ${accountId} did not terminate after ${MAX_PAGES} pages`);
}

function getDefaultEm(): EnableBankingSyncAdapterEm {
  // Lazily resolved so importing this module never requires DI to already be initialized
  // (mirrors the lazy `DI.em` access pattern used throughout the sync services).
  return {
    find: async (entityClass, where, options) => {
      const { DI } = await import('@app/database/di');
      return DI.em.find(entityClass, where, options);
    },
  };
}

async function loadAccountEntity() {
  const { Account } = await import('@entity/Account');
  return Account as unknown as new (...args: never[]) => Account;
}

function mapTransaction(row: RawEnableBankingTransaction): AdaptedTransaction {
  const rawIndicator = row.credit_debit_indicator;
  const direction = rawIndicator ? CREDIT_DEBIT_INDICATOR_MAP[rawIndicator] : undefined;
  return {
    bookingDate: row.booking_date,
    creditDebitIndicator: rawIndicator ? direction ?? rawIndicator : undefined,
    creditorName: row.creditor?.name,
    debtorName: row.debtor?.name,
    entryReference: row.entry_reference,
    providerStatus: row.status,
    remittanceInformationUnstructured: row.remittance_information?.length ? row.remittance_information.join(' ') : undefined,
    stableIdFields: { amount: row.transaction_amount?.amount, creditDebitIndicator: rawIndicator ? STABLE_ID_INDICATOR_MAP[rawIndicator] ?? rawIndicator : undefined },
    transactionAmount: row.transaction_amount ? { amount: signAmount(row.transaction_amount.amount, direction), currency: row.transaction_amount.currency } : undefined,
    transactionDate: row.transaction_date,
    transactionId: row.transaction_id,
    valueDate: row.value_date,
  };
}

/** Signs an unsigned provider amount from its direction, keeping the provider's decimal string. */
function signAmount(amount: string | undefined, direction: 'credit' | 'debit' | undefined): string | undefined {
  if (amount === undefined || direction === undefined) return amount;
  const magnitude = amount.trim().replace(/^[+-]/, '');
  return direction === 'debit' ? `-${magnitude}` : magnitude;
}
