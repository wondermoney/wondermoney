import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';
import { type Kysely, sql } from 'kysely';

import { type SqlDatabase, sqlQuery } from '@app/database/sql';
import { ruleActionsSchema, ruleConditionsSchema } from '@service/rules/rule-schema';
import { normalizeMerchantName } from '@service/transaction/merchant-normalization';

import type { AssetRef, DataFileName, DataRows } from './restore-format';
import { type ParsedExport, RestoreError } from './restore-reader';

/**
 * Writes a checked export (`restore-reader.ts`) into one household, all or nothing.
 *
 * ## Where it writes
 *
 * Only into `target.tenantKey`, and only while that household holds no accounts, portfolios,
 * budgets, goals or loans: a restore never merges. Everything happens in one database
 * transaction, under an advisory lock on the household, so two restores cannot both pass the
 * emptiness check, and a failure at any row (a constraint, a lost connection) leaves the household
 * exactly as empty as it was. Every row written carries the target household (and, where a table
 * has one, the restoring member); lookups of rows already there are scoped to it too. Shared
 * reference data (currencies, transaction types, the asset catalogue, the system categories and
 * global merchants) is only read. In particular a restore never adds to the asset catalogue from the
 * file: the catalogue is shared by every household, so a crafted export could otherwise plant assets
 * all of them see. Only the market-data lookup ({@link RestoreDeps.resolveAsset}) may add an asset,
 * from the provider's own data.
 *
 * ## How rows map
 *
 * - Export ids become new database keys; references follow them.
 * - Every member of the export becomes the restoring member: a restore loads one person's view of
 *   their household, and the partner, if any, is not part of the new one. A transaction categorised
 *   by both keeps the restoring member's own category.
 * - Currencies by ISO code (an unknown one stops the restore), transaction types and statuses by
 *   name, account types by name and institutions and brokers by name when this server knows them.
 * - Assets by ISIN, then symbol; missing ones are looked up in market data before the transaction
 *   ({@link RestoreDeps.resolveAsset}), in a dry run too, so the check shows what a restore will
 *   do. The trades of an asset still unknown are left out and listed (`assets_left_out`); the
 *   portfolio itself is restored.
 * - System categories by name (and parent's name), else created as the household's own.
 * - Tags, merchants and category settings reuse a matching row the household already has.
 * - Formerly bank-linked accounts come back as manual accounts with their full history; no
 *   connection or credential is restored, and the summary lists them for reconnecting.
 * - The member's preferences (currency, language, email notifications) are applied.
 *
 * Balances are written as exported. The member-currency columns are derived for accounts in the
 * member's own currency and left for the FX re-conversion job ({@link RestoreOutcome}) otherwise.
 */
export interface RestoreDeps {
  now?: () => Date;
  /**
   * Find `asset` in market data (adding the provider's record of it to the catalogue), returning its
   * `financial_asset` key, or null when market data does not know it. Called before the transaction,
   * on a dry run as on a real restore.
   */
  resolveAsset?: (asset: AssetRef) => Promise<null | number>;
}

export interface RestoreOutcome {
  /** Whether an account is in a currency other than the member's, for the FX re-conversion job. */
  hasForeignCurrencyAccounts: boolean;
  /** The restored portfolios' keys, for snapshot rebuilds. */
  portfolioKeys: number[];
  summary: RestoreSummary;
}

export interface RestoreSummary {
  /** Rows restored (or, in a dry run, that would be), per data file. */
  counts: Partial<Record<DataFileName, number>>;
  warnings: RestoreWarning[];
}

export interface RestoreTarget {
  appuserKey: number;
  tenantKey: number;
}

export interface RestoreWarning {
  code: RestoreWarningCode;
  count: number;
  /** A few of the names concerned (account names, symbols...), for the person to recognise. */
  values: string[];
}

export type RestoreWarningCode =
  /** Assets neither this server nor its market data knows: their portfolio transactions are left out. */
  | 'assets_left_out'
  /** Accounts that were linked to a bank: they come back as manual accounts, to reconnect. */
  | 'bank_linked_accounts'
  /** System categories this server does not have: restored as the household's own. */
  | 'categories_created'
  /** The member's currency changes to the export's. */
  | 'currency_changed'
  /** The export held another member; their rows now belong to the restoring member. */
  | 'members_merged'
  /** Rules that do not fit this server's rule format, or name rows the export left out: not restored. */
  | 'rules_skipped'
  | 'unknown_account_types'
  | 'unknown_brokers'
  | 'unknown_institutions';

type Db = Kysely<SqlDatabase>;
type Row = Record<string, unknown>;

const BATCH = 500;
const MAX_WARNING_VALUES = 10;
/** Advisory-lock namespace that serialises restores into one household (any constant int4). */
const RESTORE_LOCK_NAMESPACE = 650_067;
const LANGUAGES = new Set(['EN', 'PT']);

class DryRunRollback extends Error {
  constructor(readonly outcome: RestoreOutcome) {
    super('dry run');
  }
}

/**
 * Restore `parsed` into `target`. With `dryRun` everything is written and then rolled back, so the
 * summary is what a real restore would do, constraint checks included. Throws `RestoreError`
 * `household_not_empty` when the household has data, `unknown_currency` or `unknown_type` when the
 * export names reference data this server does not have.
 */
