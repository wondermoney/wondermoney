import type { Knex } from '@mikro-orm/postgresql';

import { DI } from '@app/app';
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
export function buildBudgetSpendingQuery(knex: Knex, input: BudgetSpendingInput) {
  const { accountKeys, templateKeys, tenantKey, viewerAppuserKey } = input;
  const effectiveAmount = buildEffectiveSpendingAmountSql('transaction', 'loan_repayment_link');

  const monthlyChildData = knex
    .select(
      'child_category.category_key AS child_category_key',
      'child_category.name AS child_category_name',
      'child_category.icon AS child_category_icon',
      'child_category.text_color AS child_category_text_color',
      'child_category.bg_color AS child_category_bg_color',
      'child_category.is_system_category AS child_category_is_system_category',
      'parent_category.name AS parent_category_name',
      ...(input.period === 'annual'
        ? ['budget_template_category.budget_template_category_key', 'budget_template_category.year', 'budget_template_category.month']
        : []),
      knex.raw(`ABS(SUM(COALESCE(${effectiveAmount}, 0))) AS category_amount`),
      'budget_template_category.amount_budgeted AS category_budgeted_amount',
      'budget_template_category.recurrency AS category_recurrency',
    )
    .from('budget')
    .join('budget_template_category', 'budget.budget_key', '=', 'budget_template_category.budget_key')
    .join('category as child_category', 'budget_template_category.category_key', '=', 'child_category.category_key')
    .leftJoin('category as parent_category', 'child_category.parent_category_category_key', '=', 'parent_category.category_key')
    .leftJoin('appuser_transaction_category', 'child_category.category_key', '=', 'appuser_transaction_category.category_key')
    .leftJoin('transaction', function () {
      this.on('appuser_transaction_category.transaction_key', '=', 'transaction.transaction_key')
        .andOnIn('transaction.account_key', accountKeys)
        .andOn(knex.raw("date_part('year', transaction.transaction_date) = budget_template_category.year"))
        .andOn(knex.raw("date_part('month', transaction.transaction_date) = budget_template_category.month"))
        .andOn(knex.raw('transaction.hidden = false'))
        .andOnNull('transaction.deleted_at')
        .andOnNull('appuser_transaction_category.deleted_at')
        .andOn('transaction.tenant_key', '=', knex.raw('?', [tenantKey]))
        .andOn(buildBudgetTransactionAccountVisibility(knex, tenantKey, viewerAppuserKey));
    })
    .leftJoin('loan_repayment_link', function () {
      this.on('loan_repayment_link.transaction_key', '=', 'transaction.transaction_key').andOnNull('loan_repayment_link.deleted_at');
    })
    .whereIn('budget_template_category.budget_template_category_key', templateKeys)
    .whereNotNull('parent_category.name')
    .whereNull('child_category.deleted_at')
    .whereNull('parent_category.deleted_at')
    .where((query) => {
      query.where('child_category.tenant_key', tenantKey).orWhereNull('child_category.tenant_key');
    })
    .where((query) => {
      query.where('parent_category.tenant_key', tenantKey).orWhereNull('parent_category.tenant_key');
    })
    .groupBy(
      'child_category.category_key',
      'parent_category.name',
      'child_category.name',
      ...(input.period === 'annual'
        ? ['budget_template_category.budget_template_category_key', 'budget_template_category.year', 'budget_template_category.month']
        : []),
      'budget_template_category.amount_budgeted',
      'budget_template_category.recurrency',
    );

  // The monthly readers historically included this join; preserve its row multiplicity.
  if (input.period === 'monthly') {
    monthlyChildData.leftJoin(
      'budget_template_category_accounts',
      'budget.budget_key',
      '=',
      'budget_template_category_accounts.budget_template_category_budget_template_category_key',
    );
  }

  const childCategoryAmounts = input.period === 'annual'
    ? knex
        .select(
          'child_category_key', 'child_category_name', 'child_category_icon', 'child_category_text_color',
          'child_category_bg_color', 'child_category_is_system_category', 'parent_category_name',
          knex.raw('SUM(category_amount) AS category_amount'),
          knex.raw('SUM(category_budgeted_amount) AS category_budgeted_amount'),
          'category_recurrency',
        )
        .from('monthly_child_category_data')
        .groupBy(
          'child_category_key', 'child_category_name', 'child_category_icon', 'child_category_text_color',
          'child_category_bg_color', 'child_category_is_system_category', 'parent_category_name', 'category_recurrency',
        )
    : monthlyChildData;

  const parentBudgetAmount = input.period === 'annual'
    ? `SUM(COALESCE(child_category_amounts.category_budgeted_amount * CASE child_category_amounts.category_recurrency
        WHEN 'MONTHLY_14' THEN 14 WHEN 'MONTHLY' THEN 12 WHEN 'QUARTERLY' THEN 4
        WHEN 'BI_ANNUALLY' THEN 2 WHEN 'ANNUALLY' THEN 1 ELSE 1 END / 12, 0))`
    : 'SUM(COALESCE(child_category_amounts.category_budgeted_amount, 0))';

  const parentCategoryAmounts = knex
    .select(
      'parent_category.category_key AS parent_category_key',
      'parent_category.name AS parent_category_name',
      'parent_category.icon AS parent_category_icon',
      'parent_category.text_color AS parent_category_text_color',
      'parent_category.bg_color AS parent_category_bg_color',
      'parent_category.is_system_category AS parent_category_is_system_category',
      knex.raw('SUM(COALESCE(child_category_amounts.category_amount, 0)) AS category_amount'),
      knex.raw(`${parentBudgetAmount} AS category_budgeted_amount`),
    )
    .from('category as parent_category')
    .leftJoin('category as child_category', 'parent_category.category_key', '=', 'child_category.parent_category_category_key')
    .leftJoin('child_category_amounts', 'child_category.category_key', '=', 'child_category_amounts.child_category_key')
    .leftJoin('budget_template_category as bc', 'parent_category.category_key', '=', 'bc.category_key')
    .whereNull('parent_category.parent_category_category_key')
    .whereNull('parent_category.deleted_at')
    .whereNull('child_category.deleted_at')
    .where((query) => {
      query.where('parent_category.tenant_key', tenantKey).orWhereNull('parent_category.tenant_key');
    })
    .groupBy('parent_category.category_key', 'parent_category.name');

  const unionQuery = knex
    .unionAll(function () {
      this.select(
        'child_category_name', 'parent_category_name', 'category_amount', 'category_recurrency', 'child_category_icon',
        'child_category_text_color', 'child_category_bg_color', 'child_category_is_system_category',
        knex.raw('null as parent_category_icon'), knex.raw('null as parent_category_text_color'),
        knex.raw('null as parent_category_bg_color'), knex.raw('null as parent_category_is_system_category'),
        knex.raw('COALESCE(category_budgeted_amount, 0) as category_budgeted_amount'), 'child_category_key',
        knex.raw('null as parent_category_key'),
      ).from('child_category_amounts')
        .unionAll(function () {
          this.select(
            knex.raw('CAST(null AS text) as child_category_name'), 'parent_category_name', 'category_amount',
            knex.raw('null as category_recurrency'), knex.raw('null as child_category_icon'),
            knex.raw('null as child_category_text_color'), knex.raw('null as child_category_bg_color'),
            knex.raw('null as child_category_is_system_category'), 'parent_category_icon', 'parent_category_text_color',
            'parent_category_bg_color', 'parent_category_is_system_category',
            knex.raw('COALESCE(category_budgeted_amount, 0) as category_budgeted_amount'),
            knex.raw('null as child_category_key'), 'parent_category_key',
          ).from('parent_category_amounts');
        });
    })
    .as('t');

  const query = knex.queryBuilder();
  if (input.period === 'annual') query.with('monthly_child_category_data', monthlyChildData);

  query
    .with('child_category_amounts', childCategoryAmounts)
    .with('parent_category_amounts', parentCategoryAmounts)
    .select(
      't.child_category_name', 't.parent_category_name', 't.category_amount', 't.category_budgeted_amount',
      't.category_recurrency',
      knex.raw('COALESCE(t.child_category_icon, t.parent_category_icon) as category_icon'),
      knex.raw('COALESCE(t.child_category_text_color, t.parent_category_text_color) as category_text_color'),
      knex.raw('COALESCE(t.child_category_bg_color, t.parent_category_bg_color) as category_bg_color'),
      knex.raw('COALESCE(t.child_category_is_system_category, t.parent_category_is_system_category) as category_is_system_category'),
      knex.raw('COALESCE(t.parent_category_key, t.child_category_key) as category_key'),
    )
    .from(unionQuery)
    .whereNotNull('parent_category_name')
    .orderBy('parent_category_name')
    .orderBy('child_category_name', 'desc');

  return query;
}

export function buildBudgetTransactionAccountVisibility(knex: Knex, tenantKey: number, viewerAppuserKey: number) {
  return knex.raw(
    `EXISTS (
       SELECT 1 FROM account AS budget_account
       WHERE budget_account.account_key = transaction.account_key
         AND budget_account.tenant_key = ?
         AND budget_account.closed = false
         AND budget_account.deleted_at IS NULL
         AND (budget_account.is_private = false OR budget_account.account_owner_appuser_key = ?)
     )`,
    [tenantKey, viewerAppuserKey],
  );
}

export async function getBudgetSpending(input: BudgetSpendingInput): Promise<BudgetSpendingCategory[]> {
  return (await buildBudgetSpendingQuery(DI.em.getKnex(), input)) as BudgetSpendingCategory[];
}
