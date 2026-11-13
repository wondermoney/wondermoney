import type { Writable } from 'node:stream';

import type { EntityManager } from '@mikro-orm/postgresql';
import { type Kysely, type RawBuilder, sql } from 'kysely';

import { type SqlDatabase, sqlQuery } from '@app/database/sql';
import { visibleAccountSql } from '@service/account/account-visibility-sql';
import { buildInfo } from '@utils/constants';

import { type ExportFileSource, writeExportArchive } from './export-archive';
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, type ExportManifest } from './export-format';

/**
 * Everything one household member can see, as the files of a WonderMoney export
 * (`export-format.ts`).
 *
 * ## Scope
 *
 * The export runs in the worker, outside any request, so the ORM tenant filter is not armed: every
 * query here states its own tenant, privacy and `deleted_at` predicates, the way `report-filters.ts`
 * does. The rules mirror what the app shows the member:
 *
 * - Accounts: the household's shared accounts and the member's own private ones
 *   (`Account.isPrivate`). The other member's private accounts are absent, and so is everything
 *   that hangs off them: their transactions, and those transactions' categories, splits, tag links,
 *   recurring series and occurrences, goal fundings and loan repayments; budget lines, goal links
 *   and portfolio links to them; and rules that name them in a condition.
 * - Merchants: only those the member can reach (on a visible transaction, in their own merchant
 *   categories or in a rule), never the household's whole merchant table, whose names would
 *   describe the other member's private spending.
 * - Manual assets (homes, vehicles, crypto wallets): the household's shared ones and the member's
 *   own private ones (`ManualAsset.isPrivate`), each with its valuations, and a wallet with its
 *   public addresses and their tokens. The other member's private assets are absent.
 * - Credit-card settings and installment plans follow their card: those of every exported account.
 *   A transaction names the plan installment it pays only when the plan is in the export.
 * - Loans, the watchlist, transaction templates and the account order are personal in the app, so
 *   only the member's own.
 * - Categories, category settings, tags, budgets, goals, portfolios and the household's own exchange
 *   rates and security prices are household-wide.
 *
 * ## Never exported
 *
 * Bank credentials and connection tokens, provider ids (`account_id`, Enable Banking / Nordigen
 * transaction ids, requisitions, sessions), auth data (sessions, 2FA, password hashes, external
 * user ids, API keys), audit logs, AI usage and enrichment state, analytics and email delivery
 * records. A formerly bank-linked account says so (`bankLinked`) without any of its connection.
 * Nor are transaction attachments (the files and their metadata), assistant consents and proposals,
 * import sessions and learned import mappings, rule-suggestion dismissals, or what the server derives
 * again (portfolio snapshots, category statistics, categorization confidence, installment matching).
 *
 * ## Size
 *
 * Small tables (accounts, categories, goals...) are read whole. Transactions and the tables
 * hanging off them are read in key order, a batch at a time, while the zip is written; only an
 * id map (database key to export id) per entity is held in memory.
 */
export interface ExportScope {
  appuserKey: number;
  tenantKey: number;
}

export interface HoldingRow {
  averageBuyPrice: null | number;
  currency: string;
  currentPrice: null | number;
  currentValue: null | number;
  financialAssetName: string;
  financialAssetSymbol: string;
  financialAssetType: string;
  quantity: number;
}

export interface HouseholdExportDeps {
  /** Current holdings of one portfolio, for `csv/holdings.csv`. */
  holdings?: (input: { appuserKey: number; portfolioKey: number; tenantKey: number }) => Promise<HoldingRow[]>;
  now?: () => Date;
}

type Db = Kysely<SqlDatabase>;
type Row = Record<string, unknown>;

const BATCH = 1000;

/** Export-local ids: 1, 2, 3... in the order rows are first seen. */
class IdMap {
  get size() {
    return this.ids.size;
  }

  private readonly ids = new Map<number, number>();

  add(key: unknown): number {
    const k = Number(key);
    let id = this.ids.get(k);
    if (id === undefined) {
      id = this.ids.size + 1;
      this.ids.set(k, id);
    }
    return id;
  }

  get(key: unknown): null | number {
    if (key === null || key === undefined) return null;
    return this.ids.get(Number(key)) ?? null;
  }

  has(key: unknown): boolean {
    return key !== null && key !== undefined && this.ids.has(Number(key));
  }

  keys(): number[] {
    return [...this.ids.keys()];
  }
}

// --- value helpers ---------------------------------------------------------------------------

/** A timestamptz column as an ISO-8601 UTC string, formatted by Postgres. `col` is a code literal. */
const tsx = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
/** A date column as `YYYY-MM-DD`. */
const dx = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;
/** A timestamptz column stored at 00:00 UTC for a calendar day (the overrides' `date`), as that `YYYY-MM-DD`. */
const utcDay = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD')`;

/** A numeric column read as text, trimmed of trailing zeros: `-12.3400` -> `-12.34`. */
function dec(value: unknown): null | string {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.includes('.') ? text.replace(/0+$/u, '').replace(/\.$/u, '') : text;
}

const str = (value: unknown): null | string => (value === null || value === undefined ? null : String(value));
const bool = (value: unknown): boolean => value === true || value === 't' || value === 'true';
const int = (value: unknown): null | number => (value === null || value === undefined ? null : Number(value));
const dayOf = (iso: null | string): null | string => (iso ? iso.slice(0, 10) : null);

async function rowsOf(db: Db, query: RawBuilder<Row>): Promise<Row[]> {
  return (await query.execute(db)).rows;
}

/** Rows of `build(after)` in pages of {@link BATCH}, by the `k` column the query selects and orders by. */
async function* paged(db: Db, build: (after: number) => RawBuilder<Row>): AsyncGenerator<Row> {
  let after = 0;
  for (;;) {
    const rows = await rowsOf(db, build(after));
    for (const row of rows) yield row;
    if (rows.length < BATCH) return;
    after = Number(rows.at(-1)?.['k']);
  }
}

const limit = (after: number, key: string) => sql`and ${sql.raw(key)} > ${after} order by ${sql.raw(key)} limit ${BATCH}`;

// --- the export ------------------------------------------------------------------------------

class HouseholdExport {
  private readonly accountKeys: number[] = [];
  private accountRows: Row[] = [];
  private readonly accounts = new IdMap();
  /** The exporting member's place for each account in their list, by account key. */
  private accountPositions = new Map<number, number>();
  /** Who each private account is shared with, among the exported members: `[appuserKey, access]`. */
  private accountShares = new Map<number, [number, string][]>();
  private readonly budgets = new IdMap();
  private readonly categories = new IdMap();
  private categoryRows: Row[] = [];
  private currency: null | string = null;
  private readonly db: Db;
  private readonly goals = new IdMap();
  private readonly loans = new IdMap();
  private readonly manualAssets = new IdMap();
  private memberRows: Row[] = [];
  private readonly members = new IdMap();
  private merchantRows: Row[] = [];
  private readonly merchants = new IdMap();
  private ownerAppuserKey: null | number = null;
  private readonly plans = new IdMap();
  private portfolioRows: Row[] = [];
  private readonly portfolios = new IdMap();
  private readonly series = new IdMap();
  private readonly tags = new IdMap();
  private readonly transactions = new IdMap();
  private readonly walletAddresses = new IdMap();

  constructor(em: EntityManager, private readonly scope: ExportScope, private readonly deps: HouseholdExportDeps = {}) {
    this.db = sqlQuery(em);
  }