export async function restoreHousehold(em: EntityManager, target: RestoreTarget, parsed: ParsedExport, options: { deps?: RestoreDeps; dryRun: boolean }): Promise<RestoreOutcome> {
  const deps = options.deps ?? {};
  const catalogued = await catalogueAssets(sqlQuery(em), parsed.rows, deps);
  try {
    return await em.transactional(async (tx) => {
      const db = sqlQuery(tx);
      await sql`select pg_advisory_xact_lock(${RESTORE_LOCK_NAMESPACE}, ${target.tenantKey})`.execute(db);
      await assertHouseholdEmpty(db, target.tenantKey);
      const outcome = await new HouseholdRestore(db, target, parsed, deps, catalogued, options.dryRun).run();
      if (options.dryRun) throw new DryRunRollback(outcome);
      return outcome;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.outcome;
    throw error;
  }
}

/** Whether the household holds any account, portfolio, budget, goal, loan or manual asset. */
export async function isHouseholdEmpty(em: EntityManager, tenantKey: number): Promise<boolean> {
  return !(await householdHasData(sqlQuery(em), tenantKey));
}

async function assertHouseholdEmpty(db: Db, tenantKey: number): Promise<void> {
  if (await householdHasData(db, tenantKey)) throw new RestoreError('household_not_empty', 'The household already has data');
}

async function householdHasData(db: Db, tenantKey: number): Promise<boolean> {
  const { rows } = await sql<{ busy: boolean }>`
    select (exists(select 1 from account where tenant_key = ${tenantKey} and deleted_at is null)
      or exists(select 1 from portfolio where tenant_key = ${tenantKey} and deleted_at is null)
      or exists(select 1 from budget where tenant_key = ${tenantKey} and deleted_at is null)
      or exists(select 1 from goal where tenant_key = ${tenantKey} and deleted_at is null)
      or exists(select 1 from loan where tenant_key = ${tenantKey} and deleted_at is null)
      or exists(select 1 from manual_asset where tenant_key = ${tenantKey} and deleted_at is null)) as busy`.execute(db);
  return rows[0]?.busy === true;
}

const assetKey = (asset: AssetRef) => `${asset.symbol}\u0000${asset.isin ?? ''}`;

/** Assets of the export the catalogue knows by ISIN or symbol, keyed by {@link assetKey}. */
async function findAssets(db: Db, assets: AssetRef[]): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  if (assets.length === 0) return found;
  const isins = [...new Set(assets.map((asset) => asset.isin).filter((isin): isin is string => isin !== null))];
  const symbols = [...new Set(assets.map((asset) => asset.symbol))];
  const { rows } = await sql<{ financial_asset_key: number; isin: null | string; symbol: string }>`
    select financial_asset_key, isin, symbol from financial_asset
    where deleted_at is null and (isin = any(${isins}) or symbol = any(${symbols})) order by financial_asset_key`.execute(db);
  const byIsin = new Map<string, number>();
  const bySymbol = new Map<string, number>();
  for (const row of rows) {
    if (row.isin && !byIsin.has(row.isin)) byIsin.set(row.isin, row.financial_asset_key);
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row.financial_asset_key);
  }
  for (const asset of assets) {
    const key = (asset.isin ? byIsin.get(asset.isin) : undefined) ?? bySymbol.get(asset.symbol);
    if (key !== undefined) found.set(assetKey(asset), key);
  }
  return found;
}

function uniqueAssets(rows: DataRows): AssetRef[] {
  const assets = new Map<string, AssetRef>();
  for (const row of rows['portfolio-transactions']) assets.set(assetKey(row.asset), row.asset);
  return [...assets.values()];
}

/** Ask the catalogue for every asset this server does not have yet. Outside the transaction: the catalogue is shared. */
async function catalogueAssets(db: Db, rows: DataRows, deps: RestoreDeps): Promise<Map<string, number>> {
  const assets = uniqueAssets(rows);
  const known = await findAssets(db, assets);
  if (!deps.resolveAsset) return known;
  for (const asset of assets) {
    if (known.has(assetKey(asset))) continue;
    const key = await deps.resolveAsset(asset).catch(() => null);
    if (key !== null) known.set(assetKey(asset), key);
  }
  return known;
}

/** Export ids to new keys, for one file. */
class Keys {
  private readonly map = new Map<number, number>();

  get(id: null | number | undefined): null | number {
    return id === null || id === undefined ? null : (this.map.get(id) ?? null);
  }

  has(id: number): boolean {
    return this.map.has(id);
  }

  set(id: number, key: number): void {
    this.map.set(id, key);
  }
}

class Warnings {
  private readonly byCode = new Map<RestoreWarningCode, { count: number; values: Set<string> }>();

  add(code: RestoreWarningCode, value?: null | string, count = 1): void {
    const entry = this.byCode.get(code) ?? { count: 0, values: new Set<string>() };
    entry.count += count;
    if (value && entry.values.size < MAX_WARNING_VALUES) entry.values.add(value);
    this.byCode.set(code, entry);
  }

  list(): RestoreWarning[] {
    return [...this.byCode.entries()].map(([code, { count, values }]) => ({ code, count, values: [...values] })).sort((a, b) => a.code.localeCompare(b.code));
  }
}

async function insertRows(db: Db, table: string, rows: Row[]): Promise<void> {
  for (let index = 0; index < rows.length; index += BATCH) {
    await db.insertInto(table).values(rows.slice(index, index + BATCH)).execute();
  }
}

/** `count` fresh keys from `table`'s sequence, ascending, so restored rows keep the export's order. */
class HouseholdRestore {
  private readonly accounts = new Keys();
  private readonly budgets = new Keys();
  private readonly categories = new Keys();
  private readonly counts: Partial<Record<DataFileName, number>> = {};
  private currencies = new Map<string, number>();
  private readonly goals = new Keys();
  private readonly loans = new Keys();
  private readonly manualAssets = new Keys();
  private memberCurrency: null | string = null;
  private readonly merchants = new Keys();
  private readonly now: Date;
  private readonly portfolios = new Keys();
  private readonly rows: DataRows;
  private readonly series = new Keys();
  private readonly tags = new Keys();
  private readonly transactions = new Keys();
  private readonly warnings = new Warnings();

  constructor(
    private readonly db: Db,
    private readonly target: RestoreTarget,
    private readonly parsed: ParsedExport,
    deps: RestoreDeps,
    private readonly catalogued: Map<string, number>,
    private readonly dryRun: boolean,
  ) {
    this.rows = parsed.rows;
    this.now = deps.now?.() ?? new Date();
  }

  async run(): Promise<RestoreOutcome> {
    await this.resolveCurrencies();
    await this.preferences();
    await this.accountRows();
    await this.categoryRows();
    await this.categorySettings();
    await this.merchantRows();
    await this.merchantCategories();
    await this.tagRows();
    await this.manualAssetRows();
    await this.loanRows();
    await this.goalRows();
    await this.portfolioRows();
    await this.transactionRows();
    await this.transactionCategories();
    await this.transactionSplits();
    await this.transactionTags();
    await this.ruleRows();
    await this.recurring();
    await this.budgetRows();
    await this.goalChildren();
    await this.loanChildren();
    await this.portfolioTransactions();
    await this.watchlist();

    const others = this.rows.members.filter((member) => member.id !== this.parsed.manifest.exportedBy.memberId);
    if (others.length > 0) this.warnings.add('members_merged', null, others.length);
    const portfolioKeys = this.rows.portfolios.map((row) => this.portfolios.get(row.id)).filter((key): key is number => key !== null);
    const hasForeignCurrencyAccounts = this.rows.accounts.some((row) => row.currency !== this.memberCurrency);
    return { hasForeignCurrencyAccounts, portfolioKeys, summary: { counts: this.counts, warnings: this.warnings.list() } };
  }

  private count(file: DataFileName, rows: number): void {
    this.counts[file] = (this.counts[file] ?? 0) + rows;
  }

  private currency(code: null | string): null | number {
    return code === null ? null : (this.currencies.get(code) ?? null);
  }

