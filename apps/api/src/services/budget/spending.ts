import { type Expression, type Kysely, sql, type SqlBool } from 'kysely';

import { DI } from '@app/app';
import { anyOf, type SqlDatabase, sqlQuery } from '@app/database/sql';
import { rateScope } from '@service/currency/exchange-rate';
import { completenessFromCounts, loadDailyRates, needsRateSql, type ReportCompleteness, transactionDaySql, type UnconvertedCount } from '@service/reports/report-currency';
import { categoryLinesSql } from '@service/transaction/category-lines';
import { type TransactionScope, transactionScopeExpression } from '@service/transaction/transaction-scope';
import { buildEffectiveSpendingAmountSql } from '@utils/account-amounts';

export interface BudgetSpendingCategory {
  category_amount: number;
  category_bg_color: string;
  category_budgeted_amount: number;
  category_icon: string;
  category_is_system_category: boolean;
  category_key: number;
  category_recurrency: string;
  category_text_color: string;
  child_category_name: null | string;
  parent_category_bg_color: string;
  parent_category_icon: string;
  parent_category_name: string;
  parent_category_text_color: string;
}

export interface BudgetSpendingInput {
  accountKeys: number[];
  /** The budget's currency: what its budgeted amounts are in, and what its spending is shown in. */
  currency: { code: string; currencyKey: number };
  period: 'annual' | 'monthly';
  templateKeys: number[];
  tenantKey: number;
  viewerAppuserKey: number;
}

/** The rate converting one member currency into the budget's currency on one UTC day. */
export interface BudgetDayRate {
  currencyKey: number;
  /** `YYYY-MM-DD`, {@link transactionDaySql}. */
  day: string;
  rate: number;
}

/** The rows to measure, each in its own year and month, without the shape of a budget view. */
export type BudgetRowsInput = Omit<BudgetSpendingInput, 'period'>;

/** One budget row's spending ({@link getBudgetRowSpending}). */
export interface BudgetRowSpending {
  /** False when some of the row's transactions could not be converted and are left out of `spent`. */
  complete: boolean;
  spent: number;
}

export interface BudgetSpending {
  categories: BudgetSpendingCategory[];
  completeness: ReportCompleteness;
}

/**
 * Aggregate category spending for budget readers. Transaction visibility is deliberately
 * attached to the transaction LEFT JOIN: filtering it in WHERE would drop zero-spend categories.
 *
 * Rows are category lines (`category-lines.ts`): a split transaction counts in each of its lines'
 * categories for that line's share, and never twice. A line's amount is its share of the
 * transaction's amount in the account owner's currency. A line in another currency than the
 * budget's is multiplied by the rate of its transaction's day from `rates`; with no rate there it
 * adds nothing (the caller counts it). A loan repayment adds its interest and fees instead, which
 * are in the loan's currency: converted the same way, at the rate of the repayment's day from
 * `rates` for the loan's currency.
 */