  /**
   * Read the household's small tables and number every row the files will refer to. Must run
   * before {@link files}. Throws when the member does not belong to the household.
   */
  async prepare(): Promise<void> {
    const { appuserKey, tenantKey } = this.scope;
    const db = this.db;

    const membership = await rowsOf(db, sql`
      select t.owner_appuser_key, c.code as currency
      from appuser_tenant at
      join tenant t on t.tenant_key = at.tenant_key
      join appuser au on au.appuser_key = at.appuser_key
      left join currency c on c.currency_key = au.currency_key
      where at.tenant_key = ${tenantKey} and at.appuser_key = ${appuserKey} and at.record_active and at.deleted_at is null and t.deleted_at is null`);
    if (membership.length === 0) throw new Error('The member does not belong to this household');
    this.ownerAppuserKey = int(membership[0]?.['owner_appuser_key']);
    this.currency = str(membership[0]?.['currency']);

    // The exporting member first, so they are always member 1.
    this.memberRows = await rowsOf(db, sql`
      select au.appuser_key, au.first_name, au.last_name, au.email_address, at.role
      from appuser_tenant at join appuser au on au.appuser_key = at.appuser_key
      where at.tenant_key = ${tenantKey} and at.record_active and at.deleted_at is null and au.deleted_at is null
      order by (au.appuser_key = ${appuserKey}) desc, at.appuser_tenant_key`);
    for (const row of this.memberRows) this.members.add(row['appuser_key']);

    this.accountRows = await rowsOf(db, sql`
      select a.account_key, a.account_name, a.account_number, a.holder_name, a.account_owner_appuser_key, a.is_private, a.is_joint, a.closed,
        a.balance::text as balance, a.opening_balance::text as opening_balance, ${sql.raw(tsx('a.opening_balance_date'))} as opening_balance_date,
        ${sql.raw(tsx('a.created_at'))} as created_at,
        c.code as currency, at.description as account_type, fi.name as institution,
        (a.enable_banking_connection_key is not null or a.nordigen_requisition_key is not null) as bank_linked
      from account a
      left join currency c on c.currency_key = a.currency_key
      left join account_type at on at.account_type_key = a.account_type_key
      left join account_financial_institution fi on fi.account_financial_institution_key = a.account_financial_institution_key
      where a.tenant_key = ${tenantKey} and a.deleted_at is null and ${sql.raw(visibleAccountSql('a', appuserKey))}
      order by a.account_key`);
    for (const row of this.accountRows) {
      this.accounts.add(row['account_key']);
      this.accountKeys.push(Number(row['account_key']));
    }
    for (const row of await rowsOf(db, sql`
      select account_key, position from appuser_account_position
      where appuser_key = ${appuserKey} and deleted_at is null and account_key = any(${this.accountKeys}) order by appuser_account_position_key`)) this.accountPositions.set(Number(row['account_key']), Number(row['position']));
    for (const row of await rowsOf(db, sql`
      select account_key, appuser_key, access from account_share
      where tenant_key = ${tenantKey} and deleted_at is null and account_key = any(${this.accountKeys}) order by account_key, appuser_key`)) {
      // A share for someone no longer in the household is not exported: they have no member id.
      if (!this.members.has(row['appuser_key'])) continue;
      const key = Number(row['account_key']);
      this.accountShares.set(key, [...(this.accountShares.get(key) ?? []), [Number(row['appuser_key']), String(row['access'])]]);
    }

    // The household's own categories and the global system ones a restore resolves by name.
    this.categoryRows = await rowsOf(db, sql`
      select c.category_key, c.name, c.icon, c.bg_color, c.text_color, c.is_system_category, c.is_default_budget_category,
        c.counts_as_spending, c.recurrency, c.parent_category_category_key as parent_key
      from category c
      where c.deleted_at is null and ((c.tenant_key = ${tenantKey} and c.is_system_category = false) or (c.tenant_key is null and c.is_system_category = true))
      order by c.is_system_category desc, c.category_key`);
    for (const row of this.categoryRows) this.categories.add(row['category_key']);

    for (const row of await rowsOf(db, sql`select tag_key from tag where tenant_key = ${tenantKey} and deleted_at is null order by tag_key`)) this.tags.add(row['tag_key']);

    for await (const row of paged(db, (after) => sql`
      select t.transaction_key as k from "transaction" t
      where ${this.visibleTransaction('t')} ${limit(after, 't.transaction_key')}`)) this.transactions.add(row['k']);

    this.merchantRows = await rowsOf(db, sql`
      select m.transaction_merchant_key, m.name, m.website, m.logo_url, (m.tenant_key is null) as global
      from transaction_merchant m
      where m.deleted_at is null and (m.tenant_key = ${tenantKey} or m.tenant_key is null) and (
        m.transaction_merchant_key in (select t.transaction_merchant_key from "transaction" t where ${this.visibleTransaction('t')})
        or exists (select 1 from appuser_merchant_category amc where amc.transaction_merchant_key = m.transaction_merchant_key and amc.appuser_key = ${appuserKey} and amc.deleted_at is null)
        or m.transaction_merchant_key in (select tt.transaction_merchant_key from transaction_template tt where tt.tenant_key = ${tenantKey} and tt.owner_appuser_key = ${appuserKey} and tt.deleted_at is null)
        or m.transaction_merchant_key = any(${await this.ruleMerchantKeys()}))
      order by m.transaction_merchant_key`);
    for (const row of this.merchantRows) this.merchants.add(row['transaction_merchant_key']);

    for (const row of await rowsOf(db, sql`select budget_key from budget where tenant_key = ${tenantKey} and deleted_at is null order by budget_key`)) this.budgets.add(row['budget_key']);
    for (const row of await rowsOf(db, sql`select loan_key from loan where tenant_key = ${tenantKey} and owner_appuser_key = ${appuserKey} and deleted_at is null order by loan_key`)) this.loans.add(row['loan_key']);
    for (const row of await rowsOf(db, sql`
      select manual_asset_key from manual_asset
      where tenant_key = ${tenantKey} and deleted_at is null and (is_private = false or owner_appuser_key = ${appuserKey})
      order by manual_asset_key`)) this.manualAssets.add(row['manual_asset_key']);
    for (const row of await rowsOf(db, sql`select goal_key from goal where tenant_key = ${tenantKey} and deleted_at is null order by goal_key`)) this.goals.add(row['goal_key']);
    this.portfolioRows = await rowsOf(db, sql`
      select p.portfolio_key, p.name, p.description, p.benchmark_symbol, ${sql.raw(tsx('p.closed_at'))} as closed_at, p.excluded, p.favored,
        p.target_allocation, p.account_balance_mode, p.cost_basis_method, p.linked_account_key, p.portfolio_owner_appuser_key, c.code as currency, ${sql.raw(tsx('p.created_at'))} as created_at
      from portfolio p left join currency c on c.currency_key = p.currency_key
      where p.tenant_key = ${tenantKey} and p.deleted_at is null
      order by p.portfolio_key`);
    for (const row of this.portfolioRows) this.portfolios.add(row['portfolio_key']);
    for (const row of await rowsOf(db, sql`
      select rs.recurring_series_key from recurring_series rs
      where rs.tenant_key = ${tenantKey} and rs.deleted_at is null and (rs.account_key is null or rs.account_key = any(${this.accountKeys}))
      order by rs.recurring_series_key`)) this.series.add(row['recurring_series_key']);
    for (const row of await rowsOf(db, sql`
      select installment_plan_key from installment_plan
      where tenant_key = ${tenantKey} and deleted_at is null and account_key = any(${this.accountKeys})
      order by installment_plan_key`)) this.plans.add(row['installment_plan_key']);
  }

  /** The archive's files, in the order they are written. Call {@link prepare} first. */
  files(): ExportFileSource[] {
    return [
      { format: 'json', path: 'data/members.json', rows: () => this.memberJson() },
      { format: 'json', path: 'data/preferences.json', rows: () => this.preferences() },
      { format: 'json', path: 'data/accounts.json', rows: () => this.accountJson() },
      { format: 'json', path: 'data/credit-cards.json', rows: () => this.creditCards() },
      { format: 'json', path: 'data/categories.json', rows: () => this.categoryJson() },
      { format: 'json', path: 'data/category-settings.json', rows: () => this.categorySettings() },
      { format: 'json', path: 'data/merchants.json', rows: () => this.merchantJson() },
      { format: 'json', path: 'data/merchant-categories.json', rows: () => this.merchantCategories() },
      { format: 'json', path: 'data/tags.json', rows: () => this.tagJson() },
      { format: 'json', path: 'data/transactions.json', rows: () => this.transactionJson() },
      { format: 'json', path: 'data/transaction-categories.json', rows: () => this.transactionCategories() },
      { format: 'json', path: 'data/transaction-splits.json', rows: () => this.transactionSplits() },
      { format: 'json', path: 'data/transaction-reimbursements.json', rows: () => this.transactionReimbursements() },
      { format: 'json', path: 'data/transaction-tags.json', rows: () => this.transactionTags() },
      { format: 'json', path: 'data/installment-plans.json', rows: () => this.installmentPlans() },
      { format: 'json', path: 'data/installments.json', rows: () => this.installments() },
      { format: 'json', path: 'data/transaction-templates.json', rows: () => this.transactionTemplates() },
      { format: 'json', path: 'data/rules.json', rows: () => this.rules() },
      { format: 'json', path: 'data/recurring-series.json', rows: () => this.recurringSeries() },
      { format: 'json', path: 'data/recurring-occurrences.json', rows: () => this.recurringOccurrences() },
      { format: 'json', path: 'data/budgets.json', rows: () => this.budgetJson() },
      { format: 'json', path: 'data/budget-categories.json', rows: () => this.budgetCategories() },
      { format: 'json', path: 'data/budget-incomes.json', rows: () => this.budgetIncomes() },
      { format: 'json', path: 'data/goals.json', rows: () => this.goalJson() },
      { format: 'json', path: 'data/goal-account-links.json', rows: () => this.goalAccountLinks() },
      { format: 'json', path: 'data/goal-activities.json', rows: () => this.goalActivities() },
      { format: 'json', path: 'data/goal-transaction-fundings.json', rows: () => this.goalFundings() },
      { format: 'json', path: 'data/loans.json', rows: () => this.loanJson() },
      { format: 'json', path: 'data/loan-adjustments.json', rows: () => this.loanAdjustments() },
      { format: 'json', path: 'data/loan-rate-periods.json', rows: () => this.loanRatePeriods() },
      { format: 'json', path: 'data/loan-repayments.json', rows: () => this.loanRepayments() },
      { format: 'json', path: 'data/manual-assets.json', rows: () => this.manualAssetJson() },
      { format: 'json', path: 'data/manual-asset-valuations.json', rows: () => this.manualAssetValuations() },
      { format: 'json', path: 'data/crypto-wallet-addresses.json', rows: () => this.walletAddressJson() },
      { format: 'json', path: 'data/crypto-wallet-tokens.json', rows: () => this.walletTokens() },
      { format: 'json', path: 'data/portfolios.json', rows: () => this.portfolioJson() },
      { format: 'json', path: 'data/portfolio-transactions.json', rows: () => this.portfolioTransactionJson() },
      { format: 'json', path: 'data/price-overrides.json', rows: () => this.priceOverrides() },
      { format: 'json', path: 'data/exchange-rate-overrides.json', rows: () => this.exchangeRateOverrides() },
      { format: 'json', path: 'data/watchlist.json', rows: () => this.watchlist() },
      { format: 'csv', header: ACCOUNT_CSV_HEADER, path: 'csv/accounts.csv', rows: () => this.accountCsv() },
      { format: 'csv', header: TRANSACTION_CSV_HEADER, path: 'csv/transactions.csv', rows: () => this.transactionCsv() },
      { format: 'csv', header: PORTFOLIO_TRANSACTION_CSV_HEADER, path: 'csv/portfolio-transactions.csv', rows: () => this.portfolioTransactionCsv() },
      { format: 'csv', header: HOLDING_CSV_HEADER, path: 'csv/holdings.csv', rows: () => this.holdingCsv() },
    ];
  }