  private stamp(createdAt?: null | string): { created_at: Date | string; updated_at: Date } {
    return { created_at: createdAt ?? this.now, updated_at: this.now };
  }

  /** The restoring member for any member reference, null for none. */
  private member(id: null | number): null | number {
    return id === null ? null : this.target.appuserKey;
  }

  // --- reference data ---

  private async resolveCurrencies(): Promise<void> {
    const codes = new Set<string>();
    const add = (code: null | string | undefined) => {
      if (code) codes.add(code);
    };
    const { rows } = this;
    add(rows.preferences[0]?.currency);
    for (const row of rows.accounts) add(row.currency);
    for (const row of rows.transactions) [row.originalCurrency, row.settlementCurrency, row.userCurrency].forEach(add);
    for (const row of rows['recurring-series']) add(row.currency);
    for (const row of rows['recurring-occurrences']) add(row.currency);
    for (const row of rows.budgets) add(row.currency);
    for (const row of rows.goals) add(row.currency);
    for (const row of rows['goal-activities']) add(row.currency);
    for (const row of rows['goal-transaction-fundings']) add(row.currency);
    for (const row of rows.loans) add(row.currency);
    for (const row of rows['manual-assets']) add(row.currency);
    for (const row of rows.portfolios) add(row.currency);
    for (const row of rows['portfolio-transactions']) [row.feeCurrency, row.originalCurrency, row.settlementCurrency].forEach(add);
    const known = await lookup(this.db, sql`select currency_key as k, code as name from currency where code = any(${[...codes]})`);
    const missing = [...codes].filter((code) => !known.has(code)).sort();
    if (missing.length > 0) throw new RestoreError('unknown_currency', `Unknown currencies: ${missing.join(', ')}`, { values: missing });
    this.currencies = known;
  }

  private async typeKeys(table: 'financial_transaction_type' | 'transaction_status' | 'transaction_type', names: (null | string)[]): Promise<Map<string, number>> {
    const wanted = [...new Set(names.filter((value): value is string => value !== null))];
    const key = `${table}_key`;
    const known = await lookup(this.db, sql`select ${sql.ref(key)} as k, name from ${sql.table(table)} where name = any(${wanted})`);
    const missing = wanted.filter((name) => !known.has(name)).sort();
    if (missing.length > 0) throw new RestoreError('unknown_type', `Unknown ${table.replaceAll('_', ' ')}s: ${missing.join(', ')}`, { field: table, values: missing });
    return known;
  }

  // --- the member ---

  private async preferences(): Promise<void> {
    const preferences = this.rows.preferences.find((row) => row.memberId === this.parsed.manifest.exportedBy.memberId) ?? this.rows.preferences[0];
    const { rows } = await sql<{ code: null | string }>`
      select c.code from appuser au left join currency c on c.currency_key = au.currency_key where au.appuser_key = ${this.target.appuserKey}`.execute(this.db);
    this.memberCurrency = rows[0]?.code ?? null;
    if (!preferences) return;
    const currencyKey = this.currency(preferences.currency);
    const language = preferences.language?.toUpperCase() ?? null;
    if (currencyKey !== null && preferences.currency !== this.memberCurrency) {
      this.warnings.add('currency_changed', preferences.currency);
      this.memberCurrency = preferences.currency;
    }
    await sql`
      update appuser set currency_key = coalesce(${currencyKey}, currency_key), language = coalesce(${language && LANGUAGES.has(language) ? language : null}, language), updated_at = ${this.now}
      where appuser_key = ${this.target.appuserKey}`.execute(this.db);
    const flags = preferences.emailNotifications;
    const values = {
      account_recovery_enabled: flags.accountRecovery ?? true,
      budget_alerts_enabled: flags.budgetAlerts ?? true,
      growth_emails_enabled: flags.growthEmails ?? true,
      monthly_story_enabled: flags.monthlyStory ?? true,
      weekly_insights_enabled: flags.weeklyInsights ?? true,
    };
    await this.db.insertInto('email_notification_preference')
      .values({ appuser_key: this.target.appuserKey, ...values, ...this.stamp() })
      .onConflict((conflict) => conflict.column('appuser_key').doUpdateSet({ ...values, deleted_at: null, updated_at: this.now }))
      .execute();
    this.count('preferences', 1);
  }

  // --- accounts, categories, merchants, tags ---

  private async accountRows(): Promise<void> {
    const list = this.rows.accounts;
    const types = await lookup(this.db, sql`select account_type_key as k, description as name from account_type where description = any(${list.map((row) => row.type).filter(Boolean)})`);
    const institutions = await lookup(this.db, sql`
      select account_financial_institution_key as k, name from account_financial_institution
      where deleted_at is null and name = any(${list.map((row) => row.institution).filter(Boolean)}) order by account_financial_institution_key`);
    const keys = await allocateKeys(this.db, 'account', 'account_key', list.length);
    const values = list.map((row, index) => {
      const key = keys[index]!;
      this.accounts.set(row.id, key);
      if (row.type && !types.has(row.type)) this.warnings.add('unknown_account_types', row.type);
      if (row.institution && !institutions.has(row.institution)) this.warnings.add('unknown_institutions', row.institution);
      if (row.bankLinked) this.warnings.add('bank_linked_accounts', row.name);
      const own = row.currency === this.memberCurrency;
      return {
        account_financial_institution_key: row.institution ? (institutions.get(row.institution) ?? null) : null,
        account_key: key,
        account_name: row.name,
        account_number: row.accountNumber,
        account_owner_appuser_key: this.target.appuserKey,
        account_type_key: row.type ? (types.get(row.type) ?? null) : null,
        // In the member's currency the converted balance is the balance; otherwise the FX job sets it.
        appuser_currency_balance: own ? row.balance : null,
        balance: row.balance,
        closed: row.closed,
        currency_key: this.currency(row.currency),
        fx_status: own ? null : 'missing',
        holder_name: row.holderName,
        is_private: row.isPrivate,
        opening_balance: row.openingBalance,
        opening_balance_date: row.openingBalanceDate,
        tenant_key: this.target.tenantKey,
        ...this.stamp(row.createdAt),
      };
    });
    await insertRows(this.db, 'account', values);
    this.count('accounts', values.length);
  }

