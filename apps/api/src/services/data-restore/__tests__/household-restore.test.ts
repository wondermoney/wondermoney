import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addAccount, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { allRowCounts, dataFiles, emptyHousehold, exportBytes, householdRowCounts, linkToBank, richHousehold, type Scope, scopeOf } from '@app/__tests__/__helpers__/restore-fixtures';
import { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { Goal } from '@entity/Goal';
import portfolioHoldingsService from '@service/portfolio/portfolio-holdings.service';

import { restoreHousehold } from '../household-restore';
import { REFERENCES } from '../restore-format';
import { type ParsedExport, readRestoreArchive } from '../restore-reader';

/*
 * Restoring an export into a household: everything comes back, references and all, into the
 * restoring household only, and only into one that is empty. A restore that cannot finish leaves
 * nothing behind.
 */
describe('household restore', () => {
  const db = useTestDatabase();

  async function parsedExportOf(scope: Scope, password?: string): Promise<ParsedExport> {
    const bytes = await exportBytes(db.em(), scope, password ? { password } : {});
    return readRestoreArchive(bytes, password ? { password } : {});
  }

  const restore = (target: Scope, parsed: ParsedExport, options: Partial<Parameters<typeof restoreHousehold>[3]> = {}) =>
    restoreHousehold(db.em(), target, parsed, { dryRun: false, ...options });

  type Files = Record<string, Record<string, unknown>[]>;

  /**
   * An export's data files with export-local ids replaced by what they point at, and the rows of
   * each file sorted, so two exports of the same data compare equal whatever ids they used. The
   * parts that name a person (members) are left out: the restoring member is someone else.
   */
  function canonical(files: Files) {
    const refs = new Map<string, Map<string, string>>();
    for (const { field, file, target } of REFERENCES) refs.set(file, (refs.get(file) ?? new Map<string, string>()).set(field, target));
    const byId = (file: string, id: unknown) => files[file]?.find((row) => row['id'] === id);
    // What a referenced row is, by its own values (not its references, which may loop).
    const shallow = (file: string, id: unknown) => {
      const row = byId(file, id);
      if (!row) return `${file}:missing`;
      return `${file}:${JSON.stringify(Object.entries(row).filter(([key]) => key !== 'id' && !refs.get(file)?.has(key)).sort(([a], [b]) => a.localeCompare(b)))}`;
    };
    const ruleRefs: Record<string, string> = { account: 'accounts', category: 'categories', categoryId: 'categories', merchantId: 'merchants', tagIds: 'tags' };
    const resolveRule = (items: Record<string, unknown>[]) => items.map((item) => {
      const out = { ...item };
      for (const key of ['categoryId', 'merchantId', 'tagIds'] as const) {
        if (key in out) out[key] = Array.isArray(out[key]) ? (out[key]).map((id) => shallow(ruleRefs[key]!, id)) : shallow(ruleRefs[key]!, out[key]);
      }
      const field = out['field'] as string | undefined;
      if (field && ruleRefs[field] && Array.isArray(out['values'])) out['values'] = (out['values']).map((id) => (typeof id === 'number' ? shallow(ruleRefs[field]!, id) : id));
      return out;
    });
    const out: Record<string, string[]> = {};
    for (const [file, rows] of Object.entries(files)) {
      if (file === 'members') continue;
      out[file] = rows.map((row) => {
        const resolved: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          if (key === 'id' || key.endsWith('MemberId') || key === 'memberId') continue;
          const target = refs.get(file)?.get(key);
          if (target) resolved[key] = Array.isArray(value) ? value.map((id) => shallow(target, id)).sort() : value === null ? null : shallow(target, value);
          else if (file === 'rules' && (key === 'actions' || key === 'conditions')) resolved[key] = resolveRule(value as Record<string, unknown>[]);
          else resolved[key] = value;
        }
        return JSON.stringify(Object.entries(resolved).sort(([a], [b]) => a.localeCompare(b)));
      }).sort();
    }
    return out;
  }

  describe('round trip', () => {
    it('gives back the same export, file for file, from a fresh household', async () => {
      const { owner } = await richHousehold(db.em());
      const source = await exportBytes(db.em(), scopeOf(owner));
      const target = await emptyHousehold(db.em());

      await restore(scopeOf(target), await readRestoreArchive(source));

      const again = await exportBytes(db.em(), scopeOf(target));
      const before = canonical(dataFiles(source));
      const after = canonical(dataFiles(again));
      for (const file of Object.keys(before)) expect({ file, rows: after[file] }).toEqual({ file, rows: before[file] });
      // Every file has something in it, so the comparison above covers every entity.
      for (const [file, rows] of Object.entries(before)) expect({ file, rows: rows.length }).not.toEqual({ file, rows: 0 });
    });

    it('restores a password-protected export with its password', async () => {
      const { owner } = await richHousehold(db.em());
      const target = await emptyHousehold(db.em());

      await restore(scopeOf(target), await parsedExportOf(scopeOf(owner), 'a long enough backup password'));

      expect(dataFiles(await exportBytes(db.em(), scopeOf(target)))['transactions']).toHaveLength(6);
    });

    it('matches the source balances and holdings', async () => {
      const { owner } = await richHousehold(db.em());
      const target = await emptyHousehold(db.em());

      await restore(scopeOf(target), await parsedExportOf(scopeOf(owner)));

      const balances = async (tenantKey: number) => db.em().getConnection().execute<{ appuser_currency_balance: null | string; balance: string; name: string }[]>(
        'select account_name as name, balance::text, appuser_currency_balance::text from account where tenant_key = ? order by account_name', [tenantKey]);
      const [source, restored] = [await balances(owner.tenant.tenantKey), await balances(target.tenant.tenantKey)];
      expect(restored.map(({ balance, name }) => ({ balance, name }))).toEqual(source.map(({ balance, name }) => ({ balance, name })));
      // In the member's own currency the converted balance is the balance; a dollar account waits for the FX job.
      expect(restored.find((row) => row.name === 'Savings')!.appuser_currency_balance).toBe(source.find((row) => row.name === 'Savings')!.appuser_currency_balance);
      expect(restored.find((row) => row.name === 'Dollar account')!.appuser_currency_balance).toBeNull();

      const holdings = async (scope: Scope) => {
        const appuser = await db.em().findOneOrFail(Appuser, { appuserKey: scope.appuserKey }, { filters: false, populate: ['currencyKey'] });
        const [portfolio] = await db.em().getConnection().execute<{ portfolio_key: number }[]>('select portfolio_key from portfolio where tenant_key = ?', [scope.tenantKey]);
        return (await portfolioHoldingsService.getPortfolioHoldings(appuser, portfolio!.portfolio_key, scope.tenantKey)).map((holding) => ({ quantity: holding.quantity, symbol: holding.financialAssetSymbol }));
      };
      expect(await holdings(scopeOf(target))).toEqual(await holdings(scopeOf(owner)));
    });
  });

  describe('the target household', () => {
    it('writes only into the restoring household, as the restoring member', async () => {
      const { owner } = await richHousehold(db.em());
      const neighbour = await seedHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      const target = await emptyHousehold(db.em());
      const before = { neighbour: await householdRowCounts(db.em(), neighbour.tenant.tenantKey), source: await householdRowCounts(db.em(), owner.tenant.tenantKey) };

      await restore(scopeOf(target), parsed);

      expect(await householdRowCounts(db.em(), neighbour.tenant.tenantKey)).toEqual(before.neighbour);
      expect(await householdRowCounts(db.em(), owner.tenant.tenantKey)).toEqual(before.source);
      const restored = await householdRowCounts(db.em(), target.tenant.tenantKey);
      expect(restored['transaction']).toBe(6);
      expect(restored['account']).toBe(3);
      // Rows with a member point at the restoring member, never at the source household's people.
      const connection = db.em().getConnection();
      const strangers = await connection.execute<{ n: number }[]>(
        `select count(*)::int as n from (
           select appuser_key from "transaction" where tenant_key = ? union all
           select account_owner_appuser_key from account where tenant_key = ? union all
           select atc.appuser_key from appuser_transaction_category atc join "transaction" t using (transaction_key) where t.tenant_key = ? union all
           select owner_appuser_key from loan where tenant_key = ? union all
           select portfolio_owner_appuser_key from portfolio where tenant_key = ?
         ) members where appuser_key is not null and appuser_key <> ?`,
        [target.tenant.tenantKey, target.tenant.tenantKey, target.tenant.tenantKey, target.tenant.tenantKey, target.tenant.tenantKey, target.appuser.appuserKey],
      );
      expect(strangers[0]!.n).toBe(0);
      // References stay inside the household: every restored transaction's account is the household's.
      const crossed = await connection.execute<{ n: number }[]>(
        'select count(*)::int as n from "transaction" t join account a on a.account_key = t.account_key where t.tenant_key = ? and a.tenant_key <> ?',
        [target.tenant.tenantKey, target.tenant.tenantKey],
      );
      expect(crossed[0]!.n).toBe(0);
    });

    it('refuses a household that already has data, and writes nothing', async () => {
      const { owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      const target = await emptyHousehold(db.em());
      await db.em().getConnection().execute('insert into goal (created_at, updated_at, appuser_key, currency_key, name, target_amount, tenant_key) select now(), now(), ?, currency_key, ?, 1, ? from appuser where appuser_key = ?', [target.appuser.appuserKey, 'Existing goal', target.tenant.tenantKey, target.appuser.appuserKey]);
      const before = await allRowCounts(db.em());

      await expect(restore(scopeOf(target), parsed)).rejects.toMatchObject({ code: 'household_not_empty' });

      expect(await allRowCounts(db.em())).toEqual(before);
    });

    it('cannot run twice into the same household', async () => {
      const { owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      const target = await emptyHousehold(db.em());

      await restore(scopeOf(target), parsed);
      const after = await householdRowCounts(db.em(), target.tenant.tenantKey);

      await expect(restore(scopeOf(target), parsed)).rejects.toMatchObject({ code: 'household_not_empty' });
      expect(await householdRowCounts(db.em(), target.tenant.tenantKey)).toEqual(after);
    });

    it('leaves the household empty when a row fails part-way through', async () => {
      const { owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      // Two repayments of one loan by one transaction: valid rows, refused by the database late in the restore.
      parsed.rows['loan-repayments'].push({ ...parsed.rows['loan-repayments'][0]! });
      const target = await emptyHousehold(db.em());
      const before = await allRowCounts(db.em());

      await expect(restore(scopeOf(target), parsed)).rejects.toThrow();

      expect(await allRowCounts(db.em())).toEqual(before);
      expect(Object.values(await householdRowCounts(db.em(), target.tenant.tenantKey)).every((count) => count === 0)).toBe(true);
    });
  });

  describe('dry run', () => {
    it('reports what a restore would write, and writes nothing', async () => {
      const { owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      const target = await emptyHousehold(db.em());
      const before = await allRowCounts(db.em());

      const { summary } = await restore(scopeOf(target), parsed, { dryRun: true });

      expect(await allRowCounts(db.em())).toEqual(before);
      expect(summary.counts).toEqual(expect.objectContaining({ accounts: 3, loans: 1, 'portfolio-transactions': 2, rules: 2, transactions: 6 }));
      const real = await restore(scopeOf(target), parsed);
      expect(real.summary.counts).toEqual(summary.counts);
    });
  });

  describe('mapping', () => {
    it('brings formerly bank-linked accounts back as manual accounts, listed for reconnecting', async () => {
      const em = db.em();
      const owner = await seedHousehold(em);
      await addTransaction(em, owner, { amount: -5, date: new Date('2026-02-01T00:00:00Z'), enableBankingTransactionId: 'EB-1', status: 'BOOKED' });
      await linkToBank(em, owner, owner.account.accountKey);
      const target = await emptyHousehold(db.em());

      const { summary } = await restore(scopeOf(target), await parsedExportOf(scopeOf(owner)));

      expect(summary.warnings).toContainEqual({ code: 'bank_linked_accounts', count: 1, values: ['Current account'] });
      const [account] = await db.em().getConnection().execute<{ eb: null | number; nordigen: null | number }[]>('select enable_banking_connection_key as eb, nordigen_requisition_key as nordigen from account where tenant_key = ?', [target.tenant.tenantKey]);
      expect(account).toEqual({ eb: null, nordigen: null });
      const [transaction] = await db.em().getConnection().execute<{ id: null | string }[]>('select enable_banking_transaction_id as id from "transaction" where tenant_key = ?', [target.tenant.tenantKey]);
      expect(transaction!.id).toBeNull();
    });

    it("folds the other member's rows into the restoring member, keeping their own categories", async () => {
      const em = db.em();
      const owner = await seedHousehold(em);
      const partner = await addPartner(em, owner);
      const mine = em.create(Category, { bgColor: '#000', name: 'Mine', tenantKey: owner.tenant, textColor: '#fff' }, { partial: true });
      const theirs = em.create(Category, { bgColor: '#000', name: 'Theirs', tenantKey: owner.tenant, textColor: '#fff' }, { partial: true });
      await em.flush();
      const both = await addTransaction(em, owner, { amount: -5, category: mine, date: new Date('2026-02-01T00:00:00Z'), status: 'BOOKED' });
      em.create(AppuserTransactionCategory, { appuserKey: partner, categoryKey: theirs, source: Source.USER, transactionKey: both }, { partial: true });
      await addTransaction(em, owner, { amount: -7, appuser: partner, category: theirs, date: new Date('2026-02-02T00:00:00Z'), status: 'BOOKED' });
      await em.flush();
      const target = await emptyHousehold(db.em());

      const { summary } = await restore(scopeOf(target), await parsedExportOf(scopeOf(owner)));

      expect(summary.warnings).toContainEqual(expect.objectContaining({ code: 'members_merged', count: 1 }));
      const rows = await db.em().getConnection().execute<{ appuser_key: number; category: string; description: string }[]>(
        `select atc.appuser_key, c.name as category, t.description from appuser_transaction_category atc
         join "transaction" t using (transaction_key) join category c using (category_key) where t.tenant_key = ? order by t.transaction_date`, [target.tenant.tenantKey]);
      expect(rows.map(({ appuser_key, category }) => ({ appuser_key, category }))).toEqual([
        { appuser_key: target.appuser.appuserKey, category: 'Mine' },
        { appuser_key: target.appuser.appuserKey, category: 'Theirs' },
      ]);
    });

    it('applies the exported preferences to the restoring member', async () => {
      const { owner } = await richHousehold(db.em());
      const target = await emptyHousehold(db.em(), { currency: 'USD' });

      const { summary } = await restore(scopeOf(target), await parsedExportOf(scopeOf(owner)));

      expect(summary.warnings).toContainEqual({ code: 'currency_changed', count: 1, values: ['EUR'] });
      const appuser = await db.em().findOneOrFail(Appuser, { appuserKey: target.appuser.appuserKey }, { filters: false, populate: ['currencyKey'] });
      expect(appuser.currencyKey.code).toBe('EUR');
      const [preference] = await db.em().getConnection().execute<{ budget_alerts_enabled: boolean; weekly_insights_enabled: boolean }[]>('select budget_alerts_enabled, weekly_insights_enabled from email_notification_preference where appuser_key = ?', [target.appuser.appuserKey]);
      expect(preference).toEqual({ budget_alerts_enabled: false, weekly_insights_enabled: false });
    });

    it('refuses an export in a currency this server does not have, before writing', async () => {
      const em = db.em();
      const owner = await seedHousehold(em);
      await addAccount(em, owner, { name: 'Unknown money' });
      const parsed = await parsedExportOf(scopeOf(owner));
      parsed.rows.accounts[1]!.currency = 'XQQ';
      const target = await emptyHousehold(db.em());
      const before = await allRowCounts(db.em());

      await expect(restore(scopeOf(target), parsed)).rejects.toMatchObject({ code: 'unknown_currency', detail: { values: ['XQQ'] } });
      expect(await allRowCounts(db.em())).toEqual(before);
    });

    it('finds assets by ISIN, asks the catalogue for missing ones, and leaves out trades of an asset nobody knows', async () => {
      const { asset, owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      // The same asset under a symbol this server does not use: found by its ISIN.
      parsed.rows['portfolio-transactions'][0]!.asset.symbol = 'AAPL.US';
      // An asset nobody has: the catalogue is asked, says no, and its trade is left out.
      parsed.rows['portfolio-transactions'][1]!.asset = { currency: 'USD', exchange: null, isin: null, name: 'Delisted Co', symbol: 'GONE', type: 'Stock' };
      const asked: string[] = [];
      const target = await emptyHousehold(db.em());

      const { summary } = await restore(scopeOf(target), parsed, { deps: { resolveAsset: (missing) => { asked.push(missing.symbol); return Promise.resolve(null); } } });

      expect(asked).toEqual(['GONE']);
      expect(summary.warnings).toContainEqual({ code: 'assets_left_out', count: 1, values: ['GONE'] });
      expect(summary.counts['portfolio-transactions']).toBe(1);
      const rows = await db.em().getConnection().execute<{ financial_asset_key: number; symbol: string }[]>(
        'select fa.financial_asset_key, fa.symbol from financial_transaction ft join financial_asset fa using (financial_asset_key) where ft.tenant_key = ? order by ft.transaction_date', [target.tenant.tenantKey]);
      expect(rows).toEqual([{ financial_asset_key: asset.financialAssetKey, symbol: 'AAPL' }]);
    });

    it('never adds to the shared asset catalogue from the file, so no other household sees anything new', async () => {
      const { owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      // A made-up asset, described by the file (as anyone uploading a crafted export could).
      parsed.rows['portfolio-transactions'][1]!.asset = { currency: 'USD', exchange: null, isin: 'US0000000001', name: 'Planted Inc', symbol: 'PLANTED', type: 'Stock' };
      const target = await emptyHousehold(db.em());
      const bystander = await emptyHousehold(db.em());
      const catalogue = () => db.em().getConnection().execute<{ financial_asset_key: number; isin: null | string; name: string; symbol: string }[]>(
        'select financial_asset_key, isin, name, symbol from financial_asset order by financial_asset_key');
      const before = await catalogue();

      const checked = await restore(scopeOf(target), parsed, { deps: { resolveAsset: () => Promise.resolve(null) }, dryRun: true });
      const restored = await restore(scopeOf(target), parsed, { deps: { resolveAsset: () => Promise.resolve(null) } });

      // The check before restoring already says what is left out, so the person sees it first.
      expect(checked.summary.warnings).toContainEqual({ code: 'assets_left_out', count: 1, values: ['PLANTED'] });
      expect(restored.summary.warnings).toContainEqual({ code: 'assets_left_out', count: 1, values: ['PLANTED'] });
      expect(await catalogue()).toEqual(before);
      // What another household can pick from (the catalogue, by symbol or ISIN) has nothing new.
      const [seen] = await db.em().getConnection().execute<{ n: number }[]>(
        "select count(*)::int as n from financial_asset where symbol = 'PLANTED' or isin = 'US0000000001' or name = 'Planted Inc'");
      expect(seen?.n).toBe(0);
      expect(Object.values(await householdRowCounts(db.em(), bystander.tenant.tenantKey)).every((count) => count === 0)).toBe(true);
    });

    it('skips a rule this server cannot read, and says so', async () => {
      const { owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      parsed.rows.rules[1]!.conditions = [{ field: 'weather', operator: 'is', value: 'sunny' }];
      const target = await emptyHousehold(db.em());

      const { summary } = await restore(scopeOf(target), parsed);

      expect(summary.counts.rules).toBe(1);
      expect(summary.warnings).toContainEqual({ code: 'rules_skipped', count: 1, values: ['Merchant rule'] });
    });

    it('re-points rules, transfers and goal links at the restored rows', async () => {
      const { owner } = await richHousehold(db.em());
      const target = await emptyHousehold(db.em());

      await restore(scopeOf(target), await parsedExportOf(scopeOf(owner)));

      const em: EntityManager = db.em();
      const connection = em.getConnection();
      const [rule] = await connection.execute<{ actions: { categoryId?: number; tagIds?: number[]; type: string }[]; conditions: { field: string; values?: number[] }[] }[]>("select actions, conditions from rule where tenant_key = ? and name = 'Groceries rule'", [target.tenant.tenantKey]);
      const [organic] = await connection.execute<{ category_key: number }[]>("select category_key from category where tenant_key = ? and name = 'Organic'", [target.tenant.tenantKey]);
      const [current] = await connection.execute<{ account_key: number }[]>("select account_key from account where tenant_key = ? and account_name = 'Current account'", [target.tenant.tenantKey]);
      expect(rule!.actions[0]).toEqual({ categoryId: organic!.category_key, type: 'set_category' });
      expect(rule!.conditions[0]).toEqual({ field: 'account', operator: 'in', values: [current!.account_key] });
      const pairs = await connection.execute<{ a: number; b: number }[]>(
        'select t.transaction_key as a, c.transfer_counterpart_key as b from "transaction" t join "transaction" c on c.transaction_key = t.transfer_counterpart_key where t.tenant_key = ?', [target.tenant.tenantKey]);
      expect(pairs).toHaveLength(2);
      for (const pair of pairs) expect(pair.b).toBe(pair.a);
      const goal = await em.findOneOrFail(Goal, { tenantKey: target.tenant }, { filters: false });
      const [destination] = await connection.execute<{ n: number }[]>('select count(*)::int as n from "transaction" where tenant_key = ? and transfer_destination_goal_key = ?', [target.tenant.tenantKey, goal.goalKey]);
      expect(destination!.n).toBe(1);
    });
  });
});
