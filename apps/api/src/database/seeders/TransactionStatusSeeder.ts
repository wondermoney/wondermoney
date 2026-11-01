// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { TransactionStatus } from '@entity/TransactionStatus';
import { Seeder } from '@mikro-orm/seeder';

const TRANSACTION_STATUS_NAMES = ['PENDING', 'BOOKED', 'EXPIRED'] as const;

export class TransactionStatusSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    // Idempotent: skip rows that already exist so this seeder is safe to re-run
    // against DBs that already have bootstrap rows (e.g. from a migration that
    // inserted `EXPIRED` directly).
    const ctxTransactionStatuses = await Promise.all(
      TRANSACTION_STATUS_NAMES.map(async (name) => {
        const existing = await em.findOne(TransactionStatus, { name });
        return existing ?? em.create(TransactionStatus, { name });
      }),
    );
    ctx.transactionStatuses = ctxTransactionStatuses;
  }
}