  private async categoryRows(): Promise<void> {
    const system = (await sql<{ k: number; name: string; parent: null | string }>`
      select c.category_key as k, c.name, p.name as parent from category c left join category p on p.category_key = c.parent_category_category_key
      where c.tenant_key is null and c.is_system_category and c.deleted_at is null order by c.category_key`.execute(this.db)).rows;
    const own = (await sql<{ k: number; name: string; parent_key: null | number }>`
      select category_key as k, name, parent_category_category_key as parent_key from category
      where tenant_key = ${this.target.tenantKey} and deleted_at is null and is_system_category = false order by category_key`.execute(this.db)).rows;
    const byId = new Map(this.rows.categories.map((row) => [row.id, row]));
    const parentName = (row: DataRows['categories'][number]) => (row.parentId === null ? null : (byId.get(row.parentId)?.name ?? null));

    // Decide parents before children: a household category matches an existing one by name under
    // the same parent. New ones are numbered in file order, then written parents first.
    const levels: (typeof this.rows.categories)[] = [];
    const decided = new Set<number>();
    const fresh = new Set<number>();
    let pending = [...this.rows.categories];
    while (pending.length > 0) {
      const ready = pending.filter((row) => row.parentId === null || decided.has(row.parentId));
      if (ready.length === 0) throw new RestoreError('invalid_data', 'data/categories.json has a parent loop', { field: 'parentId', file: 'data/categories.json' });
      const level: typeof ready = [];
      for (const row of ready) {
        decided.add(row.id);
        if (row.system) {
          const match = system.find((candidate) => candidate.name === row.name && candidate.parent === parentName(row)) ?? system.find((candidate) => candidate.name === row.name);
          if (match) {
            this.categories.set(row.id, match.k);
            continue;
          }
          this.warnings.add('categories_created', row.name);
        }
        const parentKey = row.parentId !== null && fresh.has(row.parentId) ? undefined : this.categories.get(row.parentId);
        const existing = parentKey === undefined ? undefined : own.find((candidate) => candidate.name === row.name && candidate.parent_key === parentKey);
        if (existing) this.categories.set(row.id, existing.k);
        else {
          fresh.add(row.id);
          level.push(row);
        }
      }
      levels.push(level);
      pending = pending.filter((row) => !decided.has(row.id));
    }
    const created = this.rows.categories.filter((row) => fresh.has(row.id));
    const keys = await allocateKeys(this.db, 'category', 'category_key', created.length);
    created.forEach((row, index) => { this.categories.set(row.id, keys[index]!); });
    for (const level of levels) {
      await insertRows(this.db, 'category', level.map((row) => ({
        bg_color: row.bgColor ?? '#f3f3f3',
        category_key: this.categories.get(row.id),
        counts_as_spending: row.countsAsSpending,
        icon: row.icon,
        is_default_budget_category: row.isDefaultBudgetCategory,
        is_system_category: false,
        name: row.name,
        parent_category_category_key: this.categories.get(row.parentId),
        recurrency: row.recurrency ?? 'MONTHLY',
        tenant_key: this.target.tenantKey,
        text_color: row.textColor ?? '#030303',
        ...this.stamp(),
      })));
    }
    this.count('categories', this.rows.categories.length);
  }

  private async categorySettings(): Promise<void> {
    const seen = new Map<number, boolean>();
    for (const row of this.rows['category-settings']) seen.set(this.categories.get(row.categoryId)!, row.countsAsSpending);
    for (const [categoryKey, countsAsSpending] of seen) {
      await this.db.insertInto('tenant_category_setting')
        .values({ category_key: categoryKey, counts_as_spending: countsAsSpending, tenant_key: this.target.tenantKey, ...this.stamp() })
        .onConflict((conflict) => conflict.columns(['tenant_key', 'category_key']).doUpdateSet({ counts_as_spending: countsAsSpending, deleted_at: null, updated_at: this.now }))
        .execute();
    }
    this.count('category-settings', seen.size);
  }

  private async merchantCategories(): Promise<void> {
    const values = this.rows['merchant-categories'].map((row) => ({
      appuser_key: this.target.appuserKey,
      category_key: this.categories.get(row.categoryId),
      source: row.source,
      transaction_merchant_key: this.merchants.get(row.merchantId),
      ...this.stamp(),
    }));
    let written = 0;
    for (let index = 0; index < values.length; index += BATCH) {
      const result = await this.db.insertInto('appuser_merchant_category').values(values.slice(index, index + BATCH))
        .onConflict((conflict) => conflict.columns(['appuser_key', 'transaction_merchant_key', 'category_key']).doNothing()).returning('appuser_merchant_category_key').execute();
      written += result.length;
    }
    this.count('merchant-categories', written);
  }

  private async merchantRows(): Promise<void> {
    const list = this.rows.merchants;
    const global = await lookup(this.db, sql`select transaction_merchant_key as k, name from transaction_merchant where tenant_key is null and deleted_at is null and name = any(${list.filter((row) => row.global).map((row) => row.name)}) order by transaction_merchant_key`);
    const own = await lookup(this.db, sql`select transaction_merchant_key as k, normalized_name as name from transaction_merchant where tenant_key = ${this.target.tenantKey} and deleted_at is null and normalized_name is not null order by transaction_merchant_key`);
    const toCreate: { id: number; name: string; normalized: string }[] = [];
    const planned = new Map<string, number[]>();
    for (const row of list) {
      const globalKey = row.global ? global.get(row.name) : undefined;
      if (globalKey !== undefined) {
        this.merchants.set(row.id, globalKey);
        continue;
      }
      const normalized = normalizeMerchantName(row.name);
      const existing = own.get(normalized);
      if (existing !== undefined) {
        this.merchants.set(row.id, existing);
        continue;
      }
      const ids = planned.get(normalized);
      if (ids) ids.push(row.id);
      else {
        planned.set(normalized, [row.id]);
        toCreate.push({ id: row.id, name: row.name, normalized });
      }
    }
    const keys = await allocateKeys(this.db, 'transaction_merchant', 'transaction_merchant_key', toCreate.length);
    const values = toCreate.map((row, index) => {
      for (const id of planned.get(row.normalized)!) this.merchants.set(id, keys[index]!);
      return { name: row.name, normalized_name: row.normalized, tenant_key: this.target.tenantKey, transaction_merchant_key: keys[index], ...this.stamp() };
    });
    await insertRows(this.db, 'transaction_merchant', values);
    this.count('merchants', list.length);
  }

  private async tagRows(): Promise<void> {
    const own = await lookup(this.db, sql`select tag_key as k, lower(name) as name from tag where tenant_key = ${this.target.tenantKey} and deleted_at is null`);
    const toCreate: DataRows['tags'] = [];
    const planned = new Map<string, number[]>();
    for (const row of this.rows.tags) {
      const lower = row.name.toLowerCase();
      const existing = own.get(lower);
      if (existing !== undefined) {
        this.tags.set(row.id, existing);
        continue;
      }
      const ids = planned.get(lower);
      if (ids) ids.push(row.id);
      else {
        planned.set(lower, [row.id]);
        toCreate.push(row);
      }
    }
    const keys = await allocateKeys(this.db, 'tag', 'tag_key', toCreate.length);
    const values = toCreate.map((row, index) => {
      for (const id of planned.get(row.name.toLowerCase())!) this.tags.set(id, keys[index]!);
      return { color: row.color, created_by_appuser_key: this.member(row.createdByMemberId), name: row.name, tag_key: keys[index], tenant_key: this.target.tenantKey, ...this.stamp() };
    });
    await insertRows(this.db, 'tag', values);
    this.count('tags', this.rows.tags.length);
  }

