import { z } from 'zod';

import type { DI } from '@app/database/di';
import type { Account } from '@entity/Account';
import { Currency } from '@entity/Currency';
import { FxStatus, Transaction } from '@entity/Transaction';
import { TransactionAuditActorType } from '@entity/TransactionAuditLog';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionStatus } from '@entity/TransactionStatus';
import { TransactionType } from '@entity/TransactionType';
import accountCsvBalanceRecalculationService from '@service/account/account-csv-balance-recalculation.service';
import accountCsvCategorizationService from '@service/account/account-csv-categorization.service';
import type { StatementRow } from '@service/account/account-statement-reader';
import { convertWithStatus, rateScope } from '@service/currency/exchange-rate';
import type { Enqueue } from '@service/queue/enqueue';
import { triggerRecurringDetectionAfterTransactionIngestion } from '@service/recurring/post-transaction-ingestion-detection.service';
import { applyRulesToNewTransactions } from '@service/rules/rule-application.service';
import { enqueueTransactionEnrichmentForTenant } from '@service/transaction-enrichment/transaction-enrichment-enqueue.service';
import { applyCategorizationOutcome } from '@service/transaction/categorization-confidence';
import { transactionTypeForSignedAmount } from '@service/transaction/transaction-direction';
import { reconcileTransfers } from '@service/transaction/transfer-matching.service';
import logger from '@utils/logger';

/**
 * Writing bank statement lines as transactions, in three steps both statement imports share (the
 * one-step `AccountCsvImportService` and the staged `transaction-import` commit):
 *
 *   build    one line → one unsaved `Transaction`, signed as the file states it
 *   settle   the account's balance chain, the household's rules and learned categories, inside
 *            the import's database transaction
 *   follow   transfer matching, recurring detection and enrichment, best-effort, afterwards
 */

type EM = typeof DI.em;

/** A statement line as the bank parsers and the statement reader return one. */
export interface StatementLine {
  descriptionDirty?: string;
  internalTransactionId: string;
  originalAmount?: number | string | { toString: () => string };
  originalCurrency?: string;
  settlementAmount: number | string | { toString: () => string };
  settlementCurrency: string;
  sourceRow?: number;
  transactionDate: Date;
  transactionMerchant: string;
  transactionType: string;
}

export const statementLineSchema = z.object({
  descriptionDirty: z.string().trim().max(500).optional(),
  internalTransactionId: z.string().trim().min(1).max(255),
  settlementAmount: z.preprocess((value) => toFiniteNumber(normalizeNumberInput(value) as number | string | { toString: () => string }), z.number()),
  settlementCurrency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  transactionDate: z.union([z.string(), z.date()]).transform((value) => toDate(value)),
  transactionMerchant: z.string().trim().min(1).max(255),
  transactionType: z.string().trim().min(1).max(50),
}).loose();

/** A line the statement reader read under a column mapping. Its type is a label the sign decides; transfer matching re-types own-account transfers. */
export function statementRowToLine(row: StatementRow, accountCurrencyCode: string): StatementLine {
  return { descriptionDirty: row.description, internalTransactionId: row.internalTransactionId, settlementAmount: row.amount, settlementCurrency: row.currency ?? accountCurrencyCode, sourceRow: row.sourceRow, transactionDate: row.date, transactionMerchant: row.description.slice(0, 255), transactionType: row.amount < 0 ? 'PAYMENT' : 'DEPOSIT' };
}

/** Lookups one import repeats for every line, kept for the length of the import. */
export interface StatementWriteContext {
  account: Account;
  appuserCurrency: Currency;
  bookedStatus: TransactionStatus;
  currencies: Map<string, Currency | null>;
  merchants: Map<string, TransactionMerchant>;
  types: Map<string, null | TransactionType>;
}

/** `account` loaded with `accountOwnerAppuserKey.currencyKey` and `currencyKey`. */
export async function statementWriteContext(em: EM, account: Account): Promise<StatementWriteContext> {
  const bookedStatus = (await em.findOne(TransactionStatus, { name: 'BOOKED' })) ?? ({ transactionStatusKey: 0 } as TransactionStatus);
  const accountOwner = account.accountOwnerAppuserKey as { currencyKey?: Currency };
  return { account, appuserCurrency: accountOwner.currencyKey ?? account.currencyKey, bookedStatus, currencies: new Map(), merchants: new Map(), types: new Map() };
}