  manifest(): Omit<ExportManifest, 'files'> {
    return {
      appVersion: buildInfo().version,
      currency: this.currency,
      exportedAt: (this.deps.now?.() ?? new Date()).toISOString(),
      exportedBy: { memberId: this.members.get(this.scope.appuserKey) ?? 1 },
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      household: { id: 1, ownerMemberId: this.members.get(this.ownerAppuserKey) },
      scope: 'member-visible',
    };
  }

  /**
   * SQL: the transaction aliased `alias` is one the member can see: this household's, live, and
   * on no account or on an exported account. `alias` is a code literal, never input.
   */
  private visibleTransaction(alias: string): RawBuilder<unknown> {
    return sql`${sql.ref(`${alias}.tenant_key`)} = ${this.scope.tenantKey} and ${sql.ref(`${alias}.deleted_at`)} is null and (${sql.ref(`${alias}.account_key`)} is null or ${sql.ref(`${alias}.account_key`)} = any(${this.accountKeys}))`;
  }

  // --- small tables ---

  private *accountJson() {
    for (const row of this.accountRows) {
      yield {
        accountNumber: str(row['account_number']),
        balance: dec(row['balance']),
        bankLinked: bool(row['bank_linked']),
        closed: bool(row['closed']),
        createdAt: str(row['created_at']),
        currency: str(row['currency']),
        holderName: str(row['holder_name']),
        id: this.accounts.get(row['account_key']),
        institution: str(row['institution']),
        // A joint account's money is Shared in reports (1.10).
        isJoint: bool(row['is_joint']),
        isPrivate: bool(row['is_private']),
        name: str(row['account_name']),
        openingBalance: dec(row['opening_balance']),
        openingBalanceDate: str(row['opening_balance_date']),
        ownerMemberId: this.members.get(row['account_owner_appuser_key']),
        // The exporting member's place for the account in their list; null when unordered.
        position: this.accountPositions.get(Number(row['account_key'])) ?? null,
        // Who else sees a private account, and whether they may change it. Empty for a shared one.
        shares: bool(row['is_private']) ? (this.accountShares.get(Number(row['account_key'])) ?? []).map(([appuserKey, access]) => ({ access, memberId: this.members.get(appuserKey) })) : [],
        type: str(row['account_type']),
      };
    }
  }

  /** The statement cycle, limit and minimum payment of every exported card account. */
  private *categoryJson() {
    for (const row of this.categoryRows) {
      yield {
        bgColor: str(row['bg_color']),
        countsAsSpending: bool(row['counts_as_spending']),
        icon: str(row['icon']),
        id: this.categories.get(row['category_key']),
        isDefaultBudgetCategory: bool(row['is_default_budget_category']),
        name: str(row['name']),
        parentId: this.categories.get(row['parent_key']),
        recurrency: str(row['recurrency']),
        system: bool(row['is_system_category']),
        textColor: str(row['text_color']),
      };
    }
  }

  private async* categorySettings() {
    const rows = await rowsOf(this.db, sql`
      select category_key, counts_as_spending from tenant_category_setting
      where tenant_key = ${this.scope.tenantKey} and deleted_at is null order by tenant_category_setting_key`);
    for (const row of rows) {
      const categoryId = this.categories.get(row['category_key']);
      if (categoryId !== null) yield { categoryId, countsAsSpending: bool(row['counts_as_spending']) };
    }
  }

  private async* creditCards() {
    const rows = await rowsOf(this.db, sql`
      select account_key, statement_close_day, payment_due_day, credit_limit::text as credit_limit, minimum_payment_percent::text as minimum_payment_percent
      from credit_card_detail where tenant_key = ${this.scope.tenantKey} and deleted_at is null and account_key = any(${this.accountKeys}) order by account_key`);
    for (const row of rows) {
      yield {
        accountId: this.accounts.get(row['account_key']),
        creditLimit: dec(row['credit_limit']),
        minimumPaymentPercent: dec(row['minimum_payment_percent']),
        paymentDueDay: int(row['payment_due_day']),
        statementCloseDay: int(row['statement_close_day']),
      };
    }
  }

  private *memberJson() {
    for (const row of this.memberRows) {
      const self = Number(row['appuser_key']) === this.scope.appuserKey;
      // The other member appears by first name and role only: enough to say who did what.
      yield {
        email: self ? str(row['email_address']) : null,
        firstName: str(row['first_name']),
        id: this.members.get(row['appuser_key']),
        isExporter: self,
        lastName: self ? str(row['last_name']) : null,
        role: str(row['role']),
      };
    }
  }

  private async* merchantCategories() {
    const rows = await rowsOf(this.db, sql`
      select transaction_merchant_key, category_key, source from appuser_merchant_category
      where appuser_key = ${this.scope.appuserKey} and deleted_at is null order by appuser_merchant_category_key`);
    for (const row of rows) {
      const merchantId = this.merchants.get(row['transaction_merchant_key']);
      const categoryId = this.categories.get(row['category_key']);
      if (merchantId !== null && categoryId !== null) yield { categoryId, memberId: this.members.get(this.scope.appuserKey), merchantId, source: str(row['source']) };
    }
  }

  private *merchantJson() {
    for (const row of this.merchantRows) yield { global: bool(row['global']), id: this.merchants.get(row['transaction_merchant_key']), logoUrl: str(row['logo_url']), name: str(row['name']), website: str(row['website']) };
  }

  private async* preferences() {
    const [user] = await rowsOf(this.db, sql`
      select au.language, c.code as currency, ${sql.raw(tsx('au.onboarding_completed_at'))} as onboarding_completed_at, ${sql.raw(tsx('au.marketing_opt_in'))} as marketing_opt_in, ${sql.raw(tsx('au.marketing_opt_out'))} as marketing_opt_out,
        enp.weekly_insights_enabled, enp.monthly_story_enabled, enp.budget_alerts_enabled, enp.growth_emails_enabled, enp.account_recovery_enabled, enp.bank_sync_alerts_enabled,
        enp.credit_card_due_reminders_enabled
      from appuser au
      left join currency c on c.currency_key = au.currency_key
      left join email_notification_preference enp on enp.appuser_key = au.appuser_key and enp.deleted_at is null
      where au.appuser_key = ${this.scope.appuserKey}`);
    if (!user) return;
    const flag = (value: unknown) => (value === null || value === undefined ? null : bool(value));
    yield {
      currency: str(user['currency']),
      emailNotifications: {
        accountRecovery: flag(user['account_recovery_enabled']),
        bankSyncAlerts: flag(user['bank_sync_alerts_enabled']),
        budgetAlerts: flag(user['budget_alerts_enabled']),
        creditCardDueReminders: flag(user['credit_card_due_reminders_enabled']),
        growthEmails: flag(user['growth_emails_enabled']),
        monthlyStory: flag(user['monthly_story_enabled']),
        weeklyInsights: flag(user['weekly_insights_enabled']),
      },
      language: str(user['language']),
      marketingOptIn: str(user['marketing_opt_in']),
      marketingOptOut: str(user['marketing_opt_out']),
      memberId: this.members.get(this.scope.appuserKey),
      onboardingCompletedAt: str(user['onboarding_completed_at']),
    };
  }

  private async* tagJson() {
    const rows = await rowsOf(this.db, sql`select tag_key, name, color, created_by_appuser_key from tag where tenant_key = ${this.scope.tenantKey} and deleted_at is null order by tag_key`);
    for (const row of rows) yield { color: str(row['color']), createdByMemberId: this.members.get(row['created_by_appuser_key']), id: this.tags.get(row['tag_key']), name: str(row['name']) };
  }

  // --- transactions and what hangs off them ---

