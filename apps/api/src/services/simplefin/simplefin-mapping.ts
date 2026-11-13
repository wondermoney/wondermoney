import type { BankReportedErrorCode } from '@service/bank-providers/errors';
import type { BankProviderAccount, BankProviderBalance, BankProviderTransaction, BankProviderTransactions } from '@service/bank-providers/types';

import type { SimplefinAccount, SimplefinAccountSet, SimplefinError, SimplefinTransaction } from './simplefin-client';

/**
 * SimpleFIN's account set in the shapes the sync services read. Pure: no I/O, no clock.
 *
 *  - **Accounts** keep SimpleFIN's own account id, which the protocol says is stable. The bank
 *    (the v1 `org` or the v2 connection) becomes the institution, `simplefin:<bank>`.
 *  - **Currency** is the account's ISO 4217 code. A custom currency (the protocol allows a URL
 *    naming one, used for points or other non-money balances) is refused: the account is left out
 *    and the run reports `unsupported_currency`.
 *  - **Balances**: `balance` is the booked balance and `available-balance` the available one, both
 *    dated by `balance-date`.
 *  - **Transactions** keep SimpleFIN's id, which is unique and stable within an account. The
 *    `pending` flag files a row as pending; when the same id comes back posted, the sync's
 *    pending-to-posted reconciliation promotes the stored row in place. Amounts stay decimal
 *    strings (positive is money in) in the account's currency.
 *  - **Holdings** are ignored; investment holdings are issue #22.
 *  - **Errors**: `errlist` (and the deprecated `errors` strings) become one reported code per
 *    account and one for the whole connection, from SimpleFIN's documented `gen.`/`con.`/`act.`
 *    prefixes. The server's message text is never kept.
 */

/** The prefix stored ids carry, so a SimpleFIN row is recognisable in the shared id column. */
export const SIMPLEFIN_ID_PREFIX = 'simplefin';

export interface MappedSimplefinAccount {
  account: BankProviderAccount;
  balances: BankProviderBalance[];
  /** The bank's display name, for the institution row. */
  institutionName: string;
  /** Set when SimpleFIN reported a problem with this account (or its bank connection). */
  reportedErrorCode?: BankReportedErrorCode;
  transactions: BankProviderTransactions;
}

export interface MappedSimplefinAccountSet {
  accounts: MappedSimplefinAccount[];
  /** The institution the whole connection belongs to: one bank, or SimpleFIN itself for several. */
  connectionInstitution: { id: string; name: string };
  /** The connection-wide code, from errors that name no account of this set. */
  reportedErrorCode?: BankReportedErrorCode;
}

const ISO_CURRENCY = /^[A-Z]{3}$/;

/** Most severe first: the one that needs the user wins when several apply. */
const SEVERITY: readonly BankReportedErrorCode[] = ['authentication', 'institution_action_required', 'unsupported_currency', 'rate_limited', 'institution_unavailable', 'provider_unavailable'];

export function mapSimplefinAccountSet(set: SimplefinAccountSet): MappedSimplefinAccountSet {
  const connectionNames = new Map(set.connections.map((connection) => [connection.conn_id, connection]));
  const accountConnection = new Map(set.accounts.map((account) => [account.id, account.conn_id]));

  // Errors scoped to an account or to one bank connection fail those accounts; the rest apply to
  // the whole set.
  const byAccount = new Map<string, BankReportedErrorCode[]>();
  const byConnection = new Map<string, BankReportedErrorCode[]>();
  const connectionWide: BankReportedErrorCode[] = [];
  for (const error of set.errlist) {
    const code = reportedCodeOf(error);
    if (error.account_id && accountConnection.has(error.account_id)) push(byAccount, error.account_id, code);
    else if (error.conn_id && [...accountConnection.values()].includes(error.conn_id)) push(byConnection, error.conn_id, code);
    else connectionWide.push(code);
  }
  // The deprecated `errors` strings have no code. The SimpleFIN Bridge puts its request-quota
  // warnings there; anything else is a bank that needs attention.
  for (const message of set.errors) connectionWide.push(/\b(?:quota|rate|limit|too many requests)\b/i.test(message) ? 'rate_limited' : 'institution_action_required');

  const accounts: MappedSimplefinAccount[] = [];
  const institutions = new Map<string, string>();
  for (const account of set.accounts) {
    const currency = account.currency.trim().toUpperCase();
    if (!ISO_CURRENCY.test(currency)) {
      connectionWide.push('unsupported_currency');
      continue;
    }
    const institution = institutionOf(account, account.conn_id ? connectionNames.get(account.conn_id) : undefined);
    institutions.set(institution.id, institution.name);
    const codes = [...(byAccount.get(account.id) ?? []), ...(account.conn_id ? byConnection.get(account.conn_id) ?? [] : [])];
    accounts.push({
      account: {
        currency,
        externalId: account.id,
        institutionId: institution.id,
        name: cleanText(account.name) ?? institution.name,
      },
      balances: balancesOf(account),
      institutionName: institution.name,
      ...(codes.length > 0 ? { reportedErrorCode: mostSevere(codes) } : {}),
      transactions: transactionsOf(account, currency),
    });
  }

  const [single] = institutions.size === 1 ? [...institutions.entries()] : [];
  return {
    accounts,
    connectionInstitution: single ? { id: single[0], name: single[1] } : { id: SIMPLEFIN_ID_PREFIX, name: 'SimpleFIN' },
    ...(connectionWide.length > 0 ? { reportedErrorCode: mostSevere(connectionWide) } : {}),
  };
}

