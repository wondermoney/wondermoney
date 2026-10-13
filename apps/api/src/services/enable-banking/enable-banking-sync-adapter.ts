import type { Account } from '@entity/Account';
import type { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { buildEnableBankingInstitutionRecordId } from '@utils/enable-banking-institution-id';
import { InternalServerError } from '@utils/errors';

import { createEnableBankingClient, type EnableBankingClient } from './enable-banking-client.service';
import { enableBankingCredentialService } from './enable-banking-credential.service';

/**
 * Phase 1d shape-adapter (plan §3/§4, opening paragraph). Enable Banking's low-level client
 * (`enable-banking-client.service.ts`, Phase 1b) speaks Enable Banking's *own* shapes — flat
 * `transactions[]` with `status: BOOK|PEND`, cursor `continuation_key` pagination, `debtor`/
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
 * | `transaction_amount.{amount,currency}`          | `transactionAmount.{amount,currency}`               | direct rename |
 * | `credit_debit_indicator: 'CRDT'\|'DBTR'`        | `creditDebitIndicator: 'credit'\|'debit'`           | see caveat below |
 * | `status: 'BOOK'\|'PEND'`                        | split into `transactions.booked[]` / `.pending[]`   | EB is flat, target is pre-split |
 * | `booking_date`                                  | `bookingDate`                                       | direct rename |
 * | `value_date`                                    | `valueDate`                                         | direct rename |
 * | `transaction_id`                                | `transactionId`                                     | also feeds `enableBankingTransactionId` |
 * | `entry_reference`                                | `entryReference`                                    | direct rename |
 * | `creditor.name`                                  | `creditorName`                                      | party object → flat name |
 * | `debtor.name`                                    | `debtorName`                                        | party object → flat name |
 * | `remittance_information[]`                       | `remittanceInformationUnstructured`                 | array joined with a single space |
 * | `continuation_key` (top-level, alongside `transactions[]`) | (not exposed — pages are exhausted internally) | see pagination note |
 * | `balance_amount.amount`                          | `balanceAmount.amount`                              | direct rename |
 * | `balance_type` (ISO 20022: CLBD/ITBD/OPBD/XPCD/ITAV/FWAV/CLAV/OPAV/INFO/OTHR/PRCD/VALU) | `balanceType` (GoCardless/Berlin-Group camelCase) | see mapping table below; unmapped codes pass through unchanged and fall through `selectProviderBalanceAmount`'s "first usable" fallback |
 *
 * **Balance type mapping** (`ENABLE_BANKING_BALANCE_TYPE_MAP`): only the codes with a clear
 * Berlin-Group counterpart that `BALANCE_TYPE_PREFERENCE` (in `account-initial-sync-account
 * .service.ts`) actually ranks are mapped; the rest (`CLAV`, `OPAV`, `INFO`, `OTHR`, `PRCD`,
 * `VALU`) have no such counterpart and are passed through as-is, which the existing preference
 * walk already treats correctly (falls to the first usable entry). `nonInvoiced` has no ISO 20022
 * equivalent found in Enable Banking's documented enum, so that preference tier is effectively
 * unreachable for Enable Banking accounts — acceptable since it is the lowest-priority fallback.
 *
 * **`credit_debit_indicator` caveat (flag for live verification):** the existing
 * `account-initial-sync-transaction.service.ts#resolveType` does
 * `(row.creditDebitIndicator ?? '').toLowerCase() === 'credit'` — i.e. it expects the *word*
 * `"credit"`, not Berlin Group's `"CRDT"` enum value. This adapter therefore maps Enable
 * Banking's `CRDT`/`DBTR` to the words `'credit'`/`'debit'` to match that check and preserve
 * GoCardless-equivalent classification (credit → TRANSFER_IN, debit → PAYMENT/CARD_PAYMENT).
 * Whether the GoCardless-side Nordigen SDK actually normalizes to full words at runtime (vs. this
 * being a latent bug on the GoCardless path) was **not** verified here — out of scope for this
 * adapter — but mapping to the words is the safer choice: it makes new Enable Banking data behave
 * exactly as the reconciliation logic's own equality check expects, regardless of what GoCardless
 * actually sends.
 *
 * **Pagination:** GoCardless/Nordigen's `getTransactions()` returns one already-complete
 * `{booked, pending}` pair per call (the old GoCardless SDK exhausted offset-pagination
 * internally before returning) — the sync services call it once per account and expect the full
 * window back. Enable Banking paginates with a `continuation_key` cursor instead, so this
 * adapter's `getTransactions()` loops `getAccountTransactions` internally, following
 * `continuation_key` until the response omits it, and returns the fully-accumulated,
 * already-split `{booked, pending}` result — the sync services never see a partial page.
 *
 * **Account discovery / details (no live equivalent):** GoCardless's requisition can be
 * re-queried at any time (`GET /requisitions/{id}` → `.accounts[]`), and `getDetails()`/
 * `getMetadata()` are live per-account calls. Enable Banking has no equivalent "list this
 * session's accounts again" or "account details" endpoint in the low-level client — the account
 * list and identity fields (IBAN, holder name, currency) are only ever returned once, in
 * `exchangeSession`'s response, at link time. Phase 1d's callback wiring (`enableBankingCallback`
 * calling `createInitialEnableBankingAccounts`, see `enable-banking-initial-accounts.service.ts`)
 * persists `Account` rows from that response immediately. This adapter's `requisition
 * .getRequisitionById()` / `.getDetails()` / `.getMetadata()` therefore read those
 * already-persisted `Account` rows back out of the database instead of making a live provider
 * call — the interface shape the sync services expect is preserved, but the *source* of truth for
 * "which accounts exist and what are their identity fields" is our own DB, not a live Enable
 * Banking endpoint, because Enable Banking genuinely has none for this purpose. Only balances and
 * transactions are live provider calls, which is the actual point of running a sync.
 *
 * **Dedup / idempotency key:** every produced transaction row carries a `transactionId` derived
 * from Enable Banking's own `transaction_id` (falling back to `entry_reference`, then a stable
 * hash) — callers (the transaction sync service) are expected to write this into the new
 * `enableBankingTransactionId` column (Phase 1a), never into `nordigenInternalTransactionId`.
 * This adapter does not touch that column itself; it only guarantees a stable identity value is
 * present in the shape the caller already knows how to read (`tx.transactionId`).
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
  transactionAmount?: { amount?: string; currency?: string };
  transactionId?: string;
  valueDate?: string;
}
export interface AdaptedTransactionsResponse { transactions?: { booked?: AdaptedTransaction[]; pending?: AdaptedTransaction[] } }
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

interface EnableBankingSyncAdapterEm {
  find<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<T[]>;
}

/**
 * Enable Banking `balance_type` (ISO 20022 `BalanceType13Code`, confirmed against
 * https://enablebanking.com/docs/api/reference/) → the Berlin-Group/GoCardless camelCase values
 * `BALANCE_TYPE_PREFERENCE` in `account-initial-sync-account.service.ts` actually ranks. Only
 * documented Enable Banking codes are keyed here — anything else (or a future undocumented code)
 * simply passes through unmapped and falls into that preference list's "first usable entry"
 * fallback, exactly as an unrecognized GoCardless balance type already does today.
 */
export const ENABLE_BANKING_BALANCE_TYPE_MAP: Record<string, string> = {
  CLBD: 'closingBooked',
  FWAV: 'forwardAvailable',
  ITAV: 'interimAvailable',
  ITBD: 'interimBooked',
  OPBD: 'openingBooked',
  XPCD: 'expected',
};

const CREDIT_DEBIT_INDICATOR_MAP: Record<string, string> = { CRDT: 'credit', DBTR: 'debit' };

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
  transaction_id?: string;
  value_date?: string;
}
interface RawEnableBankingTransactionsResponse { continuation_key?: string; transactions?: RawEnableBankingTransaction[] }

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
        const booked: AdaptedTransaction[] = [];
        const pending: AdaptedTransaction[] = [];
        for (const row of rows) {
          const mapped = mapTransaction(row);
          (row.status === 'PEND' ? pending : booked).push(mapped);
        }
        return { transactions: { booked, pending } };
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
  return {
    bookingDate: row.booking_date,
    creditDebitIndicator: row.credit_debit_indicator ? CREDIT_DEBIT_INDICATOR_MAP[row.credit_debit_indicator] ?? row.credit_debit_indicator : undefined,
    creditorName: row.creditor?.name,
    debtorName: row.debtor?.name,
    entryReference: row.entry_reference,
    remittanceInformationUnstructured: row.remittance_information?.length ? row.remittance_information.join(' ') : undefined,
    transactionAmount: row.transaction_amount ? { amount: row.transaction_amount.amount, currency: row.transaction_amount.currency } : undefined,
    transactionId: row.transaction_id,
    valueDate: row.value_date,
  };
}
