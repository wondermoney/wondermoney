import { csv } from '@wondermoney/shared';
import { z } from 'zod';

import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { Transaction } from '@entity/Transaction';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionStatus } from '@entity/TransactionStatus';
import { TransactionType } from '@entity/TransactionType';
import accountCsvBalanceRecalculationService from '@service/account/account-csv-balance-recalculation.service';
import accountCsvCategorizationService from '@service/account/account-csv-categorization.service';
import { getLimitedCsvObjectBuffer, getLimitedCsvObjectText, parseCsvRows } from '@service/account/csv-upload-boundary.service';
import type { Enqueue } from '@service/queue/enqueue';
import { triggerRecurringDetectionAfterTransactionIngestion } from '@service/recurring/post-transaction-ingestion-detection.service';
import { enqueueTransactionEnrichmentForTenant } from '@service/transaction-enrichment/transaction-enrichment-enqueue.service';
import { applyCategorizationOutcome } from '@service/transaction/categorization-confidence';
import { transactionCreationService } from '@service/transaction/transaction-creation.service';

export interface AccountCsvImportResult { failed: number; failures: { reason: string; row: number; }[]; imported: number; skipped: number; skippedRows: { reason: string; row: number; }[]; totalRows: number; }

interface AccountCsvRow { amount: string; currencyKey?: string; date: string; description?: string; internalTransactionId: string; merchant: string; transactionTypeKey: string; }
interface BankCsvRow { descriptionDirty?: string; internalTransactionId: string; originalAmount?: number | string | { toString: () => string }; originalCurrency?: string; settlementAmount: number | string | { toString: () => string }; settlementCurrency: string; transactionDate: Date; transactionMerchant: string; transactionType: string; }

const REQUIRED_FIELDS: (keyof AccountCsvRow)[] = ['date', 'amount', 'merchant', 'internalTransactionId', 'transactionTypeKey'];
const MAX_INVALID_ROWS = 100;
const OUTGOING_TRANSACTION_TYPES = new Set(['atm', 'card_payment', 'fee', 'fees', 'loan', 'payment', 'transfer_out']);

const accountCsvRowSchema = z.object({
  amount: z.coerce.number().finite(),
  currencyKey: z.string().trim().optional().transform((value) => (value ? toPositiveInt(value) : undefined)),
  date: z.string().trim().refine((value) => isValidDate(value), 'Invalid date').transform((value) => new Date(value)),
  description: z.string().trim().max(500).optional(),
  internalTransactionId: z.string().trim().min(1).max(255),
  merchant: z.string().trim().min(1).max(255),
  transactionTypeKey: z.string().trim().transform((value) => toPositiveInt(value)),
}).strict();

const bankCsvRowSchema = z.object({
  descriptionDirty: z.string().trim().max(500).optional(),
  internalTransactionId: z.string().trim().min(1).max(255),
  settlementAmount: z.preprocess((value) => toFiniteNumber(normalizeNumberInput(value) as number | string | { toString: () => string }), z.number().finite()),
  settlementCurrency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  transactionDate: z.union([z.string(), z.date()]).transform((value) => toDate(value)),
  transactionMerchant: z.string().trim().min(1).max(255),
  transactionType: z.string().trim().min(1).max(50),
}).passthrough();

export default class AccountCsvImportService {
  async importAccountCsv(input: { accountKey: number; bankName?: string; bucket: string; key: string }, deps: { em?: typeof DI.em; enqueue?: Enqueue; getObjectBuffer?: (bucket: string, key: string) => Promise<Buffer>; getObjectSize?: (bucket: string, key: string) => Promise<number | undefined>; getObjectText?: (bucket: string, key: string) => Promise<string>; transactionCreationService?: typeof transactionCreationService; } = {}): Promise<AccountCsvImportResult> {
    const em = deps.em ?? DI.em;
    const transactionCreationServiceImpl = deps.transactionCreationService ?? transactionCreationService;
    const account = await em.findOne(Account, { accountKey: input.accountKey, deletedAt: undefined }, { populate: ['accountOwnerAppuserKey.currencyKey', 'currencyKey'] });
    if (!account) throw new Error('Account not found');
    if (input.bankName) {
      const csvBuffer = await getLimitedCsvObjectBuffer({ bucket: input.bucket, key: input.key }, { getObjectBuffer: deps.getObjectBuffer, getObjectSize: deps.getObjectSize });
      return this.importBankCsv({ account, csvBuffer, em, enqueue: deps.enqueue, input });
    }
    const csvText = await getLimitedCsvObjectText({ bucket: input.bucket, key: input.key }, { getObjectSize: deps.getObjectSize, getObjectText: deps.getObjectText });
    const rows = parseCsvRows<AccountCsvRow>(csvText);
    const result: AccountCsvImportResult = { failed: 0, failures: [], imported: 0, skipped: 0, skippedRows: [], totalRows: 0 };
    for (const [i, row] of rows.entries()) {
      result.totalRows += 1;
      const missing = REQUIRED_FIELDS.filter((field) => !row[field]);
      if (missing.length) {
        result.failed += 1;
        result.failures.push({ reason: `missing ${missing.join(', ')}`, row: i + 2 });
        if (result.failed >= MAX_INVALID_ROWS) break;
        continue;
      }
      try {
        const validated = accountCsvRowSchema.parse(row);
        const duplicate = await em.findOne(Transaction, { accountKey: account, nordigenInternalTransactionId: validated.internalTransactionId });
        if (duplicate) { result.skipped += 1; result.skippedRows.push({ reason: 'Duplicate internalTransactionId', row: i + 2 }); continue; }
        await transactionCreationServiceImpl.createTransaction({ accountId: account.accountKey, appuserKey: (account.accountOwnerAppuserKey as { appuserKey: number }).appuserKey, description: validated.description, nordigenInternalTransactionId: validated.internalTransactionId, settlementAmount: Math.abs(validated.amount), settlementCurrencyId: validated.currencyKey || (account.currencyKey as { currencyKey: number }).currencyKey, transactionDate: validated.date, transactionMerchantName: validated.merchant, transactionTypeId: validated.transactionTypeKey });
        result.imported += 1;
      } catch (error) { result.failed += 1; result.failures.push({ reason: error instanceof Error ? error.message : 'import failed', row: i + 2 }); if (result.failed >= MAX_INVALID_ROWS) break; }
    }
    return result;
  }