  private async* transactionCategories() {
    const rows = paged(this.db, (after) => sql`
      select atc.appuser_transaction_category_key as k, atc.transaction_key, atc.appuser_key, atc.category_key, atc.source
      from appuser_transaction_category atc join "transaction" t on t.transaction_key = atc.transaction_key
      where atc.deleted_at is null and ${this.visibleTransaction('t')} ${limit(after, 'atc.appuser_transaction_category_key')}`);
    for await (const row of rows) {
      const categoryId = this.categories.get(row['category_key']);
      if (categoryId === null) continue;
      yield { categoryId, memberId: this.members.get(row['appuser_key']), source: str(row['source']), transactionId: this.transactions.get(row['transaction_key']) };
    }
  }

  private async* transactionJson() {
    for await (const row of this.transactionRows()) {
      yield {
        accountId: this.accounts.get(row['account_key']),
        // "Spent by" (1.10): the member the row is attributed to, or Shared; neither follows the account.
        // Someone no longer in the household is not in `members.json` and reads as none.
        attributedMemberId: this.members.get(row['attributed_appuser_key']),
        attributedToShared: bool(row['attributed_to_shared']),
        balance: dec(row['balance']),
        bankSynced: bool(row['bank_synced']),
        createdAt: str(row['created_at']),
        date: str(row['transaction_date']),
        description: str(row['description']),
        descriptionEditedByUser: bool(row['description_edited_by_user']),
        descriptionRaw: str(row['description_dirty']),
        editedSettlementAmount: dec(row['edited_settlement_amount']),
        hidden: bool(row['hidden']),
        id: this.transactions.get(row['k']),
        // The plan installment this posted row pays, set together; both null on every other row.
        installmentNumber: this.plans.has(row['installment_plan_key']) ? int(row['installment_number']) : null,
        installmentPlanId: this.plans.get(row['installment_plan_key']),
        // The plan a member unlinked this row from by hand, which the automatic linker leaves alone.
        installmentUnlinkedPlanId: this.plans.get(row['installment_unlinked_plan_key']),
        memberId: this.members.get(row['appuser_key']),
        merchantEditedByUser: bool(row['merchant_edited_by_user']),
        merchantId: this.merchants.get(row['transaction_merchant_key']),
        notes: str(row['notes']),
        originalAmount: dec(row['original_amount']),
        originalCurrency: str(row['original_currency']),
        reviewed: bool(row['reviewed']),
        settlementAmount: dec(row['settlement_amount']),
        settlementCurrency: str(row['settlement_currency']),
        settlementExchangeRate: dec(row['settlement_exchange_rate']),
        statementDateOverride: str(row['statement_date_override']),
        status: str(row['status']),
        // Only references the member can see: a counterpart on a hidden account reads as none.
        transferCounterpartId: this.transactions.get(row['transfer_counterpart_key']),
        transferDestinationAccountId: this.accounts.get(row['transfer_destination_account_key']),
        transferDestinationGoalId: this.goals.get(row['transfer_destination_goal_key']),
        transferDestinationPortfolioId: this.portfolios.get(row['transfer_destination_portfolio_key']),
        transferExchangeRate: this.transactions.has(row['transfer_counterpart_key']) ? dec(row['transfer_exchange_rate']) : null,
        type: str(row['type']),
        uneditedSettlementAmount: dec(row['unedited_settlement_amount']),
        userAmount: dec(row['appuser_settlement_amount']),
        userCurrency: str(row['appuser_currency']),
        userExchangeRate: dec(row['appuser_currency_exchange_rate']),
      };
    }
  }

  private transactionRows(): AsyncGenerator<Row> {
    return paged(this.db, (after) => sql`
      select t.transaction_key as k, t.account_key, t.appuser_key, ${sql.raw(tsx('t.transaction_date'))} as transaction_date, t.description, t.description_dirty, t.notes,
        t.transaction_merchant_key, tt.name as type, st.name as status,
        t.original_amount::text as original_amount, oc.code as original_currency,
        t.settlement_amount::text as settlement_amount, sc.code as settlement_currency, t.settlement_exchange_rate::text as settlement_exchange_rate,
        t.edited_settlement_amount::text as edited_settlement_amount, t.unedited_settlement_amount::text as unedited_settlement_amount,
        t.appuser_settlement_amount::text as appuser_settlement_amount, ac.code as appuser_currency, t.appuser_currency_exchange_rate::text as appuser_currency_exchange_rate,
        t.balance::text as balance, t.hidden, t.reviewed, t.description_edited_by_user, t.merchant_edited_by_user, t.attributed_appuser_key, t.attributed_to_shared,
        t.transfer_counterpart_key, t.transfer_destination_account_key, t.transfer_destination_goal_key, t.transfer_destination_portfolio_key,
        t.transfer_exchange_rate::text as transfer_exchange_rate, t.installment_plan_key, t.installment_number, t.installment_unlinked_plan_key, ${sql.raw(dx('t.statement_date_override'))} as statement_date_override,
        (t.enable_banking_transaction_id is not null or t.nordigen_internal_transaction_id is not null) as bank_synced,
        ${sql.raw(tsx('t.created_at'))} as created_at
      from "transaction" t
      left join transaction_type tt on tt.transaction_type_key = t.transaction_type_key
      left join transaction_status st on st.transaction_status_key = t.transaction_status_key
      left join currency oc on oc.currency_key = t.original_currency_key
      left join currency sc on sc.currency_key = t.settlement_currency_key
      left join currency ac on ac.currency_key = t.appuser_currency_key
      where ${this.visibleTransaction('t')} ${limit(after, 't.transaction_key')}`);
  }

  private async* transactionSplits() {
    const rows = paged(this.db, (after) => sql`
      select s.transaction_split_key as k, s.transaction_key, s.category_key, s.amount::text as amount, s.notes, s.position
      from transaction_split s join "transaction" t on t.transaction_key = s.transaction_key
      where s.deleted_at is null and s.tenant_key = ${this.scope.tenantKey} and ${this.visibleTransaction('t')} ${limit(after, 's.transaction_split_key')}`);
    let id = 0;
    for await (const row of rows) {
      id += 1;
      yield { amount: dec(row['amount']), categoryId: this.categories.get(row['category_key']), id, notes: str(row['notes']), position: int(row['position']), transactionId: this.transactions.get(row['transaction_key']) };
    }
  }

  /** Live links whose two sides are both in the export (a link to a row left out is left out too). */
  private async* transactionReimbursements() {
    const rows = paged(this.db, (after) => sql`
      select r.transaction_reimbursement_key as k, r.expense_transaction_key, r.reimbursement_transaction_key, r.amount::text as amount,
        ${sql.raw(tsx('r.created_at'))} as created_at
      from transaction_reimbursement r
      join "transaction" e on e.transaction_key = r.expense_transaction_key
      join "transaction" t on t.transaction_key = r.reimbursement_transaction_key
      where r.deleted_at is null and r.tenant_key = ${this.scope.tenantKey} and ${this.visibleTransaction('e')} and ${this.visibleTransaction('t')} ${limit(after, 'r.transaction_reimbursement_key')}`);
    let id = 0;
    for await (const row of rows) {
      id += 1;
      yield { amount: dec(row['amount']), createdAt: str(row['created_at']), expenseTransactionId: this.transactions.get(row['expense_transaction_key']), id, reimbursementTransactionId: this.transactions.get(row['reimbursement_transaction_key']) };
    }
  }

  private async* transactionTags() {
    const rows = paged(this.db, (after) => sql`
      select tt.transaction_tag_key as k, tt.transaction_key, tt.tag_key
      from transaction_tag tt join "transaction" t on t.transaction_key = tt.transaction_key
      where tt.deleted_at is null and tt.tenant_key = ${this.scope.tenantKey} and ${this.visibleTransaction('t')} ${limit(after, 'tt.transaction_tag_key')}`);
    for await (const row of rows) {
      const tagId = this.tags.get(row['tag_key']);
      if (tagId !== null) yield { tagId, transactionId: this.transactions.get(row['transaction_key']) };
    }
  }

  // --- installment plans and templates ---

  /** Purchases paid in installments on an exported card. */
  private async* installmentPlans() {
    const rows = await rowsOf(this.db, sql`
      select installment_plan_key, account_key, category_key, created_by_appuser_key, description, installment_count,
        ${sql.raw(dx('purchase_date'))} as purchase_date, total_amount::text as total_amount, ${sql.raw(tsx('created_at'))} as created_at
      from installment_plan where installment_plan_key = any(${this.plans.keys()}) order by installment_plan_key`);
    for (const row of rows) {
      yield {
        accountId: this.accounts.get(row['account_key']),
        categoryId: this.categories.get(row['category_key']),
        createdAt: str(row['created_at']),
        createdByMemberId: this.members.get(row['created_by_appuser_key']),
        description: str(row['description']),
        id: this.plans.get(row['installment_plan_key']),
        installmentCount: int(row['installment_count']),
        purchaseDate: str(row['purchase_date']),
        totalAmount: dec(row['total_amount']),
      };
    }
  }