  // --- loans, goals, portfolios (before the transactions that point at them) ---

  private async goalRows(): Promise<void> {
    const list = this.rows.goals;
    const keys = await allocateKeys(this.db, 'goal', 'goal_key', list.length);
    await insertRows(this.db, 'goal', list.map((row, index) => {
      this.goals.set(row.id, keys[index]!);
      return {
        annual_interest_rate_bps: row.annualInterestRateBps,
        appuser_key: this.target.appuserKey,
        archived_at: row.archivedAt,
        completed_at: row.completedAt,
        currency_key: this.currency(row.currency),
        current_balance: row.currentBalance,
        description: row.description,
        extra_payment: row.extraPayment,
        goal_key: keys[index],
        icon: row.icon,
        loan_key: this.loans.get(row.loanId),
        minimum_payment: row.minimumPayment,
        monthly_contribution_target: row.monthlyContributionTarget,
        name: row.name,
        priority: row.priority,
        status: row.status,
        target_amount: row.targetAmount,
        target_date: row.targetDate,
        tenant_key: this.target.tenantKey,
        type: row.type,
        ...this.stamp(row.createdAt),
      };
    }));
    this.count('goals', list.length);
  }

  private async loanRows(): Promise<void> {
    const list = this.rows.loans;
    const keys = await allocateKeys(this.db, 'loan', 'loan_key', list.length);
    await insertRows(this.db, 'loan', list.map((row, index) => {
      this.loans.set(row.id, keys[index]!);
      return {
        annual_interest_rate_bps: row.annualInterestRateBps,
        currency_key: this.currency(row.currency),
        include_in_net_worth: row.includeInNetWorth,
        loan_key: keys[index],
        maturity_date: row.maturityDate,
        name: row.name,
        notes: row.notes,
        opening_balance_date: row.openingBalanceDate,
        opening_principal_balance: row.openingPrincipalBalance,
        original_principal: row.originalPrincipal,
        owner_appuser_key: this.target.appuserKey,
        payment_day_of_month: row.paymentDayOfMonth,
        payment_frequency: row.paymentFrequency,
        provider_name: row.providerName,
        rate_type: row.rateType,
        regular_payment_amount: row.regularPaymentAmount,
        secured_asset_key: this.manualAssets.get(row.securedAssetId),
        status: row.status,
        tenant_key: this.target.tenantKey,
        term_months: row.termMonths,
        type: row.type,
        ...this.stamp(),
      };
    }));
    this.count('loans', list.length);
  }

  /** Manual assets and their valuations. Every asset becomes the restoring member's; a private one stays private. */
  private async manualAssetRows(): Promise<void> {
    const list = this.rows['manual-assets'];
    const keys = await allocateKeys(this.db, 'manual_asset', 'manual_asset_key', list.length);
    await insertRows(this.db, 'manual_asset', list.map((row, index) => {
      this.manualAssets.set(row.id, keys[index]!);
      return {
        archived_at: row.archivedAt,
        currency_key: this.currency(row.currency),
        growth_annual_rate_percent: row.growthAnnualRatePercent,
        growth_start_date: row.growthStartDate,
        is_private: row.isPrivate,
        kind: row.kind,
        manual_asset_key: keys[index],
        name: row.name,
        notes: row.notes,
        owner_appuser_key: this.target.appuserKey,
        purchase_date: row.purchaseDate,
        purchase_price: row.purchasePrice,
        tenant_key: this.target.tenantKey,
        ...this.stamp(row.createdAt),
      };
    }));
    this.count('manual-assets', list.length);

    const valuations = this.rows['manual-asset-valuations'].map((row) => ({
      manual_asset_key: this.manualAssets.get(row.manualAssetId),
      note: row.note,
      tenant_key: this.target.tenantKey,
      valuation_date: row.date,
      value: row.value,
      ...this.stamp(),
    }));
    await insertRows(this.db, 'manual_asset_valuation', valuations);
    this.count('manual-asset-valuations', valuations.length);
  }

  private async portfolioRows(): Promise<void> {
    const list = this.rows.portfolios;
    const keys = await allocateKeys(this.db, 'portfolio', 'portfolio_key', list.length);
    await insertRows(this.db, 'portfolio', list.map((row, index) => {
      this.portfolios.set(row.id, keys[index]!);
      const linked = this.accounts.get(row.linkedAccountId);
      return {
        account_balance_mode: linked === null ? null : row.accountBalanceMode,
        benchmark_symbol: row.benchmarkSymbol,
        closed_at: row.closedAt,
        currency_key: this.currency(row.currency),
        description: row.description,
        excluded: row.excluded,
        favored: row.favored,
        linked_account_key: linked,
        name: row.name,
        portfolio_key: keys[index],
        portfolio_owner_appuser_key: this.target.appuserKey,
        target_allocation: row.targetAllocation === null ? null : JSON.stringify(row.targetAllocation),
        tenant_key: this.target.tenantKey,
        ...this.stamp(row.createdAt),
      };
    }));
    this.count('portfolios', list.length);
  }

  // --- transactions ---

  private async transactionCategories(): Promise<void> {
    // Each member categorises on their own; in a one-member household the restoring member's
    // category wins, and the other member's stands in only where the restoring member set none.
    const exporter = this.parsed.manifest.exportedBy.memberId;
    const byExporter = new Set(this.rows['transaction-categories'].filter((row) => row.memberId === exporter).map((row) => row.transactionId));
    const keep = this.rows['transaction-categories'].filter((row) => row.memberId === exporter || !byExporter.has(row.transactionId));
    const values = keep.map((row) => ({ appuser_key: this.target.appuserKey, category_key: this.categories.get(row.categoryId), source: row.source, transaction_key: this.transactions.get(row.transactionId), ...this.stamp() }));
    let written = 0;
    for (let index = 0; index < values.length; index += BATCH) {
      const result = await this.db.insertInto('appuser_transaction_category').values(values.slice(index, index + BATCH))
        .onConflict((conflict) => conflict.columns(['appuser_key', 'transaction_key', 'category_key']).doNothing()).returning('appuser_transaction_category_key').execute();
      written += result.length;
    }
    this.count('transaction-categories', written);
  }