export function buildBudgetSpendingQuery(db: Kysely<SqlDatabase>, input: BudgetSpendingInput, rates: BudgetDayRate[]) {
  const { tenantKey } = input;
  const monthlyChildData = buildRowSpendingQuery(db, input, rates, input.period === 'annual');

  const childCategoryAmounts = input.period === 'annual'
    ? db
        .selectFrom('monthly_child_category_data')
        .select([
          'child_category_key', 'child_category_name', 'child_category_icon', 'child_category_text_color',
          'child_category_bg_color', 'child_category_is_system_category', 'parent_category_name',
          sql<number>`SUM(category_amount)`.as('category_amount'),
          sql<number>`SUM(category_budgeted_amount)`.as('category_budgeted_amount'),
          'category_recurrency',
        ])
        .groupBy([
          'child_category_key', 'child_category_name', 'child_category_icon', 'child_category_text_color',
          'child_category_bg_color', 'child_category_is_system_category', 'parent_category_name', 'category_recurrency',
        ])
    : monthlyChildData;

  const parentBudgetAmount = input.period === 'annual'
    ? sql<number>`SUM(COALESCE(child_category_amounts.category_budgeted_amount * CASE child_category_amounts.category_recurrency
        WHEN 'MONTHLY_14' THEN 14 WHEN 'MONTHLY' THEN 12 WHEN 'QUARTERLY' THEN 4
        WHEN 'BI_ANNUALLY' THEN 2 WHEN 'ANNUALLY' THEN 1 ELSE 1 END / 12, 0))`
    : sql<number>`SUM(COALESCE(child_category_amounts.category_budgeted_amount, 0))`;

  const parentCategoryAmounts = db
    .selectFrom('category as parent_category')
    .leftJoin('category as child_category', 'parent_category.category_key', 'child_category.parent_category_category_key')
    .leftJoin('child_category_amounts', 'child_category.category_key', 'child_category_amounts.child_category_key')
    .leftJoin('budget_template_category as bc', 'parent_category.category_key', 'bc.category_key')
    .select([
      'parent_category.category_key as parent_category_key',
      'parent_category.name as parent_category_name',
      'parent_category.icon as parent_category_icon',
      'parent_category.text_color as parent_category_text_color',
      'parent_category.bg_color as parent_category_bg_color',
      'parent_category.is_system_category as parent_category_is_system_category',
      sql<number>`SUM(COALESCE(child_category_amounts.category_amount, 0))`.as('category_amount'),
      parentBudgetAmount.as('category_budgeted_amount'),
    ])
    .where('parent_category.parent_category_category_key', 'is', null)
    .where('parent_category.deleted_at', 'is', null)
    .where('child_category.deleted_at', 'is', null)
    .where((eb) => eb.or([eb('parent_category.tenant_key', '=', tenantKey), eb('parent_category.tenant_key', 'is', null)]))
    .groupBy(['parent_category.category_key', 'parent_category.name']);

  const commonTableExpressions = [
    ...(input.period === 'annual' ? [sql`"monthly_child_category_data" as ${monthlyChildData}`] : []),
    sql`"child_category_amounts" as ${childCategoryAmounts}`,
    sql`"parent_category_amounts" as ${parentCategoryAmounts}`,
  ];

  return sql<BudgetSpendingCategory>`with ${sql.join(commonTableExpressions)}
    select "t"."child_category_name", "t"."parent_category_name", "t"."category_amount", "t"."category_budgeted_amount",
      "t"."category_recurrency",
      COALESCE(t.child_category_icon, t.parent_category_icon) as category_icon,
      COALESCE(t.child_category_text_color, t.parent_category_text_color) as category_text_color,
      COALESCE(t.child_category_bg_color, t.parent_category_bg_color) as category_bg_color,
      COALESCE(t.child_category_is_system_category, t.parent_category_is_system_category) as category_is_system_category,
      COALESCE(t.parent_category_key, t.child_category_key) as category_key
    from (
      select "child_category_name", "parent_category_name", "category_amount", "category_recurrency", "child_category_icon",
        "child_category_text_color", "child_category_bg_color", "child_category_is_system_category",
        null as parent_category_icon, null as parent_category_text_color,
        null as parent_category_bg_color, null as parent_category_is_system_category,
        COALESCE(category_budgeted_amount, 0) as category_budgeted_amount, "child_category_key",
        null as parent_category_key
      from "child_category_amounts"
      union all
      select CAST(null AS text) as child_category_name, "parent_category_name", "category_amount",
        null as category_recurrency, null as child_category_icon,
        null as child_category_text_color, null as child_category_bg_color,
        null as child_category_is_system_category, "parent_category_icon", "parent_category_text_color",
        "parent_category_bg_color", "parent_category_is_system_category",
        COALESCE(category_budgeted_amount, 0) as category_budgeted_amount,
        null as child_category_key, "parent_category_key"
      from "parent_category_amounts"
    ) as "t"
    where "parent_category_name" is not null
    order by "parent_category_name" asc, "child_category_name" desc`;
}