  /** Each plan's schedule: the day and amount of every installment, and the statement it falls in. */
  private async* installments() {
    const rows = await rowsOf(this.db, sql`
      select installment_plan_key, installment_number, amount::text as amount, ${sql.raw(dx('scheduled_date'))} as scheduled_date,
        ${sql.raw(dx('statement_date'))} as statement_date, ${sql.raw(dx('due_date'))} as due_date
      from installment where tenant_key = ${this.scope.tenantKey} and deleted_at is null and installment_plan_key = any(${this.plans.keys()})
      order by installment_plan_key, installment_number`);
    for (const row of rows) {
      yield {
        amount: dec(row['amount']),
        dueDate: str(row['due_date']),
        installmentNumber: int(row['installment_number']),
        planId: this.plans.get(row['installment_plan_key']),
        scheduledDate: str(row['scheduled_date']),
        statementDate: str(row['statement_date']),
      };
    }
  }

  /** The member's own saved entries; a reference the export does not hold reads as none. */
  private async* transactionTemplates() {
    const rows = await rowsOf(this.db, sql`
      select account_key, amount::text as amount, category_key, description, direction, name, notes, position, transaction_merchant_key
      from transaction_template where tenant_key = ${this.scope.tenantKey} and owner_appuser_key = ${this.scope.appuserKey} and deleted_at is null
      order by position, transaction_template_key`);
    let id = 0;
    for (const row of rows) {
      id += 1;
      yield {
        accountId: this.accounts.get(row['account_key']),
        amount: dec(row['amount']),
        categoryId: this.categories.get(row['category_key']),
        description: str(row['description']),
        direction: str(row['direction']),
        id,
        memberId: this.members.get(this.scope.appuserKey),
        merchantId: this.merchants.get(row['transaction_merchant_key']),
        name: str(row['name']),
        notes: str(row['notes']),
        position: int(row['position']),
      };
    }
  }

  // --- rules ---

  private ruleRowsCache: null | Row[] = null;

  private async ruleRows(): Promise<Row[]> {
    this.ruleRowsCache ??= await rowsOf(this.db, sql`
      select rule_key, name, position, active, match, stop_processing, version, conditions, actions, owner_appuser_key
      from rule where tenant_key = ${this.scope.tenantKey} and deleted_at is null order by position, rule_key`);
    return this.ruleRowsCache;
  }

  /** Merchants named by a rule's `set_merchant` action, so the rule's reference resolves in the export. */
  private ruleAction(action: Row): Row {
    switch (action['type']) {
      case 'add_tags':
        return { ...action, tagIds: numberList(action['tagIds']).map((key) => this.tags.get(key)).filter((value) => value !== null) };
      case 'set_category':
        return { ...action, categoryId: this.categories.get(action['categoryId']) };
      case 'set_merchant':
        return action['merchantId'] === undefined ? action : { ...action, merchantId: this.merchants.get(action['merchantId']) };
      default:
        return action;
    }
  }

  private ruleCondition(condition: Row): Row {
    if (condition['field'] === 'account') return { ...condition, values: numberList(condition['values']).map((key) => this.accounts.get(key)) };
    if (condition['field'] === 'category') {
      const values = Array.isArray(condition['values']) ? (condition['values']) : [];
      return { ...condition, values: values.map((value) => (typeof value === 'number' ? this.categories.get(value) : value)).filter((value) => value !== null) };
    }
    return condition;
  }

  private async ruleMerchantKeys(): Promise<number[]> {
    const keys: number[] = [];
    for (const row of await this.ruleRows()) {
      for (const action of jsonArray(row['actions'])) {
        if (action['type'] === 'set_merchant' && typeof action['merchantId'] === 'number') keys.push(action['merchantId']);
      }
    }
    return keys;
  }

  private async* rules() {
    let id = 0;
    for (const row of await this.ruleRows()) {
      const conditions = jsonArray(row['conditions']);
      // A rule that names the other member's private account acts on their private transactions:
      // leave it out rather than widen it by dropping the condition.
      const namesHiddenAccount = conditions.some((condition) => condition['field'] === 'account' && numberList(condition['values']).some((key) => !this.accounts.has(key)));
      if (namesHiddenAccount) continue;
      id += 1;
      yield {
        actions: jsonArray(row['actions']).map((action) => this.ruleAction(action)),
        active: bool(row['active']),
        conditions: conditions.map((condition) => this.ruleCondition(condition)),
        id,
        match: str(row['match']),
        name: str(row['name']),
        ownerMemberId: this.members.get(row['owner_appuser_key']),
        position: int(row['position']),
        stopProcessing: bool(row['stop_processing']),
        version: int(row['version']),
      };
    }
  }

  // --- recurring ---

  private async* recurringOccurrences() {
    const rows = paged(this.db, (after) => sql`
      select ro.recurring_occurrence_key as k, ro.recurring_series_key, ro.transaction_key, ${sql.raw(tsx('ro.occurrence_date'))} as occurrence_date,
        ro.amount::text as amount, c.code as currency, ro.match_status
      from recurring_occurrence ro left join currency c on c.currency_key = ro.currency_key
      where ro.deleted_at is null and ro.recurring_series_key = any(${this.series.keys()}) ${limit(after, 'ro.recurring_occurrence_key')}`);
    for await (const row of rows) {
      yield { amount: dec(row['amount']), currency: str(row['currency']), date: str(row['occurrence_date']), matchStatus: str(row['match_status']), seriesId: this.series.get(row['recurring_series_key']), transactionId: this.transactions.get(row['transaction_key']) };
    }
  }

  private async* recurringSeries() {
    const rows = await rowsOf(this.db, sql`
      select rs.recurring_series_key, rs.account_key, rs.appuser_key, rs.category_key, rs.display_name, rs.merchant_display_name, rs.normalized_merchant_key,
        rs.type, rs.status, rs.source, rs.cadence, rs.amount_type, c.code as currency,
        rs.expected_amount::text as expected_amount, rs.expected_amount_min::text as expected_amount_min, rs.expected_amount_max::text as expected_amount_max,
        rs.average_amount::text as average_amount, rs.last_amount::text as last_amount, rs.occurrence_count,
        ${sql.raw(tsx('rs.first_seen_at'))} as first_seen_at, ${sql.raw(tsx('rs.last_seen_at'))} as last_seen_at, ${sql.raw(tsx('rs.next_expected_at'))} as next_expected_at
      from recurring_series rs left join currency c on c.currency_key = rs.currency_key
      where rs.recurring_series_key = any(${this.series.keys()}) order by rs.recurring_series_key`);
    for (const row of rows) {
      yield {
        accountId: this.accounts.get(row['account_key']),
        amountType: str(row['amount_type']),
        averageAmount: dec(row['average_amount']),
        cadence: str(row['cadence']),
        categoryId: this.categories.get(row['category_key']),
        currency: str(row['currency']),
        displayName: str(row['display_name']),
        expectedAmount: dec(row['expected_amount']),
        expectedAmountMax: dec(row['expected_amount_max']),
        expectedAmountMin: dec(row['expected_amount_min']),
        firstSeenAt: str(row['first_seen_at']),
        id: this.series.get(row['recurring_series_key']),
        lastAmount: dec(row['last_amount']),
        lastSeenAt: str(row['last_seen_at']),
        memberId: this.members.get(row['appuser_key']),
        merchantDisplayName: str(row['merchant_display_name']),
        merchantKey: str(row['normalized_merchant_key']),
        nextExpectedAt: str(row['next_expected_at']),
        occurrenceCount: int(row['occurrence_count']),
        source: str(row['source']),
        status: str(row['status']),
        type: str(row['type']),
      };
    }
  }

  // --- budgets ---

  private async* budgetCategories() {
    const rows = paged(this.db, (after) => sql`
      select btc.budget_template_category_key as k, btc.budget_key, btc.category_key, btc.year, btc.month, btc.amount_budgeted::text as amount_budgeted, btc.recurrency, btc.rollover_enabled,
        coalesce((select array_agg(l.account_account_key order by l.account_account_key) from budget_template_category_accounts l
          where l.budget_template_category_budget_template_category_key = btc.budget_template_category_key), '{}') as account_keys
      from budget_template_category btc
      where btc.budget_key = any(${this.budgets.keys()}) ${limit(after, 'btc.budget_template_category_key')}`);
    for await (const row of rows) {
      const categoryId = this.categories.get(row['category_key']);
      if (categoryId === null) continue;
      yield {
        // Only the member's visible accounts: a line limited to the other member's private account keeps its amount but not the account.
        accountIds: numberList(row['account_keys']).map((key) => this.accounts.get(key)).filter((value) => value !== null),
        amount: dec(row['amount_budgeted']),
        budgetId: this.budgets.get(row['budget_key']),
        categoryId,
        month: int(row['month']),
        recurrency: str(row['recurrency']),
        rolloverEnabled: bool(row['rollover_enabled']),
        year: int(row['year']),
      };
    }
  }

  private async* budgetIncomes() {
    const rows = await rowsOf(this.db, sql`
      select budget_key, name, amount::text as amount, recurrency from budget_template_income
      where budget_key = any(${this.budgets.keys()}) order by budget_template_income_key`);
    for (const row of rows) yield { amount: dec(row['amount']), budgetId: this.budgets.get(row['budget_key']), name: str(row['name']), recurrency: str(row['recurrency']) };
  }