/**
 * One statement line as an unsaved transaction. Throws, with the reason, on a line that does not
 * read (a missing merchant, an unknown currency).
 *
 * `trustedId: false` stores the line's id as its fingerprint only, not as its unique provider id:
 * for a line the person imports although the same id is already on the account (or earlier in the
 * file), which the account's unique `nordigenInternalTransactionId` would refuse.
 */
export async function buildStatementTransaction(em: EM, context: StatementWriteContext, line: StatementLine, options: { trustedId?: boolean } = {}): Promise<Transaction> {
  const validated = statementLineSchema.parse(line);
  // The bank file states the direction in the amount's sign; the type guessed from the
  // description is only a label, so it is made to agree with the sign rather than the reverse.
  const signedAmount = validated.settlementAmount;
  const transactionType = await cached(context.types, transactionTypeForSignedAmount(resolveTransactionTypeName(validated.transactionType), signedAmount), (name) => em.findOne(TransactionType, { name }));
  if (!transactionType) throw new Error(`TransactionType not found: ${line.transactionType}`);
  const currency = await cached(context.currencies, validated.settlementCurrency, (code) => em.findOne(Currency, { code }));
  if (!currency) throw new Error(`Currency not found: ${line.settlementCurrency}`);
  const merchant = await findOrCreateMerchant(em, context, validated.transactionMerchant);
  // Through the one rate resolver: with no rate on or before the row's date, no converted
  // amount is stored (`missing`), never the amount in the account's currency.
  const converted = await convertWithStatus(em, signedAmount, currency, context.appuserCurrency, validated.transactionDate, rateScope(context.account.tenantKey));
  const originalAmountValue = validated['originalAmount'];
  const originalCurrencyValue = validated['originalCurrency'];
  const originalAmount = originalAmountValue !== undefined ? toFiniteNumber(normalizeNumberInput(originalAmountValue) as number | string | { toString: () => string }) : signedAmount;
  const originalCurrencyCode = typeof originalCurrencyValue === 'string' ? originalCurrencyValue.toUpperCase() : undefined;
  const originalCurrencyKey = originalCurrencyCode ? await cached(context.currencies, originalCurrencyCode, (code) => em.findOne(Currency, { code })) : currency;
  if (originalCurrencyCode && !originalCurrencyKey) throw new Error(`Currency not found: ${originalCurrencyCode}`);
  const { account } = context;
  const transaction = new Transaction();
  transaction.accountKey = account;
  transaction.appuserCurrencyBalance = undefined;
  transaction.appuserCurrencyKey = context.appuserCurrency;
  transaction.appuserKey = account.accountOwnerAppuserKey;
  transaction.appuserSettlementAmount = converted.amount;
  transaction.appuserCurrencyExchangeRate = converted.rate ?? undefined;
  transaction.fxStatus = converted.fxStatus;
  transaction.descriptionDirty = validated.descriptionDirty;
  transaction.internalTransactionId = validated.internalTransactionId;
  transaction.nordigenInternalTransactionId = options.trustedId === false ? undefined : validated.internalTransactionId;
  transaction.originalAmount = originalAmount;
  transaction.originalCurrencyKey = originalCurrencyKey ?? undefined;
  transaction.settlementAmount = signedAmount;
  transaction.settlementCurrencyKey = currency;
  transaction.tenantKey = account.tenantKey;
  transaction.transactionDate = validated.transactionDate;
  transaction.transactionMerchantKey = merchant;
  transaction.transactionStatusKey = context.bookedStatus;
  transaction.transactionTypeKey = transactionType;
  return transaction;
}

/**
 * Inside the import's database transaction, once its lines are written: the account's balance
 * chain over `existing` and `imported` rows, then the household's rules once for every imported
 * row, then learned categorization, which leaves a row a rule categorized as it is. A rule
 * failure never fails the import.
 */