/**
 * Category spending per child category (`perRow` false: one month's rows) or per budget row
 * (`perRow` true: each row's own year and month, keyed by `budget_template_category_key`). Every
 * budget figure (the month, the year, and the months rollover walks) is this one query.
 */
function buildRowSpendingQuery(db: Kysely<SqlDatabase>, input: BudgetRowsInput, rates: BudgetDayRate[], perRow: boolean) {
  const { templateKeys, tenantKey } = input;
  // An integer primary key, inlined into the raw amount expressions.
  const budgetCurrencyKey = input.currency.currencyKey;
  // A line is its share of the transaction's amount in the budget's currency (`categoryLines`): a
  // row settled in that currency reads as its settlement amount, any other one needs its day's rate.
  const rate = `(CASE WHEN ${needsRateSql('transaction', budgetCurrencyKey)} THEN budget_rate.rate ELSE 1 END)`;
  const repaymentRate = `(CASE WHEN loan.currency_key = ${String(budgetCurrencyKey)} THEN 1 ELSE loan_rate.rate END)`;
  // Each category line's share of its transaction (the whole amount for an unsplit one), converted
  // at its transaction's day rate. Only when the transaction joined: the line itself carries an
  // amount even for a transaction the budget must not count (another account, another month,
  // expired, hidden, or one the viewer cannot see).
  const effectiveAmount = sql.raw(`CASE WHEN "transaction"."transaction_key" IS NULL THEN NULL ELSE ${buildEffectiveSpendingAmountSql('category_line', 'loan_repayment_link', rate, repaymentRate)} END`);
  const rateRows = rates.length === 0
    ? sql`select null::int as currency_key, null::text as day, null::numeric as rate where false`
    : sql`select * from (values ${sql.join(rates.map((row) => sql`(${row.currencyKey}::int, ${row.day}::text, ${row.rate}::numeric)`))}) as budget_rate_values(currency_key, day, rate)`;
  const annualColumns = perRow
    ? ['budget_template_category.budget_template_category_key', 'budget_template_category.year', 'budget_template_category.month']
    : [];

  return db
    .selectFrom('budget')
    .innerJoin('budget_template_category', 'budget.budget_key', 'budget_template_category.budget_key')
    .innerJoin('category as child_category', 'budget_template_category.category_key', 'child_category.category_key')
    .leftJoin('category as parent_category', 'child_category.parent_category_category_key', 'parent_category.category_key')
    .leftJoin(categoryLines(input), 'child_category.category_key', 'category_line.category_key')
    .leftJoin('transaction', (join) => join.on(budgetTransactionMatch(input)))
    .leftJoin('loan_repayment_link', (join) =>
      join.onRef('loan_repayment_link.transaction_key', '=', 'transaction.transaction_key').on('loan_repayment_link.deleted_at', 'is', null))
    .leftJoin(sql<{ currency_key: number; day: string; rate: number }>`(${rateRows})`.as('budget_rate'), (join) =>
      join.on(sql<SqlBool>`budget_rate.currency_key = "transaction".appuser_currency_key and budget_rate.day = ${sql.raw(transactionDaySql('"transaction"'))}`))
    .leftJoin('loan', 'loan.loan_key', 'loan_repayment_link.loan_key')
    .leftJoin(sql<{ currency_key: number; day: string; rate: number }>`(${rateRows})`.as('loan_rate'), (join) =>
      join.on(sql<SqlBool>`loan_rate.currency_key = loan.currency_key and loan_rate.day = ${sql.raw(transactionDaySql('"transaction"'))}`))
    .select([
      'child_category.category_key as child_category_key',
      'child_category.name as child_category_name',
      'child_category.icon as child_category_icon',
      'child_category.text_color as child_category_text_color',
      'child_category.bg_color as child_category_bg_color',
      'child_category.is_system_category as child_category_is_system_category',
      'parent_category.name as parent_category_name',
      ...annualColumns,
      // Money out of the category, net of refunds, floored at zero: a refund-only month spent nothing.
      sql<number>`GREATEST(-SUM(COALESCE(${effectiveAmount}, 0)), 0)`.as('category_amount'),
      'budget_template_category.amount_budgeted as category_budgeted_amount',
      'budget_template_category.recurrency as category_recurrency',
    ])
    .where(anyOf('budget_template_category.budget_template_category_key', templateKeys))
    .where('parent_category.name', 'is not', null)
    .where('child_category.deleted_at', 'is', null)
    .where('parent_category.deleted_at', 'is', null)
    .where((eb) => eb.or([eb('child_category.tenant_key', '=', tenantKey), eb('child_category.tenant_key', 'is', null)]))
    .where((eb) => eb.or([eb('parent_category.tenant_key', '=', tenantKey), eb('parent_category.tenant_key', 'is', null)]))
    .groupBy([
      'child_category.category_key',
      'parent_category.name',
      'child_category.name',
      ...annualColumns,
      'budget_template_category.amount_budgeted',
      'budget_template_category.recurrency',
    ]);
}