  private async transactionRows(): Promise<void> {
    const list = this.rows.transactions;
    const types = await this.typeKeys('transaction_type', list.map((row) => row.type));
    const statuses = await this.typeKeys('transaction_status', list.map((row) => row.status));
    const accountCurrency = new Map(this.rows.accounts.map((row) => [row.id, row.currency]));
    const keys = await allocateKeys(this.db, 'transaction', 'transaction_key', list.length);
    list.forEach((row, index) => { this.transactions.set(row.id, keys[index]!); });
    const values = list.map((row, index) => {
      const own = row.accountId !== null && accountCurrency.get(row.accountId) === this.memberCurrency;
      const foreign = row.settlementCurrency !== null && row.userCurrency !== null && row.settlementCurrency !== row.userCurrency;
      return {
        account_key: this.accounts.get(row.accountId),
        appuser_currency_balance: own ? row.balance : null,
        appuser_currency_exchange_rate: row.userExchangeRate,
        appuser_currency_key: this.currency(row.userCurrency),
        appuser_key: this.member(row.memberId),
        appuser_settlement_amount: row.userAmount,
        balance: row.balance,
        description: row.description,
        description_dirty: row.descriptionRaw,
        description_edited_by_user: row.descriptionEditedByUser,
        edited_settlement_amount: row.editedSettlementAmount,
        // A row with no amount in the member's currency is left for the FX job to convert.
        fx_status: row.userAmount !== null ? (foreign ? 'exact' : null) : (foreign ? 'missing' : null),
        hidden: row.hidden,
        merchant_edited_by_user: row.merchantEditedByUser,
        notes: row.notes,
        original_amount: row.originalAmount,
        original_currency_key: this.currency(row.originalCurrency),
        processed: true,
        reviewed: row.reviewed,
        settlement_amount: row.settlementAmount,
        settlement_currency_key: this.currency(row.settlementCurrency),
        settlement_exchange_rate: row.settlementExchangeRate,
        tenant_key: this.target.tenantKey,
        transaction_date: row.date,
        transaction_key: keys[index],
        transaction_merchant_key: this.merchants.get(row.merchantId),
        transaction_status_key: row.status === null ? null : (statuses.get(row.status) ?? null),
        transaction_type_key: row.type === null ? null : (types.get(row.type) ?? null),
        transfer_destination_account_key: this.accounts.get(row.transferDestinationAccountId),
        transfer_destination_goal_key: this.goals.get(row.transferDestinationGoalId),
        transfer_destination_portfolio_key: this.portfolios.get(row.transferDestinationPortfolioId),
        unedited_settlement_amount: row.uneditedSettlementAmount,
        ...this.stamp(row.createdAt),
      };
    });
    await insertRows(this.db, 'transaction', values);

    // Counterparts point both ways, so they are set once every row exists.
    const pairs = list.filter((row) => row.transferCounterpartId !== null).map((row) => [this.transactions.get(row.id)!, this.transactions.get(row.transferCounterpartId)!] as const);
    for (let index = 0; index < pairs.length; index += BATCH) {
      const batch = pairs.slice(index, index + BATCH).map(([key, counterpart]) => sql`(${key}::int, ${counterpart}::int)`);
      await sql`update "transaction" t set transfer_counterpart_key = v.counterpart from (values ${sql.join(batch)}) as v(k, counterpart)
        where t.transaction_key = v.k and t.tenant_key = ${this.target.tenantKey}`.execute(this.db);
    }
    this.count('transactions', list.length);
  }

  private async transactionSplits(): Promise<void> {
    const values = this.rows['transaction-splits'].map((row) => ({
      amount: row.amount,
      category_key: this.categories.get(row.categoryId),
      notes: row.notes,
      position: row.position,
      tenant_key: this.target.tenantKey,
      transaction_key: this.transactions.get(row.transactionId),
      ...this.stamp(),
    }));
    await insertRows(this.db, 'transaction_split', values);
    this.count('transaction-splits', values.length);
  }

  private async transactionTags(): Promise<void> {
    const values = this.rows['transaction-tags'].map((row) => ({ tag_key: this.tags.get(row.tagId), tenant_key: this.target.tenantKey, transaction_key: this.transactions.get(row.transactionId), ...this.stamp() }));
    let written = 0;
    for (let index = 0; index < values.length; index += BATCH) {
      const result = await this.db.insertInto('transaction_tag').values(values.slice(index, index + BATCH))
        .onConflict((conflict) => conflict.columns(['transaction_key', 'tag_key']).doNothing()).returning('transaction_tag_key').execute();
      written += result.length;
    }
    this.count('transaction-tags', written);
  }

  // --- rules ---

  private remapRule(rule: DataRows['rules'][number]): null | { actions: unknown; conditions: unknown } {
    const ids = (values: unknown, keys: Keys) => {
      const list = Array.isArray(values) ? values : [];
      const mapped = list.map((value) => (typeof value === 'number' ? keys.get(value) : value));
      return mapped.includes(null) ? null : mapped;
    };
    const conditions: Row[] = [];
    for (const condition of rule.conditions) {
      if (condition['field'] === 'account' || condition['field'] === 'category') {
        const values = ids(condition['values'], condition['field'] === 'account' ? this.accounts : this.categories);
        if (!values) return null;
        conditions.push({ ...condition, values });
      } else conditions.push(condition);
    }
    const actions: Row[] = [];
    for (const action of rule.actions) {
      if (action['type'] === 'set_category') {
        const categoryKey = typeof action['categoryId'] === 'number' ? this.categories.get(action['categoryId']) : null;
        if (categoryKey === null) return null;
        actions.push({ ...action, categoryId: categoryKey });
      } else if (action['type'] === 'add_tags') {
        const tagIds = ids(action['tagIds'], this.tags);
        if (!tagIds) return null;
        actions.push({ ...action, tagIds });
      } else if (action['type'] === 'set_merchant' && action['merchantId'] !== undefined) {
        const merchantKey = typeof action['merchantId'] === 'number' ? this.merchants.get(action['merchantId']) : null;
        if (merchantKey === null) return null;
        actions.push({ ...action, merchantId: merchantKey });
      } else actions.push(action);
    }
    const parsedConditions = ruleConditionsSchema.safeParse(conditions);
    const parsedActions = ruleActionsSchema.safeParse(actions);
    if (!parsedConditions.success || !parsedActions.success) return null;
    return { actions: parsedActions.data, conditions: parsedConditions.data };
  }

