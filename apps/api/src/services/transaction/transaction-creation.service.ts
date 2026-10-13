import { QueryOrder } from '@mikro-orm/core';
import { generateInternalTransactionId } from '@wondermoney/shared';

import { DI } from '@app/app';
import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Category } from '@entity/Category';
import { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionStatus } from '@entity/TransactionStatus';
import { TransactionType } from '@entity/TransactionType';
import { triggerRecurringDetectionAfterTransactionIngestion } from '@service/recurring/post-transaction-ingestion-detection.service';
import { accumulateChain, loadChainRows, SETTLED_TRANSACTION_STATUSES } from '@service/transaction/balance-chain.service';
import { findAssignableCategory } from '@service/transaction/household-category';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { transactionMerchantService } from '@service/transaction/transaction-merchant.service';
import { applyUserCategorization } from '@service/transaction/user-categorization.service';
import { InternalServerError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';
import { addMoney, convertMoney } from '@utils/money';

export interface TransactionData {
  accountId: number;
  appuserKey: number;
  categoryId?: null | number;
  description?: string;
  exchangeRate?: number;
  nordigenInternalTransactionId?: string;
  originalAmount?: number;
  originalCurrencyId?: number;
  settlementAmount: number;
  settlementCurrencyId: number;
  transactionDate: Date;
  transactionMerchantId?: null | number;
  transactionMerchantName?: null | string;
  transactionTypeId: number;
}

interface PreparedTransaction {
  account: Account;
  appuser: Appuser;
  appUserTenant: AppuserTenant;
  transaction: Transaction;
  transactionType: TransactionType;
}

function getTenantKeyValue(tenantKey: Transaction['tenantKey']): number {
  if (!tenantKey) {
    throw new InternalServerError('Transaction tenant not set');
  }

  return tenantKey.tenantKey;
}

/**
 * Service responsible for creating transactions with complex balance calculations
 * Extracted from the 438-line createTransactionLogic function in account.ts
 */
class TransactionCreationService {
  /**
   * Main entry point - creates a transaction with balance recalculation
   */
  async createTransaction(data: TransactionData): Promise<Transaction> {
    try {
      logger.info({ accountId: data.accountId }, 'Creating transaction');

      // Phase 1: Validate and prepare all entities
      const prepared = await this.validateAndPrepareTransaction(data);

      // Phase 2: Create the transaction entity
      this.buildTransactionEntity(prepared.transaction, data, prepared);

      // Phase 3: Set currency and calculate amounts
      await this.setCurrencyAndAmounts(prepared.transaction, data, prepared);

      // Phase 4: Handle merchant
      await this.setMerchant(prepared.transaction, data, prepared.appUserTenant);

      // Phase 5: Resolve the category if provided. RAD-546: only *resolve* it here — writing the
      // AppuserTransactionCategory link cascade-persists the still-unbalanced transaction, so the
      // link has to wait until phase 9, after the balance chain has been computed and stored.
      // Resolving up-front keeps the "unknown category never creates a transaction" behaviour.
      const category = data.categoryId ? await this.resolveCategory(data.categoryId, prepared.appUserTenant) : null;

      // Phase 6: Set transaction status
      await this.setStatus(prepared.transaction);

      // Phase 7: Calculate balance based on account state
      await this.calculateAndSetBalance(prepared.transaction, prepared.account);

      // Phase 8: Persist the transaction
      await DI.em.persist(prepared.transaction).flush();

      // Phase 9: Link the resolved category and update the merchant→category signals
      if (category) {
        await applyUserCategorization(DI.em, { actor: prepared.appuser, category, transactions: [prepared.transaction] });
      }

      // RAD-346: record the creation in the audit trail (best-effort; never blocks the create).
      await TransactionAuditService.log(DI.em, {
        accountKey: data.accountId,
        actorAppuserKey: data.appuserKey,
        actorType: TransactionAuditActorType.USER,
        appuserKey: data.appuserKey,
        eventType: TransactionAuditEventType.CREATED,
        source: 'manual-transaction',
        tenantKey: getTenantKeyValue(prepared.transaction.tenantKey),
        transactionKey: prepared.transaction.transactionKey,
      });

      await triggerRecurringDetectionAfterTransactionIngestion(
        getTenantKeyValue(prepared.transaction.tenantKey),
        'manual-transaction',
      );

      logger.info({ transactionKey: prepared.transaction.transactionKey }, 'Transaction created successfully');

      return prepared.transaction;
    } catch (error) {
      logger.error({ accountId: data.accountId, error }, 'Failed to create transaction');
      throw error;
    }
  }

  /**
   * Phase 1: Validate all required entities and return them
   */
  private async validateAndPrepareTransaction(data: TransactionData): Promise<PreparedTransaction> {
    const appuser = await DI.em.findOne(Appuser, { appuserKey: data.appuserKey }, { populate: ['currencyKey'] });
    if (!appuser) {
      throw new InternalServerError('User not found');
    }

    const appUserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(appuser);
    if (!appUserTenant) {
      throw new InternalServerError("User doesn't have AppuserTenant");
    }

    const transactionType = await DI.em.findOne(TransactionType, {
      transactionTypeKey: data.transactionTypeId,
    });
    if (!transactionType) {
      throw new InternalServerError(`TransactionType not found: ${data.transactionTypeId}`);
    }

    const account = await DI.em.findOne(
      Account,
      {
        accountKey: data.accountId,
        accountOwnerAppuserKey: appuser,
        deletedAt: undefined,
      },
      { populate: ['currencyKey'] },
    );
    if (!account) {
      throw new InternalServerError(`Account not found: ${data.accountId}`);
    }

    const transaction = new Transaction();

    return {
      account,
      appuser,
      appUserTenant,
      transaction,
      transactionType,
    };
  }

  /**
   * Phase 2: Build the basic transaction entity
   */
  private buildTransactionEntity(transaction: Transaction, data: TransactionData, prepared: PreparedTransaction): void {
    transaction.reviewed = true;
    transaction.transactionDate = data.transactionDate;
    transaction.internalTransactionId = generateInternalTransactionId(data.transactionDate, data.originalAmount ?? data.settlementAmount);
    transaction.nordigenInternalTransactionId = data.nordigenInternalTransactionId;
    transaction.transactionTypeKey = prepared.transactionType;
    transaction.settlementExchangeRate = data.exchangeRate;
    transaction.accountKey = prepared.account;
    transaction.description = data.description ?? undefined;
    transaction.appuserKey = prepared.appUserTenant.appuserKey;
    transaction.tenantKey = prepared.appUserTenant.tenantKey;
  }

  /**
   * Phase 3: Set currencies and calculate amounts with proper sign
   */
  private async setCurrencyAndAmounts(
    transaction: Transaction,
    data: TransactionData,
    prepared: PreparedTransaction,
  ): Promise<void> {
    const transactionType = prepared.transactionType;
    const appuser = prepared.appuser;

    // Determine sign based on transaction type
    const isOutgoingTransaction = ['atm', 'card_payment', 'fee', 'fees', 'loan', 'payment', 'transfer_out'].includes(
      transactionType.name.toLowerCase(),
    );

    // Handle original amount and currency
    if (data.originalAmount && data.originalCurrencyId) {
      const originalCurrency = await DI.em.findOne(Currency, { currencyKey: data.originalCurrencyId });
      if (!originalCurrency) {
        throw new InternalServerError(`Currency not found: ${data.originalCurrencyId}`);
      }

      transaction.originalAmount = isOutgoingTransaction ? -data.originalAmount : data.originalAmount;
      transaction.originalCurrencyKey = originalCurrency;
    }

    // Handle settlement amount and currency
    const transactionCurrency = await DI.em.findOne(Currency, {
      currencyKey: data.settlementCurrencyId,
    });
    if (!transactionCurrency) {
      throw new InternalServerError(`Currency not found: ${data.settlementCurrencyId}`);
    }

    transaction.settlementAmount = isOutgoingTransaction ? -data.settlementAmount : data.settlementAmount;
    transaction.settlementCurrencyKey = transactionCurrency;

    // Calculate appuser currency amount
    const userCurrency = appuser.currencyKey;
    transaction.appuserCurrencyKey = userCurrency;

    const isTransactionCurrencyDifferentFromUserCurrency = transactionCurrency !== userCurrency;
    if (isTransactionCurrencyDifferentFromUserCurrency) {
      const rate = await DI.em.findOne(
        ExchangeRate,
        {
          date: { $lte: data.transactionDate },
          fromCurrency: transactionCurrency,
          toCurrency: userCurrency,
        },
        {
          orderBy: { date: QueryOrder.DESC },
        },
      );

      if (rate) {
        transaction.appuserSettlementAmount = convertMoney(transaction.settlementAmount, rate.rate);
      }
    } else {
      transaction.appuserSettlementAmount = transaction.settlementAmount;
    }
  }

  /**
   * Phase 4: Handle merchant (existing or new)
   */
  private async setMerchant(transaction: Transaction, data: TransactionData, prepared: AppuserTenant): Promise<void> {
    transaction.transactionMerchantKey = await transactionMerchantService.resolveMerchant({
      tenant: prepared.tenantKey,
      transactionMerchantId: data.transactionMerchantId,
      transactionMerchantName: data.transactionMerchantName,
    });
  }

  /**
   * Phase 5: Resolve the requested category (read-only — see phase 9 for the write)
   */
  private async resolveCategory(categoryId: number, appUserTenant: AppuserTenant): Promise<Category> {
    const category = await findAssignableCategory(DI.em, appUserTenant.tenantKey, categoryId);

    if (!category) {
      throw new NotFoundError('Category not found');
    }

    return category;
  }

  /**
   * Phase 6: Set transaction status
   */
  private async setStatus(transaction: Transaction): Promise<void> {
    const transactionStatus = await DI.em.findOne(TransactionStatus, {
      name: 'BOOKED',
    });

    if (!transactionStatus) {
      throw new InternalServerError('TransactionStatus not found: BOOKED');
    }

    transaction.transactionStatusKey = transactionStatus;
  }

  /**
   * Phase 7: Place the transaction in the account's running-balance chain.
   *
   * The chain is a single total order — `(transactionDate, transactionKey)`, the same order the
   * transactions list endpoint renders — over which `balance` accumulates from the account's
   * opening balance. A new transaction therefore takes the balance of whatever precedes it, adds
   * its own amount, and every later transaction is re-accumulated from there (RAD-546). Insertion
   * order is irrelevant: only the position in that total order matters.
   */
  private async calculateAndSetBalance(transaction: Transaction, account: Account): Promise<void> {
    const preceding = await this.findPrecedingBalance(transaction, account);

    transaction.balance = addMoney(preceding.balance, transaction.settlementAmount);
    transaction.appuserCurrencyBalance = addMoney(preceding.appuserCurrencyBalance, transaction.appuserSettlementAmount);

    await this.recalculateFutureBalances(transaction, account);
  }

  /**
   * The account balance immediately before the new transaction's position in the chain.
   *
   * Three sources, in order of preference:
   *  - the closest preceding transaction's stored balance;
   *  - when the new transaction is the oldest, the balance the first later transaction started
   *    from (its stored balance minus its own amount);
   *  - the account's opening balance, when it has no transactions at all.
   */
  private async findPrecedingBalance(
    transaction: Transaction,
    account: Account,
  ): Promise<{ appuserCurrencyBalance: number; balance: number }> {
    // A new row always sorts last within its own date (serial key), so same-date rows precede it.
    const mostRecentOlder = await DI.em.findOne(
      Transaction,
      {
        accountKey: account,
        // RAD-564: same membership as the rest of the chain — settled rows only, so a PENDING row
        // with no stored balance can never be picked as a predecessor and read as zero.
        transactionDate: { $lte: transaction.transactionDate },
        transactionStatusKey: { name: { $in: [...SETTLED_TRANSACTION_STATUSES] } },
      },
      {
        // RAD-25: the chain is physical, so hidden rows count here too.
        filters: { [HIDDEN_FILTER]: false },
        // RAD-546: `transactionKey` breaks date ties deterministically and in the same direction as
        // the transactions list. Ordering by date alone let Postgres pick any same-date row.
        orderBy: { transactionDate: QueryOrder.DESC, transactionKey: QueryOrder.DESC },
      },
    );

    if (mostRecentOlder) {
      logger.debug('Handling newer transaction scenario');

      return {
        appuserCurrencyBalance: mostRecentOlder.appuserCurrencyBalance ?? 0,
        balance: mostRecentOlder.balance ?? 0,
      };
    }

    const firstNewer = await DI.em.findOne(
      Transaction,
      {
        accountKey: account,
        transactionDate: { $gt: transaction.transactionDate },
        transactionStatusKey: { name: { $in: [...SETTLED_TRANSACTION_STATUSES] } },
      },
      {
        filters: { [HIDDEN_FILTER]: false },
        orderBy: { transactionDate: QueryOrder.ASC, transactionKey: QueryOrder.ASC },
      },
    );

    if (firstNewer) {
      logger.debug('Handling older transaction scenario');

      return {
        appuserCurrencyBalance: (firstNewer.appuserCurrencyBalance ?? 0) - (firstNewer.appuserSettlementAmount ?? 0),
        balance: (firstNewer.balance ?? 0) - (firstNewer.settlementAmount ?? 0),
      };
    }

    logger.debug('Handling empty account scenario');

    // First transaction on the account: the manually entered balance is the opening balance and the
    // transaction is applied on top of it, whether it is back-dated or not (RAD-529, RAD-546).
    return {
      appuserCurrencyBalance: account.appuserCurrencyBalance ?? 0,
      balance: account.balance ?? 0,
    };
  }

  /**
   * Recalculate balances for all transactions after the new transaction
   */
  private async recalculateFutureBalances(transaction: Transaction, account: Account): Promise<void> {
    // RAD-564: membership, order and the accumulation arithmetic all come from the shared chain
    // service now, so this path and bank sync cannot drift apart again. Manual accounts hold only
    // BOOKED rows, so restricting the chain to settled rows changes nothing here.
    const futureTransactions = await loadChainRows(DI.em, account, {
      transactionDate: { $gt: transaction.transactionDate },
    });

    const tail = accumulateChain(futureTransactions, {
      appuserCurrencyBalance: transaction.appuserCurrencyBalance ?? 0,
      balance: transaction.balance ?? 0,
    });

    // A manual account's balance is the chain tail — it is derived, not provider-supplied. (A
    // bank-synced account is the other way round: see `recalculateChainFromAccountBalance`.)
    account.balance = tail.balance;
    account.appuserCurrencyBalance = tail.appuserCurrencyBalance;

    await DI.em.flush();
  }
}

// Export singleton instance
export const transactionCreationService = new TransactionCreationService();