/** The household's category lines (`category-lines.ts`) as the `category_line` table, in the budget's currency before any rate. */
function categoryLines(input: BudgetRowsInput) {
  return sql<{ appuser_settlement_amount: null | number; category_key: null | number; transaction_key: number }>`${sql.raw(categoryLinesSql(input.tenantKey, { amountInCurrencyKey: input.currency.currencyKey }))}`.as('category_line');
}

/**
 * Which transactions a budget counts (`transaction-scope.ts`): pending ones too (EXPIRED rows never
 * moved money), no hidden row, no transfer between own accounts, and only accounts that are still
 * open. Categories that are not spending are left out line by line (`category_line.counts_as_spending`),
 * so the row-level rule is off here.
 */
export function budgetScope(input: Pick<BudgetRowsInput, 'tenantKey' | 'viewerAppuserKey'>): TransactionScope {
  return { includeHidden: false, includeNonSpending: true, includeTransfers: false, openAccountsOnly: true, statuses: 'not-expired', tenantKey: input.tenantKey, viewerAppuserKey: input.viewerAppuserKey };
}

/**
 * The transactions a budget row counts: in the budget's scope ({@link budgetScope}), with a category
 * line in the row's category that counts as spending, on one of the budget's accounts, in the
 * row's month. Joins `transaction` to `category_line` and `budget_template_category`.
 *
 * The month is of the UTC calendar, stated rather than left to the session's time zone, so a bank
 * booking (stored at UTC midnight of its date, `transaction-date-range.ts`) is in its own month.
 */
function budgetTransactionMatch(input: BudgetRowsInput): Expression<SqlBool> {
  return sql<SqlBool>`"category_line"."transaction_key" = "transaction"."transaction_key"
    and "category_line"."counts_as_spending"
    and ${anyOf('transaction.account_key', input.accountKeys)}
    and date_part('year', "transaction"."transaction_date" at time zone 'UTC') = "budget_template_category"."year"
    and date_part('month', "transaction"."transaction_date" at time zone 'UTC') = "budget_template_category"."month"
    and ${transactionScopeExpression('transaction', budgetScope(input))}`;
}

/**
 * A budget's category spending in the budget's currency, and how complete it is. Partners' rows in
 * another currency are converted at the rate of their day: the rows are first grouped by currency
 * and UTC day (one small query), the rates for those days loaded at once, and the spending query
 * multiplies each row by its day's rate. A loan repayment's interest and fees are in the loan's
 * currency and converted the same way. Rows with no converted amount, or no rate into the budget's
 * currency, are left out of the sums and counted in `completeness`.
 */