  private async findOrCreateMerchant(em: typeof DI.em, merchantName: string) {
    const existing = await em.findOne(TransactionMerchant, { name: merchantName });
    if (existing) return existing;

    if (typeof (em as { upsert?: unknown }).upsert === 'function') {
      const upserted = await (em as typeof DI.em & { upsert: (entity: typeof TransactionMerchant, data: { name: string }) => Promise<TransactionMerchant> }).upsert(TransactionMerchant, { name: merchantName });
      return upserted;
    }

    const knex = em.getKnex();
    await knex.insert({ name: merchantName }).into('transaction_merchant').onConflict('name').ignore();
    const merchant = await em.findOne(TransactionMerchant, { name: merchantName });
    if (merchant) return merchant;
    throw new Error(`TransactionMerchant not found: ${merchantName}`);
  }

  private async getAppuserSettlementAmount(em: typeof DI.em, appuserCurrency: Currency, settlementCurrency: Currency, transactionDate: Date, settlementAmount: number) {
    if (appuserCurrency.currencyKey === settlementCurrency.currencyKey) return settlementAmount;
    const exchangeRate = await findAppuserExchangeRate(em, settlementCurrency, appuserCurrency, transactionDate);
    return exchangeRate ? settlementAmount * exchangeRate.rate : settlementAmount;
  }