  private async* budgetJson() {
    const rows = await rowsOf(this.db, sql`
      select b.budget_key, b.name, b.description, b.num_adults, b.num_dependents, b.period_start_day, b.rollover_carries_overspend, b.appuser_key, c.code as currency
      from budget b left join currency c on c.currency_key = b.currency_key
      where b.budget_key = any(${this.budgets.keys()}) order by b.budget_key`);
    for (const row of rows) {
      yield { currency: str(row['currency']), description: str(row['description']), id: this.budgets.get(row['budget_key']), memberId: this.members.get(row['appuser_key']), name: str(row['name']), numAdults: int(row['num_adults']), numDependents: int(row['num_dependents']), periodStartDay: int(row['period_start_day']), rolloverCarriesOverspend: bool(row['rollover_carries_overspend']) };
    }
  }

  // --- goals ---

  private async* goalAccountLinks() {
    const rows = await rowsOf(this.db, sql`
      select goal_key, account_key from goal_account_link
      where tenant_key = ${this.scope.tenantKey} and deleted_at is null and goal_key = any(${this.goals.keys()}) order by goal_account_link_key`);
    for (const row of rows) {
      const accountId = this.accounts.get(row['account_key']);
      if (accountId !== null) yield { accountId, goalId: this.goals.get(row['goal_key']) };
    }
  }

  private async* goalActivities() {
    const rows = paged(this.db, (after) => sql`
      select ga.goal_activity_key as k, ga.goal_key, ga.type, ga.amount::text as amount, c.code as currency, ${sql.raw(tsx('ga.occurred_at'))} as occurred_at, ga.note,
        ga.category_key, ga.transaction_key, ga.appuser_key, ga.created_by_appuser_key, ga.source_type, ga.destination_type
      from goal_activity ga left join currency c on c.currency_key = ga.currency_key
      where ga.tenant_key = ${this.scope.tenantKey} and ga.deleted_at is null and ga.goal_key = any(${this.goals.keys()}) ${limit(after, 'ga.goal_activity_key')}`);
    for await (const row of rows) {
      yield {
        amount: dec(row['amount']),
        categoryId: this.categories.get(row['category_key']),
        createdByMemberId: this.members.get(row['created_by_appuser_key']),
        currency: str(row['currency']),
        destinationType: str(row['destination_type']),
        goalId: this.goals.get(row['goal_key']),
        memberId: this.members.get(row['appuser_key']),
        note: str(row['note']),
        occurredAt: str(row['occurred_at']),
        sourceType: str(row['source_type']),
        // The amount is household-wide goal money; the transaction behind it only when visible.
        transactionId: this.transactions.get(row['transaction_key']),
        type: str(row['type']),
      };
    }
  }

  private async* goalFundings() {
    const rows = paged(this.db, (after) => sql`
      select f.goal_transaction_funding_key as k, f.goal_key, f.transaction_key, f.amount::text as amount, c.code as currency, f.funding_type, ${sql.raw(tsx('f.reversed_at'))} as reversed_at
      from goal_transaction_funding f join "transaction" t on t.transaction_key = f.transaction_key left join currency c on c.currency_key = f.currency_key
      where f.tenant_key = ${this.scope.tenantKey} and f.deleted_at is null and f.goal_key = any(${this.goals.keys()}) and ${this.visibleTransaction('t')} ${limit(after, 'f.goal_transaction_funding_key')}`);
    for await (const row of rows) {
      yield { amount: dec(row['amount']), currency: str(row['currency']), fundingType: str(row['funding_type']), goalId: this.goals.get(row['goal_key']), reversedAt: str(row['reversed_at']), transactionId: this.transactions.get(row['transaction_key']) };
    }
  }

  private async* goalJson() {
    const rows = await rowsOf(this.db, sql`
      select g.goal_key, g.name, g.description, g.icon, g.type, g.status, g.priority, g.target_amount::text as target_amount, ${sql.raw(tsx('g.target_date'))} as target_date,
        g.current_balance::text as current_balance, g.monthly_contribution_target::text as monthly_contribution_target, g.minimum_payment::text as minimum_payment,
        g.extra_payment::text as extra_payment, g.annual_interest_rate_bps, ${sql.raw(tsx('g.completed_at'))} as completed_at, ${sql.raw(tsx('g.archived_at'))} as archived_at,
        g.loan_key, g.appuser_key, c.code as currency, ${sql.raw(tsx('g.created_at'))} as created_at
      from goal g left join currency c on c.currency_key = g.currency_key
      where g.goal_key = any(${this.goals.keys()}) order by g.goal_key`);
    for (const row of rows) {
      yield {
        annualInterestRateBps: int(row['annual_interest_rate_bps']),
        archivedAt: str(row['archived_at']),
        completedAt: str(row['completed_at']),
        createdAt: str(row['created_at']),
        currency: str(row['currency']),
        currentBalance: dec(row['current_balance']),
        description: str(row['description']),
        extraPayment: dec(row['extra_payment']),
        icon: str(row['icon']),
        id: this.goals.get(row['goal_key']),
        loanId: this.loans.get(row['loan_key']),
        memberId: this.members.get(row['appuser_key']),
        minimumPayment: dec(row['minimum_payment']),
        monthlyContributionTarget: dec(row['monthly_contribution_target']),
        name: str(row['name']),
        priority: int(row['priority']),
        status: str(row['status']),
        targetAmount: dec(row['target_amount']),
        targetDate: str(row['target_date']),
        type: str(row['type']),
      };
    }
  }

  // --- loans ---

  private async* loanAdjustments() {
    const rows = await rowsOf(this.db, sql`
      select loan_key, type, amount::text as amount, ${sql.raw(dx('effective_date'))} as effective_date, reason from loan_adjustment
      where deleted_at is null and loan_key = any(${this.loans.keys()}) order by loan_adjustment_key`);
    for (const row of rows) yield { amount: dec(row['amount']), effectiveDate: str(row['effective_date']), loanId: this.loans.get(row['loan_key']), reason: str(row['reason']), type: str(row['type']) };
  }

  private async* loanJson() {
    const rows = await rowsOf(this.db, sql`
      select l.loan_key, l.name, l.type, l.status, l.rate_type, l.payment_frequency, l.provider_name, l.notes, l.include_in_net_worth,
        l.opening_principal_balance::text as opening_principal_balance, ${sql.raw(dx('l.opening_balance_date'))} as opening_balance_date,
        l.original_principal::text as original_principal, l.annual_interest_rate_bps, l.regular_payment_amount::text as regular_payment_amount,
        l.payment_day_of_month, l.term_months, ${sql.raw(dx('l.maturity_date'))} as maturity_date, l.secured_asset_key, c.code as currency,
        l.amortization_method, ${sql.raw(dx('l.first_payment_date'))} as first_payment_date
      from loan l left join currency c on c.currency_key = l.currency_key
      where l.loan_key = any(${this.loans.keys()}) order by l.loan_key`);
    for (const row of rows) {
      yield {
        amortizationMethod: str(row['amortization_method']),
        annualInterestRateBps: int(row['annual_interest_rate_bps']),
        currency: str(row['currency']),
        firstPaymentDate: str(row['first_payment_date']),
        id: this.loans.get(row['loan_key']),
        includeInNetWorth: bool(row['include_in_net_worth']),
        maturityDate: str(row['maturity_date']),
        name: str(row['name']),
        notes: str(row['notes']),
        openingBalanceDate: str(row['opening_balance_date']),
        openingPrincipalBalance: dec(row['opening_principal_balance']),
        originalPrincipal: dec(row['original_principal']),
        ownerMemberId: this.members.get(this.scope.appuserKey),
        paymentDayOfMonth: int(row['payment_day_of_month']),
        paymentFrequency: str(row['payment_frequency']),
        providerName: str(row['provider_name']),
        rateType: str(row['rate_type']),
        regularPaymentAmount: dec(row['regular_payment_amount']),
        // Null when the asset is not in this export (the other member's private one).
        securedAssetId: this.manualAssets.get(row['secured_asset_key']),
        status: str(row['status']),
        termMonths: int(row['term_months']),
        type: str(row['type']),
      };
    }
  }

  private async* loanRatePeriods() {
    const rows = await rowsOf(this.db, sql`
      select loan_key, ${sql.raw(dx('effective_date'))} as effective_date, annual_interest_rate_bps from loan_rate_period
      where deleted_at is null and loan_key = any(${this.loans.keys()}) order by loan_key, effective_date`);
    for (const row of rows) yield { annualInterestRateBps: int(row['annual_interest_rate_bps']), effectiveDate: str(row['effective_date']), loanId: this.loans.get(row['loan_key']) };
  }

