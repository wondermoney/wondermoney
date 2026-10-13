// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { EntityManager } from '@mikro-orm/core';

import { AccountType } from '@entity/AccountType';
import { Seeder } from '@mikro-orm/seeder';

export class AccountTypeSeeder extends Seeder {
  async run(em: EntityManager): Promise<void> {
    em.create(AccountType, { description: 'CHECKING' });
    em.create(AccountType, { description: 'SAVINGS' });
    em.create(AccountType, { description: 'INVESTMENT' });
    em.create(AccountType, { description: 'MORTGAGE' });
    em.create(AccountType, { description: 'CREDIT_CARD' });
    em.create(AccountType, { description: 'LOAN' });
    em.create(AccountType, { description: 'PENSION' });
    em.create(AccountType, { description: 'OTHER' });
    em.create(AccountType, { description: 'EXTERNAL' });
    em.create(AccountType, { description: 'CASH' });
  }
}
