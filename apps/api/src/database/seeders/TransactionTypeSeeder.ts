// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { TransactionType } from '@entity/TransactionType';
import { Seeder } from '@mikro-orm/seeder';

export class TransactionTypeSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const ctxTransactionTypes = [];
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Transfer (in)',
        name: 'TRANSFER_IN',
      }),
    );
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Transfer (out)',
        name: 'TRANSFER_OUT',
      }),
    );
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Payment',
        name: 'PAYMENT',
      }),
    );
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Topup',
        name: 'TOPUP',
      }),
    );
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Card Payment',
        name: 'CARD_PAYMENT',
      }),
    );
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Exchange',
        name: 'EXCHANGE',
      }),
    );
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'ATM',
        name: 'ATM',
      }),
    );
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Deposit',
        name: 'DEPOSIT',
      }),
    );
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Loan',
        name: 'LOAN',
      }),
    );
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Revert',
        name: 'REVERT',
      }),
    );
    // from Revolut
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Reward',
        name: 'REWARD',
      }),
    );
    // from Revolut
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Cashback',
        name: 'CASHBACK',
      }),
    );
    // from Revolut
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Card Refund',
        name: 'CARD_REFUND',
      }),
    );
    // from Revolut
    ctxTransactionTypes.push(
      em.create(TransactionType, {
        displayName: 'Fee',
        name: 'FEE',
      }),
    );
    ctx.transactionTypes = ctxTransactionTypes;
  }
}