  private async* loanRepayments() {
    const rows = await rowsOf(this.db, sql`
      select r.loan_key, r.transaction_key, ${sql.raw(dx('r.payment_date'))} as payment_date, r.total_payment_amount::text as total_payment_amount,
        r.principal_amount::text as principal_amount, r.interest_amount::text as interest_amount, r.fee_amount::text as fee_amount,
        r.allocation_source, r.needs_review, r.notes
      from loan_repayment_link r join "transaction" t on t.transaction_key = r.transaction_key
      where r.deleted_at is null and r.loan_key = any(${this.loans.keys()}) and ${this.visibleTransaction('t')} order by r.loan_repayment_link_key`);
    for (const row of rows) {
      yield {
        allocationSource: str(row['allocation_source']),
        feeAmount: dec(row['fee_amount']),
        interestAmount: dec(row['interest_amount']),
        loanId: this.loans.get(row['loan_key']),
        needsReview: bool(row['needs_review']),
        notes: str(row['notes']),
        paymentDate: str(row['payment_date']),
        principalAmount: dec(row['principal_amount']),
        totalPaymentAmount: dec(row['total_payment_amount']),
        transactionId: this.transactions.get(row['transaction_key']),
      };
    }
  }

  // --- manual assets ---

  private async* manualAssetJson() {
    const rows = await rowsOf(this.db, sql`
      select a.manual_asset_key, a.name, a.kind, a.is_private, a.owner_appuser_key, a.notes, ${sql.raw(dx('a.purchase_date'))} as purchase_date,
        a.purchase_price::text as purchase_price, a.growth_annual_rate_percent::text as growth_annual_rate_percent,
        ${sql.raw(dx('a.growth_start_date'))} as growth_start_date, ${sql.raw(tsx('a.archived_at'))} as archived_at,
        ${sql.raw(tsx('a.created_at'))} as created_at, c.code as currency
      from manual_asset a left join currency c on c.currency_key = a.currency_key
      where a.manual_asset_key = any(${this.manualAssets.keys()}) order by a.manual_asset_key`);
    for (const row of rows) {
      yield {
        archivedAt: str(row['archived_at']),
        createdAt: str(row['created_at']),
        currency: str(row['currency']),
        growthAnnualRatePercent: dec(row['growth_annual_rate_percent']),
        growthStartDate: str(row['growth_start_date']),
        id: this.manualAssets.get(row['manual_asset_key']),
        isPrivate: bool(row['is_private']),
        kind: str(row['kind']),
        name: str(row['name']),
        notes: str(row['notes']),
        ownerMemberId: this.members.get(row['owner_appuser_key']),
        purchaseDate: str(row['purchase_date']),
        purchasePrice: dec(row['purchase_price']),
      };
    }
  }

  private async* manualAssetValuations() {
    const rows = await rowsOf(this.db, sql`
      select manual_asset_key, ${sql.raw(dx('valuation_date'))} as valuation_date, value::text as value, note from manual_asset_valuation
      where deleted_at is null and tenant_key = ${this.scope.tenantKey} and manual_asset_key = any(${this.manualAssets.keys()})
      order by manual_asset_key, valuation_date, manual_asset_valuation_key`);
    for (const row of rows) yield { date: str(row['valuation_date']), manualAssetId: this.manualAssets.get(row['manual_asset_key']), note: str(row['note']), value: dec(row['value']) };
  }

  /** A crypto wallet's public addresses (never anything secret: only public values are ever stored). */
  private async* walletAddressJson() {
    const rows = await rowsOf(this.db, sql`
      select crypto_wallet_address_key, manual_asset_key, chain, address_kind, address, label from crypto_wallet_address
      where deleted_at is null and tenant_key = ${this.scope.tenantKey} and manual_asset_key = any(${this.manualAssets.keys()})
      order by crypto_wallet_address_key`);
    for (const row of rows) {
      yield {
        address: str(row['address']),
        chain: str(row['chain']),
        id: this.walletAddresses.add(row['crypto_wallet_address_key']),
        kind: str(row['address_kind']),
        label: str(row['label']),
        manualAssetId: this.manualAssets.get(row['manual_asset_key']),
      };
    }
  }

  /** The coins and tokens each address held at its last sync, and whether they count. */
  private async* walletTokens() {
    const rows = await rowsOf(this.db, sql`
      select crypto_wallet_address_key, token_ref, symbol, name, decimals, raw_balance::text as raw_balance, tracked from crypto_wallet_token
      where deleted_at is null and tenant_key = ${this.scope.tenantKey} and crypto_wallet_address_key = any(${this.walletAddresses.keys()})
      order by crypto_wallet_address_key, crypto_wallet_token_key`);
    for (const row of rows) {
      yield {
        addressId: this.walletAddresses.get(row['crypto_wallet_address_key']),
        balance: str(row['raw_balance']),
        contractAddress: row['token_ref'] === 'native' ? null : str(row['token_ref']),
        decimals: Number(row['decimals']),
        name: str(row['name']),
        symbol: str(row['symbol']),
        tracked: bool(row['tracked']),
      };
    }
  }

  // --- portfolios ---

  private *portfolioJson() {
    for (const row of this.portfolioRows) {
      const linkedAccountId = this.accounts.get(row['linked_account_key']);
      yield {
        // The link only when the member can see its account (as `portfolio-account-link.ts` shows it).
        accountBalanceMode: linkedAccountId === null ? null : str(row['account_balance_mode']),
        benchmarkSymbol: str(row['benchmark_symbol']),
        closedAt: str(row['closed_at']),
        costBasisMethod: str(row['cost_basis_method']),
        createdAt: str(row['created_at']),
        currency: str(row['currency']),
        description: str(row['description']),
        excluded: bool(row['excluded']),
        favored: bool(row['favored']),
        id: this.portfolios.get(row['portfolio_key']),
        linkedAccountId,
        name: str(row['name']),
        ownerMemberId: this.members.get(row['portfolio_owner_appuser_key']),
        targetAllocation: row['target_allocation'] ?? null,
      };
    }
  }

  private async* portfolioTransactionJson() {
    let id = 0;
    for await (const row of this.portfolioTransactionRows()) {
      id += 1;
      yield {
        asset: { currency: str(row['asset_currency']), exchange: str(row['exchange']), isin: str(row['isin']), name: str(row['asset_name']), symbol: str(row['symbol']), type: str(row['asset_type']) },
        broker: str(row['broker']),
        date: str(row['transaction_date']),
        feeAmount: dec(row['fee_amount']),
        feeCurrency: str(row['fee_currency']),
        id,
        memberId: this.members.get(row['appuser_key']),
        notes: str(row['notes']),
        originalAmount: dec(row['original_amount']),
        originalCurrency: str(row['original_currency']),
        originalUnitAmount: dec(row['original_unit_amount']),
        portfolioId: this.portfolios.get(row['portfolio_key']),
        quantity: dec(row['quantity']),
        savingsCertificateTaxExempt: row['tax_exempt'] === null || row['tax_exempt'] === undefined ? null : bool(row['tax_exempt']),
        settlementAmount: dec(row['settlement_amount']),
        settlementCurrency: str(row['settlement_currency']),
        settlementExchangeRate: dec(row['settlement_exchange_rate']),
        settlementUnitAmount: dec(row['settlement_unit_amount']),
        type: str(row['type']),
      };
    }
  }

  private portfolioTransactionRows(): AsyncGenerator<Row> {
    return paged(this.db, (after) => sql`
      select ft.transaction_key as k, ft.portfolio_key, ft.appuser_key, ${sql.raw(tsx('ft.transaction_date'))} as transaction_date, ftt.name as type,
        fa.symbol, fa.name as asset_name, fa.isin, fat.name as asset_type, fae.acronym as exchange, ac.code as asset_currency,
        ft.quantity::text as quantity, ft.settlement_unit_amount::text as settlement_unit_amount, ft.settlement_amount::text as settlement_amount, sc.code as settlement_currency,
        ft.settlement_exchange_rate::text as settlement_exchange_rate, ft.original_amount::text as original_amount, ft.original_unit_amount::text as original_unit_amount, oc.code as original_currency,
        ft.fee_amount::text as fee_amount, fc.code as fee_currency, fb.display_name as broker, ft.notes, ca.tax_exempt
      from financial_transaction ft
      left join financial_transaction_type ftt on ftt.financial_transaction_type_key = ft.financial_transaction_type_key
      left join financial_asset fa on fa.financial_asset_key = ft.financial_asset_key
      left join financial_asset_type fat on fat.financial_asset_type_key = fa.financial_asset_type_key
      left join financial_asset_exchange fae on fae.financial_asset_exchange_key = fa.financial_asset_exchange_key
      left join currency ac on ac.currency_key = fa.currency_key
      left join currency sc on sc.currency_key = ft.settlement_currency_key
      left join currency oc on oc.currency_key = ft.original_currency_key
      left join currency fc on fc.currency_key = ft.fee_currency_key
      left join financial_broker fb on fb.financial_broker_key = ft.financial_broker_key
      left join certificado_aforro_subscription_detail ca on ca.transaction_key = ft.transaction_key
      where ft.tenant_key = ${this.scope.tenantKey} and ft.deleted_at is null and ft.portfolio_key = any(${this.portfolios.keys()}) ${limit(after, 'ft.transaction_key')}`);
  }