  private async ruleRows(): Promise<void> {
    const { rows } = await sql<{ top: null | number }>`select max(position) as top from rule where tenant_key = ${this.target.tenantKey} and deleted_at is null`.execute(this.db);
    const top = rows[0]?.top;
    const base = top === null || top === undefined ? 0 : top + 1;
    const values: Row[] = [];
    for (const rule of this.rows.rules) {
      const remapped = this.remapRule(rule);
      if (!remapped) {
        this.warnings.add('rules_skipped', rule.name);
        continue;
      }
      values.push({
        actions: JSON.stringify(remapped.actions),
        active: rule.active,
        conditions: JSON.stringify(remapped.conditions),
        match: rule.match,
        name: rule.name,
        owner_appuser_key: this.member(rule.ownerMemberId),
        position: base + rule.position,
        stop_processing: rule.stopProcessing,
        tenant_key: this.target.tenantKey,
        version: rule.version,
        ...this.stamp(),
      });
    }
    await insertRows(this.db, 'rule', values);
    this.count('rules', values.length);
  }

  // --- recurring, budgets, goal and loan details ---

  private async budgetRows(): Promise<void> {
    const list = this.rows.budgets;
    const keys = await allocateKeys(this.db, 'budget', 'budget_key', list.length);
    await insertRows(this.db, 'budget', list.map((row, index) => {
      this.budgets.set(row.id, keys[index]!);
      return { appuser_key: this.target.appuserKey, budget_key: keys[index], currency_key: this.currency(row.currency), description: row.description, name: row.name, num_adults: row.numAdults, num_dependents: row.numDependents, period_start_day: row.periodStartDay, tenant_key: this.target.tenantKey, ...this.stamp() };
    }));
    this.count('budgets', list.length);

    const lines = this.rows['budget-categories'];
    const lineKeys = await allocateKeys(this.db, 'budget_template_category', 'budget_template_category_key', lines.length);
    await insertRows(this.db, 'budget_template_category', lines.map((row, index) => ({
      amount_budgeted: row.amount,
      budget_key: this.budgets.get(row.budgetId),
      budget_template_category_key: lineKeys[index],
      category_key: this.categories.get(row.categoryId),
      month: row.month,
      recurrency: row.recurrency,
      year: row.year,
    })));
    const links = lines.flatMap((row, index) => [...new Set(row.accountIds)].map((accountId) => ({ account_account_key: this.accounts.get(accountId), budget_template_category_budget_template_category_key: lineKeys[index] })));
    await insertRows(this.db, 'budget_template_category_accounts', links);
    this.count('budget-categories', lines.length);

    const incomes = this.rows['budget-incomes'].map((row) => ({ amount: row.amount ?? '0', budget_key: this.budgets.get(row.budgetId), name: row.name, recurrency: row.recurrency ?? 'MONTHLY' }));
    await insertRows(this.db, 'budget_template_income', incomes);
    this.count('budget-incomes', incomes.length);
  }

  private async goalChildren(): Promise<void> {
    const links = new Map<string, Row>();
    for (const row of this.rows['goal-account-links']) {
      const value = { account_key: this.accounts.get(row.accountId), goal_key: this.goals.get(row.goalId), tenant_key: this.target.tenantKey, ...this.stamp() };
      links.set(`${String(value.goal_key)}:${String(value.account_key)}`, value);
    }
    await insertRows(this.db, 'goal_account_link', [...links.values()]);
    this.count('goal-account-links', links.size);

    const activities = this.rows['goal-activities'].map((row) => ({
      amount: row.amount,
      appuser_key: this.target.appuserKey,
      category_key: this.categories.get(row.categoryId),
      created_by_appuser_key: this.member(row.createdByMemberId),
      currency_key: this.currency(row.currency),
      destination_type: row.destinationType,
      goal_key: this.goals.get(row.goalId),
      note: row.note,
      occurred_at: row.occurredAt,
      source_type: row.sourceType,
      tenant_key: this.target.tenantKey,
      transaction_key: this.transactions.get(row.transactionId),
      type: row.type,
      ...this.stamp(),
    }));
    await insertRows(this.db, 'goal_activity', activities);
    this.count('goal-activities', activities.length);

    const fundings = this.rows['goal-transaction-fundings'].map((row) => ({
      amount: row.amount,
      currency_key: this.currency(row.currency),
      funding_type: row.fundingType,
      goal_key: this.goals.get(row.goalId),
      reversed_at: row.reversedAt,
      tenant_key: this.target.tenantKey,
      transaction_key: this.transactions.get(row.transactionId),
      ...this.stamp(),
    }));
    await insertRows(this.db, 'goal_transaction_funding', fundings);
    this.count('goal-transaction-fundings', fundings.length);
  }

  private async loanChildren(): Promise<void> {
    const adjustments = this.rows['loan-adjustments'].map((row) => ({
      amount: row.amount,
      created_by_appuser_key: this.target.appuserKey,
      effective_date: row.effectiveDate,
      loan_key: this.loans.get(row.loanId),
      reason: row.reason,
      tenant_key: this.target.tenantKey,
      type: row.type,
      ...this.stamp(),
    }));
    await insertRows(this.db, 'loan_adjustment', adjustments);
    this.count('loan-adjustments', adjustments.length);

    const ratePeriods = this.rows['loan-rate-periods'].map((row) => ({
      annual_interest_rate_bps: row.annualInterestRateBps,
      effective_date: row.effectiveDate,
      loan_key: this.loans.get(row.loanId),
      tenant_key: this.target.tenantKey,
      ...this.stamp(),
    }));
    await insertRows(this.db, 'loan_rate_period', ratePeriods);
    this.count('loan-rate-periods', ratePeriods.length);

    const repayments = this.rows['loan-repayments'].map((row) => ({
      allocation_source: row.allocationSource,
      fee_amount: row.feeAmount,
      interest_amount: row.interestAmount,
      linked_by_appuser_key: this.target.appuserKey,
      loan_key: this.loans.get(row.loanId),
      needs_review: row.needsReview,
      notes: row.notes,
      payment_date: row.paymentDate,
      principal_amount: row.principalAmount,
      tenant_key: this.target.tenantKey,
      total_payment_amount: row.totalPaymentAmount,
      transaction_key: this.transactions.get(row.transactionId),
      ...this.stamp(),
    }));
    await insertRows(this.db, 'loan_repayment_link', repayments);
    this.count('loan-repayments', repayments.length);
  }

