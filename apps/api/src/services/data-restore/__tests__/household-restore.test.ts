import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addAccount, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { allRowCounts, dataFiles, emptyHousehold, exportBytes, householdRowCounts, linkToBank, richHousehold, type Scope, scopeOf } from '@app/__tests__/__helpers__/restore-fixtures';
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { Goal } from '@entity/Goal';
import portfolioHoldingsService from '@service/portfolio/portfolio-holdings.service';

import { restoreHousehold } from '../household-restore';
import { DATA_FILES, type DataFileName, REFERENCES } from '../restore-format';
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

  describe('crypto wallets', () => {
    it('restores only public addresses, whatever an edited export holds, ready to sync again', async () => {
      const { owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      const [address] = parsed.rows['crypto-wallet-addresses'];
      // A private key slipped into the file by hand: it must not reach the database.
      parsed.rows['crypto-wallet-addresses'].push({ ...address!, address: 'ab'.repeat(32), id: 99 });
      parsed.rows['crypto-wallet-tokens'].push({ addressId: 99, balance: '1', contractAddress: null, decimals: 18, name: null, symbol: 'ETH', tracked: true });
      const target = await emptyHousehold(db.em());

      await restore(scopeOf(target), parsed);

      const connection = db.em().getConnection();
      const addresses = await connection.execute<{ address: string; sync_status: string }[]>('select address, sync_status from crypto_wallet_address where tenant_key = ?', [target.tenant.tenantKey]);
      expect(addresses).toEqual([{ address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', sync_status: 'pending' }]);
      const tokens = await connection.execute<{ symbol: string; tracked: boolean }[]>('select symbol, tracked from crypto_wallet_token where tenant_key = ? order by symbol', [target.tenant.tenantKey]);
      expect(tokens).toEqual([{ symbol: 'ETH', tracked: true }, { symbol: 'USDC', tracked: false }]);
    });
  });

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
           select owner_appuser_key from manual_asset where tenant_key = ? union all
           select portfolio_owner_appuser_key from portfolio where tenant_key = ?
         ) members where appuser_key is not null and appuser_key <> ?`,
        [target.tenant.tenantKey, target.tenant.tenantKey, target.tenant.tenantKey, target.tenant.tenantKey, target.tenant.tenantKey, target.tenant.tenantKey, target.appuser.appuserKey],
      );
      expect(strangers[0]!.n).toBe(0);
      expect(restored['manual_asset']).toBe(3);
      expect(restored['manual_asset_valuation']).toBe(4);
      expect(restored['crypto_wallet_address']).toBe(1);
      expect(restored['crypto_wallet_token']).toBe(2);
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

    it('refuses a household whose only data is a manual asset', async () => {
      const { owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      const target = await emptyHousehold(db.em());
      await db.em().getConnection().execute("insert into manual_asset (created_at, updated_at, owner_appuser_key, currency_key, name, kind, is_private, tenant_key) select now(), now(), ?, currency_key, ?, 'property', false, ? from appuser where appuser_key = ?", [target.appuser.appuserKey, 'Existing home', target.tenant.tenantKey, target.appuser.appuserKey]);

      await expect(restore(scopeOf(target), parsed)).rejects.toMatchObject({ code: 'household_not_empty' });
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

  describe('manual assets', () => {
    it('restores each asset with its valuations, growth rule, privacy and archive date', async () => {
      const { owner } = await richHousehold(db.em());
      const target = await emptyHousehold(db.em());

      const { summary } = await restore(scopeOf(target), await parsedExportOf(scopeOf(owner)));

      expect(summary.counts).toEqual(expect.objectContaining({ 'crypto-wallet-addresses': 1, 'crypto-wallet-tokens': 2, 'manual-asset-valuations': 4, 'manual-assets': 3 }));
      const assets = await db.em().getConnection().execute<Record<string, unknown>[]>(
        `select a.name, a.kind, a.is_private, c.code as currency, a.purchase_price::text as purchase_price, to_char(a.purchase_date, 'YYYY-MM-DD') as purchase_date,
           a.growth_annual_rate_percent::text as growth, to_char(a.growth_start_date, 'YYYY-MM-DD') as growth_start, a.notes, (a.archived_at is not null) as archived,
           (select string_agg(to_char(v.valuation_date, 'YYYY-MM-DD') || '=' || v.value::text, ',' order by v.valuation_date) from manual_asset_valuation v where v.manual_asset_key = a.manual_asset_key and v.tenant_key = a.tenant_key) as valuations
         from manual_asset a join currency c on c.currency_key = a.currency_key where a.tenant_key = ? order by a.name`, [target.tenant.tenantKey]);
      expect(assets).toEqual([
        { archived: false, currency: 'USD', growth: null, growth_start: null, is_private: false, kind: 'crypto_wallet', name: 'Cold wallet', notes: null, purchase_date: null, purchase_price: null, valuations: '2026-06-02=4500.0000' },
        { archived: false, currency: 'USD', growth: '2.5000', growth_start: '2026-01-01', is_private: false, kind: 'property', name: 'Home', notes: 'Top floor', purchase_date: '2020-03-01', purchase_price: '180000.5000', valuations: '2020-03-01=180000.5000,2026-05-10=240000.0000' },
        { archived: true, currency: 'EUR', growth: null, growth_start: null, is_private: true, kind: 'vehicle', name: 'Old car', notes: null, purchase_date: null, purchase_price: null, valuations: '2025-01-15=7000.0000' },
      ]);
    });

    it('restores an export made before manual assets existed', async () => {
      const { owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      parsed.rows['manual-assets'] = [];
      parsed.rows['manual-asset-valuations'] = [];
      parsed.rows['crypto-wallet-addresses'] = [];
      parsed.rows['crypto-wallet-tokens'] = [];
      for (const loan of parsed.rows.loans) delete loan.securedAssetId;
      const target = await emptyHousehold(db.em());

      const { summary } = await restore(scopeOf(target), parsed);

      expect(summary.counts).toEqual(expect.objectContaining({ loans: 1, 'manual-assets': 0, transactions: 6 }));
    });

    it('restores the day each budget\'s months start on, and the 1st for an export made before it existed', async () => {
      expect(DATA_FILES.budgets.parse({ currency: 'EUR', description: null, id: 1, memberId: 1, name: 'Old', numAdults: 1, numDependents: 0 })).toMatchObject({ periodStartDay: 1 });

      const { owner } = await richHousehold(db.em());
      const target = await emptyHousehold(db.em());
      await restore(scopeOf(target), await parsedExportOf(scopeOf(owner)));

      const budgets = await db.em().getConnection().execute<{ period_start_day: number }[]>('select period_start_day from budget where tenant_key = ?', [target.tenant.tenantKey]);
      expect(budgets).toEqual([{ period_start_day: 25 }]);
    });

    it('restores the asset each loan is secured against', async () => {
      const { owner } = await richHousehold(db.em());
      const target = await emptyHousehold(db.em());

      await restore(scopeOf(target), await parsedExportOf(scopeOf(owner)));

      const loans = await db.em().getConnection().execute<Record<string, unknown>[]>(
        'select l.name, a.name as asset, a.tenant_key = l.tenant_key as same_household from loan l left join manual_asset a on a.manual_asset_key = l.secured_asset_key where l.tenant_key = ?', [target.tenant.tenantKey]);
      expect(loans).toEqual([{ asset: 'Old car', name: 'Car loan', same_household: true }]);
    });
  });

  describe('installment plans and card cycles', () => {
    const planRows = (tenantKey: number) => db.em().getConnection().execute<Record<string, unknown>[]>(
      `select p.description, p.installment_count, p.total_amount::text as total, to_char(p.purchase_date, 'YYYY-MM-DD') as purchase_date, a.account_name as card, c.name as category,
         (select string_agg(i.installment_number || '=' || i.amount::text || '@' || to_char(i.scheduled_date, 'YYYY-MM-DD') || '/' || coalesce(to_char(i.statement_date, 'YYYY-MM-DD'), '-') || '/' || coalesce(to_char(i.due_date, 'YYYY-MM-DD'), '-'), ',' order by i.installment_number)
          from installment i where i.installment_plan_key = p.installment_plan_key and i.tenant_key = p.tenant_key) as schedule,
         (select string_agg(t.description || '#' || t.installment_number, ',') from "transaction" t where t.installment_plan_key = p.installment_plan_key and t.account_key = p.account_key) as paid_by
       from installment_plan p join account a on a.account_key = p.account_key and a.tenant_key = p.tenant_key left join category c on c.category_key = p.category_key
       where p.tenant_key = ?`, [tenantKey]);

    it('restores each plan on its card with its schedule and the transactions that paid it', async () => {
      const { owner } = await richHousehold(db.em());
      const target = await emptyHousehold(db.em());

      const { summary } = await restore(scopeOf(target), await parsedExportOf(scopeOf(owner)));

      expect(summary.counts).toEqual(expect.objectContaining({ 'credit-cards': 1, 'installment-plans': 1, installments: 3 }));
      const restored = await planRows(target.tenant.tenantKey);
      expect(restored).toEqual(await planRows(owner.tenant.tenantKey));
      expect(restored).toEqual([expect.objectContaining({ card: 'Current account', category: 'Home', description: 'Sofa', installment_count: 3, paid_by: expect.stringMatching(/#2$/u) })]);
      const [card] = await db.em().getConnection().execute<Record<string, unknown>[]>(
        'select a.account_name, d.statement_close_day, d.payment_due_day, d.credit_limit::text as credit_limit, d.minimum_payment_percent::text as minimum from credit_card_detail d join account a using (account_key) where d.tenant_key = ?', [target.tenant.tenantKey]);
      expect(card).toEqual({ account_name: 'Current account', credit_limit: '1500.0000', minimum: '5.00', payment_due_day: 10, statement_close_day: 25 });
    });

    it('draws a schedule that is not whole again from the plan and the restored card cycle', async () => {
      const { owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      parsed.rows.installments = parsed.rows.installments.slice(0, 1);
      const target = await emptyHousehold(db.em());

      await restore(scopeOf(target), parsed);

      // The same schedule the app draws for the plan on that card.
      expect((await planRows(target.tenant.tenantKey))[0]!['schedule']).toBe((await planRows(owner.tenant.tenantKey))[0]!['schedule']);
    });
  });

  describe('exchange-rate and price overrides', () => {
    it('restores the household\'s rates as added by the restoring member, audited, and names the pairs to convert again', async () => {
      const { owner } = await richHousehold(db.em());
      const target = await emptyHousehold(db.em());

      const outcome = await restore(scopeOf(target), await parsedExportOf(scopeOf(owner)));

      expect(outcome.fxOverridePairs).toEqual([{ fromCurrency: 'USD', toCurrency: 'EUR' }]);
      const connection = db.em().getConnection();
      const rates = await connection.execute<Record<string, unknown>[]>(
        `select f.code as from_code, t.code as to_code, to_char(o.date at time zone 'UTC', 'YYYY-MM-DD') as date, o.rate::text as rate, o.created_by_appuser_key as member,
           (select count(*)::int from exchange_rate_override_audit_log l where l.exchange_rate_override_key = o.exchange_rate_override_key and l.tenant_key = o.tenant_key and l.action = 'created' and l.actor_appuser_key = o.created_by_appuser_key) as audits
         from exchange_rate_override o join currency f on f.currency_key = o.from_currency_key join currency t on t.currency_key = o.to_currency_key where o.tenant_key = ?`, [target.tenant.tenantKey]);
      expect(rates).toEqual([{ audits: 1, date: '2026-02-06', from_code: 'USD', member: target.appuser.appuserKey, rate: '0.9166', to_code: 'EUR' }]);
    });

    it('keeps a rate the household already set for the same day', async () => {
      const { owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      const target = await emptyHousehold(db.em());
      await db.em().getConnection().execute(
        `insert into exchange_rate_override (created_at, updated_at, date, from_currency_key, to_currency_key, rate, tenant_key)
         select now(), now(), '2026-02-06T00:00:00Z', f.currency_key, t.currency_key, 0.5, ? from currency f, currency t where f.code = 'USD' and t.code = 'EUR'`, [target.tenant.tenantKey]);

      const { summary } = await restore(scopeOf(target), parsed);

      expect(summary.counts['exchange-rate-overrides']).toBe(0);
      const rates = await db.em().getConnection().execute<{ rate: string }[]>('select rate::text from exchange_rate_override where tenant_key = ?', [target.tenant.tenantKey]);
      expect(rates).toEqual([{ rate: '0.5' }]);
    });

    it('puts each price on the catalogue\'s asset in its currency, and leaves out and lists one it cannot', async () => {
      const { asset, owner } = await richHousehold(db.em());
      const parsed = await parsedExportOf(scopeOf(owner));
      const [price] = parsed.rows['price-overrides'];
      // The same asset priced in another currency, and an asset nobody knows.
      parsed.rows['price-overrides'].push({ ...price!, currency: 'EUR', date: '2026-03-30' }, { ...price!, asset: { ...price!.asset, isin: null, symbol: 'GONE' } });
      const target = await emptyHousehold(db.em());

      const { summary } = await restore(scopeOf(target), parsed, { deps: { resolveAsset: () => Promise.resolve(null) } });

      expect(summary.counts['price-overrides']).toBe(1);
      expect(summary.warnings).toContainEqual({ code: 'price_overrides_skipped', count: 2, values: ['AAPL', 'GONE'] });
      // Only traded assets are reported as left out with their trades.
      expect(summary.warnings.map((warning) => warning.code)).not.toContain('assets_left_out');
      const prices = await db.em().getConnection().execute<Record<string, unknown>[]>(
        `select o.financial_asset_key as asset, c.code as currency, to_char(o.date at time zone 'UTC', 'YYYY-MM-DD') as date, o.price::text as price, o.note
         from financial_asset_price_override o join currency c on c.currency_key = o.currency_key where o.tenant_key = ?`, [target.tenant.tenantKey]);
      expect(prices).toEqual([{ asset: asset.financialAssetKey, currency: 'USD', date: '2026-03-31', note: 'broker quote', price: '158.4' }]);
    });
  });

  describe('older exports', () => {
    /** What the reader makes of `parsed` once the 1.8 files and fields are taken out, as in a 1.7 export. */
    function asVersion17(parsed: ParsedExport): ParsedExport {
      const newFiles: DataFileName[] = ['credit-cards', 'exchange-rate-overrides', 'installment-plans', 'installments', 'price-overrides', 'transaction-templates'];
      const newFields: Partial<Record<DataFileName, string[]>> = {
        accounts: ['position'], 'budget-categories': ['rolloverEnabled'], budgets: ['rolloverCarriesOverspend'], loans: ['amortizationMethod', 'firstPaymentDate'], portfolios: ['costBasisMethod'],
        transactions: ['installmentNumber', 'installmentPlanId', 'statementDateOverride', 'transferExchangeRate'],
      };
      const rows = { ...parsed.rows } as Record<DataFileName, Record<string, unknown>[]>;
      for (const name of newFiles) rows[name] = [];
      for (const [name, fields] of Object.entries(newFields) as [DataFileName, string[]][]) {
        rows[name] = rows[name].map((row) => DATA_FILES[name].parse(Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)))) as Record<string, unknown>);
      }
      rows.preferences = rows.preferences.map((row) => {
        const { bankSyncAlerts: _bank, creditCardDueReminders: _card, ...emailNotifications } = row['emailNotifications'] as Record<string, unknown>;
        return DATA_FILES.preferences.parse({ ...row, emailNotifications });
      });
      return { ...parsed, manifest: { ...parsed.manifest, formatVersion: '1.7' }, rows: rows as unknown as ParsedExport['rows'] };
    }

    it('restores a 1.7 export, giving every 1.8 field what the app gives a new row', async () => {
      const { owner } = await richHousehold(db.em());
      const target = await emptyHousehold(db.em());

      const { summary } = await restore(scopeOf(target), asVersion17(await parsedExportOf(scopeOf(owner))));

      expect(summary.counts).toEqual(expect.objectContaining({ accounts: 3, 'credit-cards': 0, 'installment-plans': 0, transactions: 6 }));
      const connection = db.em().getConnection();
      const [settings] = await connection.execute<Record<string, unknown>[]>(
        `select (select rollover_carries_overspend from budget where tenant_key = ?) as carries,
           (select bool_or(rollover_enabled) from budget_template_category btc join budget b using (budget_key) where b.tenant_key = ?) as rollover,
           (select amortization_method from loan where tenant_key = ?) as amortization, (select cost_basis_method from portfolio where tenant_key = ?) as cost_basis,
           (select count(*)::int from "transaction" where tenant_key = ? and (installment_plan_key is not null or statement_date_override is not null)) as linked,
           (select credit_card_due_reminders_enabled from email_notification_preference where appuser_key = ?) as reminders`,
        [target.tenant.tenantKey, target.tenant.tenantKey, target.tenant.tenantKey, target.tenant.tenantKey, target.tenant.tenantKey, target.appuser.appuserKey]);
      expect(settings).toEqual({ amortization: 'FRENCH', carries: true, cost_basis: 'FIFO', linked: 0, reminders: true, rollover: false });
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

    describe('account language', () => {
      async function restoredLanguage(language: (parsed: ParsedExport) => void, owner?: { language: SupportedLanguages }) {
        const em = db.em();
        const source = await seedHousehold(em);
        if (owner) {
          em.assign(source.appuser, owner);
          await em.flush();
        }
        const parsed = await parsedExportOf(scopeOf(source));
        language(parsed);
        const target = await emptyHousehold(db.em());
        await restore(scopeOf(target), parsed);
        return (await db.em().findOneOrFail(Appuser, { appuserKey: target.appuser.appuserKey }, { filters: false })).language;
      }

      it('carries a Spanish account language across', async () => {
        expect(await restoredLanguage(() => undefined, { language: SupportedLanguages.ES })).toBe(SupportedLanguages.ES);
      });

      // Exports from before Spanish name EN or PT, in either case; the export shape is the same.
      it.each([['PT', SupportedLanguages.PT], ['pt', SupportedLanguages.PT], ['EN', SupportedLanguages.EN]])('restores the %s an older export names', async (exported, restored) => {
        const language = await restoredLanguage((parsed) => {
          parsed.manifest.formatVersion = '1.0';
          for (const row of parsed.rows.preferences) row.language = exported;
        });
        expect(language).toBe(restored);
      });

      it('keeps the member\'s own language for one this server does not have', async () => {
        const language = await restoredLanguage((parsed) => {
          for (const row of parsed.rows.preferences) row.language = 'FR';
        });
        expect(language).toBe(SupportedLanguages.EN);
      });
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