export async function getBudgetSpending(input: BudgetSpendingInput): Promise<BudgetSpending> {
  const db = sqlQuery(DI.em);
  const [foreignDays, repaymentDays, missing] = await Promise.all([foreignCurrencyDays(db, input), foreignLoanRepaymentDays(db, input), missingAmountCounts(db, input)]);
  const groups = [...foreignDays, ...repaymentDays];
  const rateFor = await loadDailyRates(DI.em, input.currency.code, groups, rateScope(input.tenantKey));

  // One row per currency and day: the spending query joins on them, so a repeat would double a row.
  const rates = new Map<string, BudgetDayRate>();
  const unconverted: UnconvertedCount[] = [...missing];
  for (const group of groups) {
    const rate = rateFor(group);
    if (rate == null) unconverted.push(group);
    else rates.set(`${group.currencyKey}:${group.day}`, { currencyKey: group.currencyKey, day: group.day, rate });
  }

  const categories = (await buildBudgetSpendingQuery(db, input, [...rates.values()]).execute(db)).rows;
  return { categories, completeness: completenessFromCounts(input.currency.code, unconverted) };
}

/**
 * Each budget row's spending in the budget's currency, from the same query as a budget month
 * ({@link getBudgetSpending}), keyed by `budgetTemplateCategoryKey`. A row is incomplete when one of
 * its transactions has no converted amount, or no rate into the budget's currency (a loan
 * repayment's interest and fees need the loan currency's rate). A row the query does not return
 * (its category was deleted) spent nothing.
 */
export async function getBudgetRowSpending(input: BudgetRowsInput): Promise<Map<number, BudgetRowSpending>> {
  const result = new Map<number, BudgetRowSpending>(input.templateKeys.map((key) => [key, { complete: true, spent: 0 }]));
  if (input.templateKeys.length === 0) return result;
  const db = sqlQuery(DI.em);
  const [foreignDays, repaymentDays, missing] = await Promise.all([foreignCurrencyDays(db, input, true), foreignLoanRepaymentDays(db, input, true), missingAmountCounts(db, input, true)]);
  const groups = [...foreignDays, ...repaymentDays];
  const rateFor = await loadDailyRates(DI.em, input.currency.code, groups, rateScope(input.tenantKey));

  const incomplete = new Set<number>(missing.map((row) => Number(row.templateKey)));
  // One row per currency and day: the spending query joins on them, so a repeat would double a row.
  const rates = new Map<string, BudgetDayRate>();
  for (const group of groups) {
    const rate = rateFor(group);
    if (rate == null) incomplete.add(Number(group.templateKey));
    else rates.set(`${group.currencyKey}:${group.day}`, { currencyKey: group.currencyKey, day: group.day, rate });
  }

  const rows = await buildRowSpendingQuery(db, input, [...rates.values()], true).execute();
  for (const row of rows) {
    // Postgres may send a key or a sum as text, depending on the driver's type parsers.
    const { budget_template_category_key: key, category_amount: spent } = row as unknown as { budget_template_category_key: number | string; category_amount: number | string };
    result.set(Number(key), { complete: true, spent: Number(spent) });
  }
  for (const key of incomplete) {
    const row = result.get(key);
    if (row) row.complete = false;
  }
  return result;
}

/**
 * Matched loan repayments on a loan in another currency than the budget's, counted per loan
 * currency and UTC day of the repayment (and per budget row with `byRow`): their interest and fees
 * need that day's rate.
 */
async function foreignLoanRepaymentDays(db: Kysely<SqlDatabase>, input: BudgetRowsInput, byRow = false) {
  const day = sql<string>`${sql.raw(transactionDaySql('"transaction"'))}`;
  const templateKey = rowKey(byRow);
  const rows = await budgetRows(db, input)
    .innerJoin('loan_repayment_link', (join) =>
      join.onRef('loan_repayment_link.transaction_key', '=', 'transaction.transaction_key').on('loan_repayment_link.deleted_at', 'is', null))
    .innerJoin('loan', 'loan.loan_key', 'loan_repayment_link.loan_key')
    .innerJoin('currency', 'currency.currency_key', 'loan.currency_key')
    .select([templateKey.as('templateKey'), 'loan.currency_key as currencyKey', 'currency.code as currencyCode', day.as('day'), sql<string>`count(distinct transaction.transaction_key)`.as('transactions')])
    .where('loan.currency_key', '!=', input.currency.currencyKey)
    .groupBy([templateKey, 'loan.currency_key', 'currency.code', day])
    .execute();
  return rows.map((row) => ({ currencyCode: row.currencyCode as string, currencyKey: Number(row.currencyKey), day: row.day, templateKey: row.templateKey, transactions: row.transactions }));
}