  private async importBankCsv(input: { account: Account; csvBuffer: Buffer; em: typeof DI.em; enqueue?: Enqueue; input: { accountKey: number; bankName?: string } }): Promise<AccountCsvImportResult> {
    const parsed = await csv.parseExcel(input.csvBuffer);
    const parseBankRows = csv.getBankParser(input.input.bankName ?? '') as unknown as (data: unknown) => BankCsvRow[];
    const rows = parseBankRows(parsed);
    const result: AccountCsvImportResult = { failed: 0, failures: [], imported: 0, skipped: 0, skippedRows: [], totalRows: 0 };
    const importedTransactions: Transaction[] = [];
    const bookedStatus = (await input.em.findOne(TransactionStatus, { name: 'BOOKED' })) ?? ({ transactionStatusKey: 0 } as TransactionStatus);
    const accountCurrency = input.account.currencyKey;
    const accountOwner = input.account.accountOwnerAppuserKey as { appuserKey: number; currencyKey?: Currency; tenantKey?: { tenantKey: number } };
    const appuserCurrency = accountOwner.currencyKey ?? accountCurrency;
    const runInTransaction = async (em: typeof input.em) => {
      for (const [i, row] of rows.entries()) {
        result.totalRows += 1;
        try {
          const validated = bankCsvRowSchema.parse(row);
          const duplicate = await em.findOne(Transaction, { $or: [{ internalTransactionId: validated.internalTransactionId }, { nordigenInternalTransactionId: validated.internalTransactionId }], accountKey: input.account });
          if (duplicate) { result.skipped += 1; result.skippedRows.push({ reason: 'Duplicate internalTransactionId', row: i + 1 }); continue; }
          const transactionType = await em.findOne(TransactionType, { name: resolveTransactionTypeName(validated.transactionType, validated.settlementAmount) });
          if (!transactionType) throw new Error(`TransactionType not found: ${row.transactionType}`);
          const currency = await em.findOne(Currency, { code: validated.settlementCurrency });
          if (!currency) throw new Error(`Currency not found: ${row.settlementCurrency}`);
          const merchant = await this.findOrCreateMerchant(em, validated.transactionMerchant);
          const signedAmount = signAmount(validated.settlementAmount, transactionType.name);
          const sameCurrency = currency.currencyKey === appuserCurrency.currencyKey;
          const appuserSettlementAmount = sameCurrency ? signedAmount : await this.getAppuserSettlementAmount(em, appuserCurrency, currency, validated.transactionDate, signedAmount);
          const originalAmountValue = validated['originalAmount'];
          const originalCurrencyValue = validated['originalCurrency'];
          const originalAmount = originalAmountValue !== undefined ? toFiniteNumber(normalizeNumberInput(originalAmountValue) as number | string | { toString: () => string }) : signedAmount;
          const originalCurrencyCode = typeof originalCurrencyValue === 'string' ? originalCurrencyValue.toUpperCase() : undefined;
          const originalCurrencyKey = originalCurrencyCode ? await em.findOne(Currency, { code: originalCurrencyCode }) : currency;
          if (originalCurrencyCode && !originalCurrencyKey) throw new Error(`Currency not found: ${originalCurrencyCode}`);
          const transaction = new Transaction();
          transaction.accountKey = input.account;
          transaction.appuserCurrencyBalance = undefined;
          transaction.appuserCurrencyKey = appuserCurrency;
          transaction.appuserKey = input.account.accountOwnerAppuserKey;
          transaction.appuserSettlementAmount = appuserSettlementAmount;
          transaction.descriptionDirty = validated.descriptionDirty;
          transaction.internalTransactionId = validated.internalTransactionId;
          transaction.nordigenInternalTransactionId = validated.internalTransactionId;
          transaction.originalAmount = originalAmount;
          transaction.originalCurrencyKey = originalCurrencyKey ?? undefined;
          transaction.settlementAmount = signedAmount;
          transaction.settlementCurrencyKey = currency;
          transaction.tenantKey = input.account.tenantKey;
          transaction.transactionDate = validated.transactionDate;
          transaction.transactionMerchantKey = merchant;
          transaction.transactionStatusKey = bookedStatus;
          transaction.transactionTypeKey = transactionType;
          importedTransactions.push(transaction);
          result.imported += 1;
        } catch (error) { result.failed += 1; result.failures.push({ reason: error instanceof Error ? error.message : 'import failed', row: i + 1 }); if (result.failed >= MAX_INVALID_ROWS) break; }
      }
      const existingTransactions = await em.find(Transaction, { accountKey: input.account, deletedAt: undefined });
      const plan = accountCsvBalanceRecalculationService.planBankBalances(input.account, existingTransactions, importedTransactions);
      input.account.balance = plan.accountBalance;
      if (plan.accountAppuserBalance !== undefined) input.account.appuserCurrencyBalance = plan.accountAppuserBalance;
      for (const item of plan.items) {
        item.transaction.balance = item.balance;
        if (item.appuserBalance !== undefined) item.transaction.appuserCurrencyBalance = item.appuserBalance;
        await em.persist(item.transaction).flush();
        if (item.imported) {
          const outcome = await accountCsvCategorizationService.categorizeTransaction(em, input.account.accountOwnerAppuserKey, item.transaction);
          applyCategorizationOutcome(item.transaction, outcome.reason);
          await em.persist(item.transaction).flush();
        }
      }
    };
    const transactional = Reflect.get(input.em as object, 'transactional') as unknown;
    if (typeof transactional === 'function') await (transactional as (fn: typeof runInTransaction) => Promise<void>)(runInTransaction); else await runInTransaction(input.em);
    const accountTenant = input.account as { tenantKey?: { tenantKey: number } };
    if (result.imported > 0 && accountTenant.tenantKey) await triggerRecurringDetectionAfterTransactionIngestion(accountTenant.tenantKey.tenantKey, 'transaction-import');
    // RAD-414: best-effort, fail-open shadow enrichment enqueue. Dormant by default; never blocks import.
    if (result.imported > 0 && accountTenant.tenantKey) await enqueueTransactionEnrichmentForTenant(accountTenant.tenantKey.tenantKey, 'transaction-import', { enqueue: input.enqueue });
    return result;
  }
}

async function findAppuserExchangeRate(em: typeof DI.em, fromCurrency: Currency, toCurrency: Currency, date: Date) {
  const latest = await em.findOne(ExchangeRate, { date: { $lte: date }, fromCurrency, toCurrency }, { orderBy: { date: 'DESC', toCurrency: 'ASC' } });
  if (latest) return latest;
  return em.findOne(ExchangeRate, { fromCurrency, toCurrency }, { orderBy: { date: 'ASC', toCurrency: 'ASC' } });
}

function isValidDate(value: string) {
  return !Number.isNaN(new Date(value).getTime());
}

function normalizeNumberInput(value: unknown) {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toString' in value) return value.toString();
  return value;
}

function resolveTransactionTypeName(type: string, amount: number) {
  if (type === 'FEES') return 'FEE';
  if (type === 'TRANSFER') return amount >= 0 ? 'TRANSFER_IN' : 'TRANSFER_OUT';
  return type;
}

function signAmount(amount: number, typeName: string) {
  const normalized = typeName.toLowerCase();
  const abs = Math.abs(amount);
  return OUTGOING_TRANSACTION_TYPES.has(normalized) ? -abs : abs;
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

function toPositiveInt(value: string) {
  if (!/^[1-9]\d*$/.test(value.trim())) throw new Error('Invalid positive integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('Invalid positive integer');
  return parsed;
}