export async function settleStatementImport(em: EM, account: Account, existing: Transaction[], imported: Transaction[]): Promise<void> {
  const plan = accountCsvBalanceRecalculationService.planBankBalances(account, existing, imported);
  account.balance = plan.accountBalance;
  if (plan.accountAppuserBalance !== undefined) {
    account.appuserCurrencyBalance = plan.accountAppuserBalance;
    if (plan.accountAppuserBalance === null) account.fxStatus = FxStatus.MISSING;
  }
  // Rows back-derived from the current balance move the chain's head: keep the opening balance
  // on it, so net worth history and a head-anchored rebuild agree with the stored rows.
  if (plan.openingBalance !== undefined) {
    account.openingBalance = plan.openingBalance;
    account.openingBalanceDate ??= account.createdAt;
  }
  for (const item of plan.items) {
    item.transaction.balance = item.balance;
    if (item.appuserBalance !== undefined) item.transaction.appuserCurrencyBalance = item.appuserBalance;
    em.persist(item.transaction);
  }
  // The account itself is flushed with them, or by the import's transaction when nothing changed.
  if (plan.items.length > 0) await em.persist(account).flush();
  const settled = plan.items.filter((item) => item.imported).map((item) => item.transaction);
  const tenantKey = tenantKeyOf(account);
  if (tenantKey !== undefined) await applyRulesToNewTransactions(em, tenantKey, settled.map((transaction) => transaction.transactionKey), 'transaction-import');
  for (const transaction of settled) {
    const outcome = await accountCsvCategorizationService.categorizeTransaction(em, account.accountOwnerAppuserKey, transaction);
    applyCategorizationOutcome(transaction, outcome.reason);
    em.persist(transaction);
  }
  if (settled.length > 0) await em.persist(settled).flush();
}

/**
 * After the import's transaction commits: pair the imported halves of transfers between the
 * household's own accounts, then queue recurring detection and (dormant by default) enrichment.
 * Best-effort: none of it fails an import whose rows are stored.
 */
export async function followUpStatementImport(em: EM, account: Account, importedDates: Date[], deps: { enqueue?: Enqueue } = {}): Promise<void> {
  await matchTransfersAfterImport(em, account, importedDates);
  const tenantKey = tenantKeyOf(account);
  if (importedDates.length === 0 || tenantKey === undefined) return;
  await triggerRecurringDetectionAfterTransactionIngestion(tenantKey, 'transaction-import');
  await enqueueTransactionEnrichmentForTenant(tenantKey, 'transaction-import', { enqueue: deps.enqueue });
}

/**
 * Pair the imported rows that are one half of a transfer between two of the household's own
 * accounts, from the earliest imported date on, as bank sync does after each sync. On its own forked
 * EM in one transaction, so a failure rolls back whole. Best-effort: matching never fails an import
 * whose rows are already stored; the next import or sync matches again.
 */
export async function matchTransfersAfterImport(em: EM, account: Account, importedDates: Date[]) {
  const tenantKey = tenantKeyOf(account);
  if (tenantKey === undefined || importedDates.length === 0) return;
  const from = new Date(importedDates.reduce((earliest, date) => Math.min(earliest, date.getTime()), Infinity));
  try {
    const matched = await em.fork().transactional((tx) => reconcileTransfers(tx, { actorType: TransactionAuditActorType.SYSTEM, apply: true, from, source: 'transfer-matching', tenantKey }));
    if (matched.rowsChanged > 0) logger.info({ ...matched, tenantKey }, 'Matched own-account transfers');
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error), tenantKey }, 'Transfer matching failed');
  }
}

async function cached<T>(cache: Map<string, null | T>, key: string, load: (key: string) => Promise<null | T>): Promise<null | T> {
  if (cache.has(key)) return cache.get(key) ?? null;
  const value = await load(key);
  cache.set(key, value);
  return value;
}

async function findOrCreateMerchant(em: EM, context: StatementWriteContext, merchantName: string) {
  const known = context.merchants.get(merchantName);
  if (known) return known;
  const existing = await em.findOne(TransactionMerchant, { name: merchantName });
  if (existing) {
    context.merchants.set(merchantName, existing);
    return existing;
  }
  // Through the ORM, not upsert or a raw insert: those skip the entity defaults and send no
  // created_at, which violates its NOT NULL and aborts the whole import transaction.
  const merchant = em.create(TransactionMerchant, { name: merchantName }, { partial: true });
  await em.persist(merchant).flush();
  context.merchants.set(merchantName, merchant);
  return merchant;
}

function normalizeNumberInput(value: unknown) {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toString' in value) return value.toString();
  return value;
}

function resolveTransactionTypeName(type: string) {
  if (type === 'FEES') return 'FEE';
  return type;
}

function tenantKeyOf(account: Account): number | undefined {
  return (account as { tenantKey?: { tenantKey: number } }).tenantKey?.tenantKey;
}

function toDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  return date;
}

function toFiniteNumber(value: number | string | { toString: () => string }) {
  const parsed = typeof value === 'number' ? value : Number(value.toString());
  if (!Number.isFinite(parsed)) throw new Error('Invalid number');
  return parsed;
}
