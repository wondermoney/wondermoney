import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

import type { Appuser } from '@entity/Appuser';
import type { Category } from '@entity/Category';
import { Source } from '@entity/TransactionCategoryStats';
import type { TransactionMerchant } from '@entity/TransactionMerchant';

import { decrementMerchantCategoryStat, incrementMerchantCategoryStat, learnAppuserMerchantCategory } from '../merchant-category-stats.service';

function makeEm() {
  const execute = vi.fn().mockResolvedValue([]);
  return { em: { execute } as unknown as EntityManager, execute };
}

const merchant = { transactionMerchantKey: 11000 } as unknown as TransactionMerchant;
const category = { categoryKey: 18 } as unknown as Category;
const statAppuser = { appuserKey: 501 } as unknown as Appuser;

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('merchant category stats — atomic & race-safe (API-QB regression)', () => {
  it('increments via a single INSERT ... ON CONFLICT DO UPDATE scoped per user (RAD-342 G4)', async () => {
    const { em, execute } = makeEm();

    await incrementMerchantCategoryStat(em, merchant, category, statAppuser);

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    const normalized = normalize(sql);
    expect(normalized).toContain('insert into "transaction_category_stats"');
    // The conflict target MUST match the per-user unique constraint (merchant, category, source,
    // appuser), and the action MUST be an additive increment — this is what makes concurrent edits
    // safe AND keeps one household member's votes from bleeding into another's (RAD-342 G4).
    expect(normalized).toContain(
      'on conflict ("transaction_merchant_key", "category_key", "source", "appuser_key") do update set "count" = "transaction_category_stats"."count" + 1',
    );
    expect(params).toEqual([11000, 18, 501, Source.USER]);
  });

  it('decrements with a targeted per-user UPDATE that no-ops when the row is absent', async () => {
    const { em, execute } = makeEm();

    await decrementMerchantCategoryStat(em, merchant, category, statAppuser);

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    const normalized = normalize(sql);
    expect(normalized).toContain('update "transaction_category_stats" set "count" = "count" - 1');
    expect(normalized).toContain('where "transaction_merchant_key" = ? and "category_key" = ? and "source" = ? and "appuser_key" = ?');
    expect(params).toEqual([11000, 18, Source.USER, 501]);
  });

  it('defaults source to USER but honours an explicit source', async () => {
    const { em, execute } = makeEm();

    await incrementMerchantCategoryStat(em, merchant, category, statAppuser, Source.OPENAI);

    expect((execute.mock.calls[0] as [string, unknown[]])[1]).toEqual([11000, 18, 501, Source.OPENAI]);
  });
});

const appuser = { appuserKey: 501 } as unknown as Appuser;

describe('learnAppuserMerchantCategory — last-wins single active mapping', () => {
  it('retires other-category actives then upserts the target (restore-safe)', async () => {
    const { em, execute } = makeEm();

    await learnAppuserMerchantCategory(em, appuser, merchant, category);

    expect(execute).toHaveBeenCalledTimes(2);
    const [retireSql, retireParams] = execute.mock.calls[0] as [string, unknown[]];
    const retire = normalize(retireSql);
    expect(retire).toContain('update "appuser_merchant_category" set "deleted_at" = now()');
    expect(retire).toContain('"appuser_key" = ? and "transaction_merchant_key" = ? and "category_key" <> ? and "deleted_at" is null');
    expect(retireParams).toEqual([501, 11000, 18]);

    const [upsertSql, upsertParams] = execute.mock.calls[1] as [string, unknown[]];
    const upsert = normalize(upsertSql);
    expect(upsert).toContain('insert into "appuser_merchant_category"');
    expect(upsert).toContain("values (now(), now(), ?, ?, ?, 'user')");
    expect(upsert).toContain(
      'on conflict ("appuser_key", "transaction_merchant_key", "category_key") do update set "source" = \'user\', "deleted_at" = null, "updated_at" = now()',
    );
    expect(upsertParams).toEqual([501, 11000, 18]);
  });

  it('swallows and logs when execute throws — never breaks the caller', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('db down'));
    const em = { execute } as unknown as EntityManager;
    await expect(learnAppuserMerchantCategory(em, appuser, merchant, category)).resolves.toBeUndefined();
  });
});