/** Matched rows that need a rate into the budget's currency, counted per member currency and UTC day (and per budget row with `byRow`). */
async function foreignCurrencyDays(db: Kysely<SqlDatabase>, input: BudgetRowsInput, byRow = false) {
  const day = sql<string>`${sql.raw(transactionDaySql('"transaction"'))}`;
  const templateKey = rowKey(byRow);
  const rows = await matchedTransactions(db, input)
    .innerJoin('currency', 'currency.currency_key', 'transaction.appuser_currency_key')
    .select([templateKey.as('templateKey'), 'transaction.appuser_currency_key as currencyKey', 'currency.code as currencyCode', day.as('day'), sql<string>`count(distinct transaction.transaction_key)`.as('transactions')])
    .where(sql.raw<SqlBool>(needsRateSql('transaction', input.currency.currencyKey)))
    .groupBy([templateKey, 'transaction.appuser_currency_key', 'currency.code', day])
    .execute();
  return rows.map((row) => ({ currencyCode: row.currencyCode as string, currencyKey: Number(row.currencyKey), day: row.day, templateKey: row.templateKey, transactions: row.transactions }));
}

/**
 * Matched rows with no amount in the user's currency (`fxStatus` `missing`), which the sum reads as
 * zero, counted by their settlement currency (and per budget row with `byRow`).
 */
async function missingAmountCounts(db: Kysely<SqlDatabase>, input: BudgetRowsInput, byRow = false): Promise<(UnconvertedCount & { templateKey: null | number })[]> {
  const templateKey = rowKey(byRow);
  const rows = await matchedTransactions(db, input)
    .leftJoin('currency', 'currency.currency_key', 'transaction.settlement_currency_key')
    .select([templateKey.as('templateKey'), 'currency.code as currencyCode', sql<string>`count(distinct transaction.transaction_key)`.as('transactions')])
    .where('transaction.appuser_settlement_amount', 'is', null)
    .groupBy([templateKey, 'currency.code'])
    .execute();
  return rows.map((row) => ({ currencyCode: row.currencyCode as null | string, templateKey: row.templateKey, transactions: row.transactions }));
}

/** The budget row a count belongs to with `byRow`, else one group for the whole budget. */
function rowKey(byRow: boolean) {
  return sql<null | number>`${byRow ? sql.ref('budget_template_category.budget_template_category_key') : sql`null::int`}`;
}

/**
 * The transactions the budget's rows count, other than loan repayments. A loan repayment is counted
 * by its interest and fees, not its converted amount ({@link foreignLoanRepaymentDays}), so it is not
 * part of this set.
 */
function matchedTransactions(db: Kysely<SqlDatabase>, input: BudgetRowsInput) {
  return budgetRows(db, input)
    .where(sql<SqlBool>`not exists (select 1 from loan_repayment_link where loan_repayment_link.transaction_key = transaction.transaction_key and loan_repayment_link.deleted_at is null)`);
}

/** The transactions the budget's rows count, with the same predicates as the spending query. */
function budgetRows(db: Kysely<SqlDatabase>, input: BudgetRowsInput) {
  return db
    .selectFrom('budget_template_category')
    .innerJoin(categoryLines(input), 'budget_template_category.category_key', 'category_line.category_key')
    .innerJoin('transaction', (join) => join.on(budgetTransactionMatch(input)))
    .where(anyOf('budget_template_category.budget_template_category_key', input.templateKeys));
}