  /** The household's own prices, per security and day, in the security's currency. */
  private async* priceOverrides() {
    const rows = await rowsOf(this.db, sql`
      select ${sql.raw(utcDay('o.date'))} as date, o.price::text as price, c.code as currency, o.note, o.created_by_appuser_key,
        fa.symbol, fa.name as asset_name, fa.isin, fat.name as asset_type, fae.acronym as exchange, ac.code as asset_currency
      from financial_asset_price_override o
      join financial_asset fa on fa.financial_asset_key = o.financial_asset_key
      left join financial_asset_type fat on fat.financial_asset_type_key = fa.financial_asset_type_key
      left join financial_asset_exchange fae on fae.financial_asset_exchange_key = fa.financial_asset_exchange_key
      left join currency ac on ac.currency_key = fa.currency_key
      left join currency c on c.currency_key = o.currency_key
      where o.tenant_key = ${this.scope.tenantKey} and o.deleted_at is null
      order by o.financial_asset_key, o.date`);
    for (const row of rows) {
      yield {
        asset: { currency: str(row['asset_currency']), exchange: str(row['exchange']), isin: str(row['isin']), name: str(row['asset_name']), symbol: str(row['symbol']), type: str(row['asset_type']) },
        createdByMemberId: this.members.get(row['created_by_appuser_key']),
        currency: str(row['currency']),
        date: str(row['date']),
        note: str(row['note']),
        price: dec(row['price']),
      };
    }
  }

  /** The household's own exchange rates: units of `toCurrency` for one `fromCurrency`, per day. */
  private async* exchangeRateOverrides() {
    const rows = await rowsOf(this.db, sql`
      select ${sql.raw(utcDay('o.date'))} as date, o.rate::text as rate, f.code as from_currency, t.code as to_currency, o.created_by_appuser_key
      from exchange_rate_override o
      join currency f on f.currency_key = o.from_currency_key
      join currency t on t.currency_key = o.to_currency_key
      where o.tenant_key = ${this.scope.tenantKey} and o.deleted_at is null
      order by o.date, f.code, t.code`);
    for (const row of rows) {
      yield { createdByMemberId: this.members.get(row['created_by_appuser_key']), date: str(row['date']), fromCurrency: str(row['from_currency']), rate: dec(row['rate']), toCurrency: str(row['to_currency']) };
    }
  }

  private async* watchlist() {
    const rows = await rowsOf(this.db, sql`
      select symbol from watchlist where tenant_key = ${this.scope.tenantKey} and appuser_key = ${this.scope.appuserKey} and deleted_at is null order by watchlist_key`);
    for (const row of rows) yield { memberId: this.members.get(this.scope.appuserKey), symbol: str(row['symbol']) };
  }

  // --- spreadsheets ---

  private *accountCsv() {
    for (const row of this.accountRows) {
      yield [this.accounts.get(row['account_key']), str(row['account_name']), str(row['account_type']), str(row['institution']), str(row['currency']), dec(row['balance']), dec(row['opening_balance']), dayOf(str(row['opening_balance_date'])), bool(row['closed']) ? 'yes' : 'no', bool(row['is_private']) ? 'yes' : 'no'];
    }
  }

  private async* transactionCsv() {
    const accountNames = new Map(this.accountRows.map((row) => [Number(row['account_key']), str(row['account_name'])]));
    const merchantNames = new Map(this.merchantRows.map((row) => [Number(row['transaction_merchant_key']), str(row['name'])]));
    const categoryNames = new Map(this.categoryRows.map((row) => [Number(row['category_key']), str(row['name'])]));
    let batch: Row[] = [];
    const flush = async function* (this: HouseholdExport) {
      const keys = batch.map((row) => Number(row['k']));
      const labels = await this.transactionLabels(keys, categoryNames);
      for (const row of batch) {
        const key = Number(row['k']);
        yield [
          this.transactions.get(key),
          dayOf(str(row['transaction_date'])),
          accountNames.get(Number(row['account_key'])) ?? null,
          str(row['description']),
          merchantNames.get(Number(row['transaction_merchant_key'])) ?? null,
          labels.categories.get(key) ?? null,
          labels.tags.get(key) ?? null,
          dec(row['settlement_amount']),
          str(row['settlement_currency']),
          dec(row['original_amount']),
          str(row['original_currency']),
          str(row['type']),
          str(row['status']),
          str(row['notes']),
          bool(row['hidden']) ? 'yes' : 'no',
        ];
      }
      batch = [];
    };
    for await (const row of this.transactionRows()) {
      batch.push(row);
      if (batch.length >= BATCH) yield* flush.call(this);
    }
    if (batch.length > 0) yield* flush.call(this);
  }

  /**
   * The category and tags a spreadsheet shows per transaction: the exporting member's category,
   * else the other member's; split lines joined with " | "; tags joined with ", ".
   */
  private async* holdingCsv() {
    const holdings = this.deps.holdings;
    if (!holdings) return;
    for (const row of this.portfolioRows) {
      const portfolioKey = Number(row['portfolio_key']);
      for (const holding of await holdings({ appuserKey: this.scope.appuserKey, portfolioKey, tenantKey: this.scope.tenantKey })) {
        yield [str(row['name']), holding.financialAssetSymbol, holding.financialAssetName, holding.financialAssetType, holding.quantity, holding.averageBuyPrice, holding.currentPrice, holding.currentValue, holding.currency];
      }
    }
  }

  private async* portfolioTransactionCsv() {
    const portfolioNames = new Map(this.portfolioRows.map((row) => [Number(row['portfolio_key']), str(row['name'])]));
    let id = 0;
    for await (const row of this.portfolioTransactionRows()) {
      id += 1;
      yield [id, dayOf(str(row['transaction_date'])), portfolioNames.get(Number(row['portfolio_key'])) ?? null, str(row['type']), str(row['symbol']), str(row['exchange']), str(row['isin']), str(row['asset_name']), dec(row['quantity']), dec(row['settlement_unit_amount']), dec(row['settlement_amount']), str(row['settlement_currency']), dec(row['fee_amount']), str(row['fee_currency']), str(row['broker']), str(row['notes'])];
    }
  }

  private async transactionLabels(keys: number[], categoryNames: Map<number, null | string>) {
    const categories = new Map<number, string>();
    const tags = new Map<number, string>();
    if (keys.length === 0) return { categories, tags };
    const splits = await rowsOf(this.db, sql`
      select transaction_key, category_key from transaction_split
      where deleted_at is null and tenant_key = ${this.scope.tenantKey} and transaction_key = any(${keys}) order by transaction_key, position`);
    const splitNames = new Map<number, string[]>();
    for (const row of splits) {
      const key = Number(row['transaction_key']);
      splitNames.set(key, [...(splitNames.get(key) ?? []), categoryNames.get(Number(row['category_key'])) ?? '']);
    }
    const assigned = await rowsOf(this.db, sql`
      select transaction_key, category_key from appuser_transaction_category
      where deleted_at is null and transaction_key = any(${keys}) order by transaction_key, (appuser_key = ${this.scope.appuserKey}) desc, appuser_transaction_category_key`);
    for (const row of assigned) {
      const key = Number(row['transaction_key']);
      const name = categoryNames.get(Number(row['category_key']));
      if (!categories.has(key) && name) categories.set(key, name);
    }
    for (const [key, names] of splitNames) categories.set(key, names.join(' | '));
    const tagRows = await rowsOf(this.db, sql`
      select tt.transaction_key, tg.name from transaction_tag tt join tag tg on tg.tag_key = tt.tag_key
      where tt.deleted_at is null and tg.deleted_at is null and tt.tenant_key = ${this.scope.tenantKey} and tt.transaction_key = any(${keys}) order by tt.transaction_key, tg.name`);
    for (const row of tagRows) {
      const key = Number(row['transaction_key']);
      tags.set(key, tags.has(key) ? `${tags.get(key)}, ${String(row['name'])}` : String(row['name']));
    }
    return { categories, tags };
  }
}

const ACCOUNT_CSV_HEADER = ['id', 'name', 'type', 'institution', 'currency', 'balance', 'opening_balance', 'opening_balance_date', 'closed', 'private'] as const;
const TRANSACTION_CSV_HEADER = ['id', 'date', 'account', 'description', 'merchant', 'category', 'tags', 'amount', 'currency', 'original_amount', 'original_currency', 'type', 'status', 'notes', 'hidden'] as const;
const PORTFOLIO_TRANSACTION_CSV_HEADER = ['id', 'date', 'portfolio', 'type', 'symbol', 'exchange', 'isin', 'asset', 'quantity', 'unit_price', 'amount', 'currency', 'fee', 'fee_currency', 'broker', 'notes'] as const;
const HOLDING_CSV_HEADER = ['portfolio', 'symbol', 'asset', 'asset_type', 'quantity', 'average_buy_price', 'current_price', 'current_value', 'currency'] as const;

function jsonArray(value: unknown): Row[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is Row => typeof item === 'object' && item !== null) : [];
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((item) => Number.isFinite(item)) : [];
}

/** Write the member's export as a zip to `output`, encrypted with `options.password` when given. Resolves with the manifest once it is fully written. */
export async function writeHouseholdExport(em: EntityManager, scope: ExportScope, output: Writable, deps: HouseholdExportDeps = {}, options: { password?: string } = {}): Promise<ExportManifest> {
  const householdExport = new HouseholdExport(em, scope, deps);
  await householdExport.prepare();
  return writeExportArchive({ files: householdExport.files(), manifest: householdExport.manifest(), ...options }, output);
}