/** SimpleFIN's documented error-code prefixes, as a code the clients can explain. */
export function reportedCodeOf(error: Pick<SimplefinError, 'code'>): BankReportedErrorCode {
  const code = error.code.trim().toLowerCase();
  if (code === 'gen.auth') return 'authentication';
  if (code.startsWith('con.')) return 'institution_action_required';
  if (code.startsWith('act.')) return 'institution_unavailable';
  return 'provider_unavailable';
}

function balancesOf(account: SimplefinAccount): BankProviderBalance[] {
  const referenceDate = account['balance-date'] ? isoDateTime(account['balance-date']) : undefined;
  const dated = referenceDate ? { referenceDate } : {};
  const balances: BankProviderBalance[] = [{ balanceAmount: { amount: account.balance }, balanceType: 'closingBooked', ...dated }];
  if (account['available-balance'] !== undefined) balances.push({ balanceAmount: { amount: account['available-balance'] }, balanceType: 'interimAvailable', ...dated });
  return balances;
}

function cleanText(value: string | undefined): string | undefined {
  // Control characters become spaces; the rest is collapsed and capped like other bank text.
  const cleaned = value?.normalize('NFKC').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 255);
  return cleaned || undefined;
}

function institutionOf(account: SimplefinAccount, connection: undefined | { name?: string; org_id?: string; org_url?: string }): { id: string; name: string } {
  const name = cleanText(account.org?.name) ?? cleanText(connection?.name) ?? cleanText(account.org?.domain) ?? 'SimpleFIN';
  const key = account.org?.domain ?? account.org?.id ?? connection?.org_id ?? account.org?.name ?? connection?.name;
  const slug = key?.toLowerCase().replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return { id: slug ? `${SIMPLEFIN_ID_PREFIX}:${slug}` : SIMPLEFIN_ID_PREFIX, name };
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function isoDateTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function mostSevere(codes: BankReportedErrorCode[]): BankReportedErrorCode {
  return SEVERITY.find((code) => codes.includes(code)) ?? codes[0] ?? 'provider_unavailable';
}

function push(map: Map<string, BankReportedErrorCode[]>, key: string, code: BankReportedErrorCode) {
  map.set(key, [...(map.get(key) ?? []), code]);
}

function transactionOf(transaction: SimplefinTransaction, currency: string): BankProviderTransaction {
  const amount = transaction.amount.replace(/^\+/, '');
  const debit = amount.startsWith('-');
  const counterparty = cleanText(transaction.payee);
  // `posted` is 0 while a row is pending; the purchase time is then the best date there is.
  const posted = transaction.posted > 0 ? transaction.posted : undefined;
  const transacted = transaction.transacted_at && transaction.transacted_at > 0 ? transaction.transacted_at : undefined;
  const bookingSeconds = posted ?? transacted;
  return {
    ...(bookingSeconds ? { bookingDate: isoDate(bookingSeconds) } : {}),
    creditDebitIndicator: debit ? 'debit' : 'credit',
    ...(counterparty ? (debit ? { creditorName: counterparty } : { debtorName: counterparty }) : {}),
    // The stored, account-unique provider id; `transactionId` keeps SimpleFIN's bare id.
    internalTransactionId: `${SIMPLEFIN_ID_PREFIX}:${transaction.id}`,
    providerStatus: transaction.pending ? 'pending' : 'posted',
    remittanceInformationUnstructured: cleanText(transaction.description) ?? cleanText(transaction.memo),
    transactionAmount: { amount, currency },
    ...(transacted ? { transactionDate: isoDate(transacted) } : {}),
    transactionId: transaction.id,
  };
}

function transactionsOf(account: SimplefinAccount, currency: string): BankProviderTransactions {
  const booked: BankProviderTransaction[] = [];
  const pending: BankProviderTransaction[] = [];
  for (const transaction of account.transactions) {
    const mapped = transactionOf(transaction, currency);
    // A row with no date at all cannot be placed on the account; leave it for a later fetch.
    if (!mapped.bookingDate) continue;
    (transaction.pending ? pending : booked).push(mapped);
  }
  return { booked, pending };
}