  private async recurring(): Promise<void> {
    const list = this.rows['recurring-series'];
    const keys = await allocateKeys(this.db, 'recurring_series', 'recurring_series_key', list.length);
    await insertRows(this.db, 'recurring_series', list.map((row, index) => {
      this.series.set(row.id, keys[index]!);
      return {
        account_key: this.accounts.get(row.accountId),
        amount_type: row.amountType,
        appuser_key: this.member(row.memberId),
        average_amount: row.averageAmount,
        cadence: row.cadence,
        category_key: this.categories.get(row.categoryId),
        currency_key: this.currency(row.currency),
        display_name: row.displayName,
        expected_amount: row.expectedAmount,
        expected_amount_max: row.expectedAmountMax,
        expected_amount_min: row.expectedAmountMin,
        first_seen_at: row.firstSeenAt,
        last_amount: row.lastAmount,
        last_seen_at: row.lastSeenAt,
        merchant_display_name: row.merchantDisplayName,
        next_expected_at: row.nextExpectedAt,
        normalized_merchant_key: row.merchantKey,
        occurrence_count: row.occurrenceCount,
        recurring_series_key: keys[index],
        source: row.source,
        status: row.status,
        tenant_key: this.target.tenantKey,
        type: row.type,
        ...this.stamp(),
      };
    }));
    this.count('recurring-series', list.length);
    const occurrences = this.rows['recurring-occurrences'].map((row) => ({
      amount: row.amount,
      currency_key: this.currency(row.currency),
      match_status: row.matchStatus,
      occurrence_date: row.date,
      recurring_series_key: this.series.get(row.seriesId),
      transaction_key: this.transactions.get(row.transactionId),
      ...this.stamp(),
    }));
    await insertRows(this.db, 'recurring_occurrence', occurrences);
    this.count('recurring-occurrences', occurrences.length);
  }

  // --- portfolio transactions and the watchlist ---

  /** The catalogue's key for every asset of the export it knows, by {@link assetKey}. Never writes to the catalogue. */
  private async assetKeys(): Promise<Map<string, number>> {
    const assets = uniqueAssets(this.rows);
    const keys = new Map(this.catalogued);
    for (const [key, value] of await findAssets(this.db, assets.filter((asset) => !keys.has(assetKey(asset))))) keys.set(key, value);
    for (const asset of assets) if (!keys.has(assetKey(asset))) this.warnings.add('assets_left_out', asset.symbol);
    return keys;
  }

  private async portfolioTransactions(): Promise<void> {
    const assets = await this.assetKeys();
    const list = this.rows['portfolio-transactions'].filter((row) => assets.has(assetKey(row.asset)));
    if (list.length === 0) {
      this.count('portfolio-transactions', 0);
      return;
    }
    const types = await this.typeKeys('financial_transaction_type', list.map((row) => row.type));
    const brokers = await lookup(this.db, sql`select financial_broker_key as k, display_name as name from financial_broker where display_name = any(${list.map((row) => row.broker).filter(Boolean)}) order by financial_broker_key`);
    const keys = await allocateKeys(this.db, 'financial_transaction', 'transaction_key', list.length);
    const values = list.map((row, index) => {
      if (row.broker && !brokers.has(row.broker)) this.warnings.add('unknown_brokers', row.broker);
      return {
        appuser_key: this.member(row.memberId),
        fee_amount: row.feeAmount,
        fee_currency_key: this.currency(row.feeCurrency),
        financial_asset_key: assets.get(assetKey(row.asset)),
        financial_broker_key: row.broker ? (brokers.get(row.broker) ?? null) : null,
        financial_transaction_type_key: types.get(row.type),
        internal_transaction_id: randomUUID(),
        notes: row.notes,
        original_amount: row.originalAmount,
        original_currency_key: this.currency(row.originalCurrency),
        original_unit_amount: row.originalUnitAmount,
        portfolio_key: this.portfolios.get(row.portfolioId),
        quantity: row.quantity,
        settlement_amount: row.settlementAmount,
        settlement_currency_key: this.currency(row.settlementCurrency),
        settlement_exchange_rate: row.settlementExchangeRate,
        settlement_unit_amount: row.settlementUnitAmount,
        tenant_key: this.target.tenantKey,
        transaction_date: row.date,
        transaction_key: keys[index],
        ...this.stamp(),
      };
    });
    await insertRows(this.db, 'financial_transaction', values);
    const details = list.flatMap((row, index) => (row.savingsCertificateTaxExempt === null ? [] : [{ tax_exempt: row.savingsCertificateTaxExempt, transaction_key: keys[index], ...this.stamp() }]));
    await insertRows(this.db, 'certificado_aforro_subscription_detail', details);

    // Trades in another currency, in the member's: at the latest rate on or before each trade, as
    // `portfolio-transaction-conversion.ts` stores them. Without a rate holdings read the settlement amounts.
    const memberCurrency = this.currency(this.memberCurrency);
    if (memberCurrency !== null) {
      await sql`
        update financial_transaction ft
        set appuser_currency_exchange_rate = r.rate, appuser_settlement_amount = ft.settlement_amount * r.rate, appuser_unit_amount = ft.settlement_unit_amount * r.rate
        from (
          select f.transaction_key, (select er.rate from exchange_rate er
            where er.from_currency_key = f.settlement_currency_key and er.to_currency_key = ${memberCurrency} and er.date <= f.transaction_date
            order by er.date desc limit 1) as rate
          from financial_transaction f
          where f.transaction_key = any(${keys}) and f.settlement_currency_key <> ${memberCurrency} and f.transaction_date is not null
        ) r
        where ft.transaction_key = r.transaction_key and r.rate is not null and ft.tenant_key = ${this.target.tenantKey}`.execute(this.db);
    }
    this.count('portfolio-transactions', list.length);
  }

  private async watchlist(): Promise<void> {
    const values = [...new Set(this.rows.watchlist.map((row) => row.symbol))].map((symbol) => ({ appuser_key: this.target.appuserKey, symbol, tenant_key: this.target.tenantKey, ...this.stamp() }));
    let written = 0;
    for (let index = 0; index < values.length; index += BATCH) {
      const result = await this.db.insertInto('watchlist').values(values.slice(index, index + BATCH))
        .onConflict((conflict) => conflict.columns(['appuser_key', 'symbol']).doNothing()).returning('watchlist_key').execute();
      written += result.length;
    }
    this.count('watchlist', written);
  }
}

async function allocateKeys(db: Db, table: string, column: string, count: number): Promise<number[]> {
  if (count === 0) return [];
  const { rows } = await sql<{ k: number }>`select nextval(pg_get_serial_sequence(${table}, ${column}))::int as k from generate_series(1, ${count})`.execute(db);
  return rows.map((row) => row.k).sort((a, b) => a - b);
}

async function lookup(db: Db, query: ReturnType<typeof sql<{ k: number; name: string }>>): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const row of (await query.execute(db)).rows) if (!map.has(row.name)) map.set(row.name, row.k);
  return map;
}
