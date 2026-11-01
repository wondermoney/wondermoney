import { type Expression, type Kysely, sql, type SqlBool } from 'kysely';

import { DI } from '@app/app';
import { anyOf, type SqlDatabase, sqlQuery } from '@app/database/sql';
import { notExpiredTransactionSql } from '@service/transaction/transaction-status';
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
  period: 'annual' | 'monthly';
  templateKeys: number[];
  tenantKey: number;
  viewerAppuserKey: number;
}

/**
 * Aggregate category spending for budget readers. Transaction visibility is deliberately
 * attached to the transaction LEFT JOIN: filtering it in WHERE would drop zero-spend categories.
 */
export function buildBudgetSpendingQuery(db: Kysely<SqlDatabase>, input: BudgetSpendingInput) {
  const { accountKeys, templateKeys, tenantKey, viewerAppuserKey } = input;
  const effectiveAmount = sql.raw(buildEffectiveSpendingAmountSql('transaction', 'loan_repayment_link'));
  const annualColumns = input.period === 'annual'
    ? ['budget_template_category.budget_template_category_key', 'budget_template_category.year', 'budget_template_category.month']
    : [];

  const monthlyChildData = db
    .selectFrom('budget')
    .innerJoin('budget_template_category', 'budget.budget_key', 'budget_template_category.budget_key')
    .innerJoin('category as child_category', 'budget_template_category.category_key', 'child_category.category_key')
    .leftJoin('category as parent_category', 'child_category.parent_category_category_key', 'parent_category.category_key')
    .leftJoin('appuser_transaction_category', 'child_category.category_key', 'appuser_transaction_category.category_key')
    .leftJoin('transaction', (join) =>
      join
        .onRef('appuser_transaction_category.transaction_key', '=', 'transaction.transaction_key')
        .on(anyOf('transaction.account_key', accountKeys))
        .on(sql<SqlBool>`date_part('year', transaction.transaction_date) = budget_template_category.year`)
        .on(sql<SqlBool>`date_part('month', transaction.transaction_date) = budget_template_category.month`)
        .on(sql<SqlBool>`transaction.hidden = false`)
        // An EXPIRED row never moved money. PENDING still counts as committed spending.
        .on(sql.raw<SqlBool>(notExpiredTransactionSql('transaction')))
        .on('transaction.deleted_at', 'is', null)
        .on('appuser_transaction_category.deleted_at', 'is', null)
        .on('transaction.tenant_key', '=', tenantKey)
        .on(buildBudgetTransactionAccountVisibility(tenantKey, viewerAppuserKey)))
    .leftJoin('loan_repayment_link', (join) =>
      join.onRef('loan_repayment_link.transaction_key', '=', 'transaction.transaction_key').on('loan_repayment_link.deleted_at', 'is', null))
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

export function buildBudgetTransactionAccountVisibility(tenantKey: number, viewerAppuserKey: number): Expression<SqlBool> {
  return sql<SqlBool>`EXISTS (
       SELECT 1 FROM account AS budget_account
       WHERE budget_account.account_key = transaction.account_key
         AND budget_account.tenant_key = ${tenantKey}
         AND budget_account.closed = false
         AND budget_account.deleted_at IS NULL
         AND (budget_account.is_private = false OR budget_account.account_owner_appuser_key = ${viewerAppuserKey})
     )`;
}

export async function getBudgetSpending(input: BudgetSpendingInput): Promise<BudgetSpendingCategory[]> {
  const db = sqlQuery(DI.em);
  return (await buildBudgetSpendingQuery(db, input).execute(db)).rows;
}
