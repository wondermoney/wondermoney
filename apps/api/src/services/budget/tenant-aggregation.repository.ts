import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { notExpiredTransactionSql } from '@service/transaction/transaction-status';
import { buildEffectiveAmountSql } from '@utils/account-amounts';

import type { InstantRange } from './aggregation-periods';
import type { BudgetAllocationRow, TenantAggregationRepository, TransactionAggregationRow } from './aggregation-types';

export class MikroOrmTenantAggregationRepository implements TenantAggregationRepository {
  private get em(): EntityManager {
    return this.injectedEm ?? DI.em;
  }

  constructor(private readonly injectedEm?: EntityManager) {}

  async hasActiveMembership(appuserKey: number, tenantKey: number): Promise<boolean> {
    const row = await this.em.getConnection().execute<{ present: number }>(
      `select 1 as "present"
       from "appuser_tenant" membership
       join "appuser" owner on owner."appuser_key" = membership."appuser_key"
       where membership."appuser_key" = ? and membership."tenant_key" = ?
         and membership."record_active" = true and membership."deleted_at" is null
         and owner."record_active" = true and owner."deleted_at" is null
       limit 1`,
      [appuserKey, tenantKey],
      'get',
    );
    return (row as undefined | { present: number })?.present === 1;
  }

  async loadBudgetAllocations(appuserKey: number, month: number, year: number): Promise<BudgetAllocationRow[]> {
    return this.em.getConnection().execute<BudgetAllocationRow[]>(
      `select
         budget."budget_key" as "budgetKey", budget."name" as "budgetName",
         template."budget_template_category_key" as "budgetTemplateCategoryKey",
         template."amount_budgeted"::text as "amountBudgeted",
         category."category_key" as "categoryKey", category."name" as "categoryName",
         category."owner_appuser_key" as "categoryOwnerAppuserKey", category."is_system_category" as "categorySystem",
         parent."category_key" as "parentCategoryKey", parent."name" as "parentCategoryName",
         parent."owner_appuser_key" as "parentCategoryOwnerAppuserKey", parent."is_system_category" as "parentCategorySystem",
         currency."code" as "currencyCode", account."account_key" as "accountKey",
         account."tenant_key" as "accountTenantKey",
         account."account_owner_appuser_key" as "accountOwnerAppuserKey",
         account."closed" as "accountClosed", (account."deleted_at" is not null) as "accountDeleted"
       from "budget" budget
       join "budget_template_category" template on template."budget_key" = budget."budget_key"
       join "category" category on category."category_key" = template."category_key"
       left join "category" parent on parent."category_key" = category."parent_category_category_key"
       join "currency" currency on currency."currency_key" = budget."currency_key"
       left join "budget_template_category_accounts" pivot
         on pivot."budget_template_category_budget_template_category_key" = template."budget_template_category_key"
       left join "account" account on account."account_key" = pivot."account_account_key"
       where budget."appuser_key" = ? and budget."deleted_at" is null
         and template."year" = ? and template."month" = ? and template."amount_budgeted" > 0
         and category."deleted_at" is null and category."parent_category_category_key" is not null and parent."deleted_at" is null
         and not exists (select 1 from "category" child where child."parent_category_category_key" = category."category_key" and child."deleted_at" is null)
         and (category."is_system_category" = true or category."owner_appuser_key" = ?)
         and (parent."is_system_category" = true or parent."owner_appuser_key" = ?)
       order by budget."budget_key", template."budget_template_category_key", account."account_key"`,
      [appuserKey, year, month, appuserKey, appuserKey],
    );
  }

  async loadTransactions(appuserKey: number, tenantKey: number, range: InstantRange): Promise<TransactionAggregationRow[]> {
    const rows = await this.em.getConnection().execute<(Omit<TransactionAggregationRow, 'transactionDate'> & { transactionDate: Date | null | string })[]>(
      `select
         tx."transaction_key" as "transactionKey", tx."transaction_date" as "transactionDate",
         tx."appuser_key" as "appuserKey", tx."tenant_key" as "tenantKey",
         transaction_type."name" as "transactionType",
         -- The user-currency amount: an edit writes its converted value here, while
         -- edited_settlement_amount is in the account's currency.
         ${buildEffectiveAmountSql('tx')}::text as "effectiveAmount",
         account."account_key" as "accountKey", account."tenant_key" as "accountTenantKey",
         account."account_owner_appuser_key" as "accountOwnerAppuserKey", account."closed" as "accountClosed",
         (account."deleted_at" is not null) as "accountDeleted",
         assignment."appuser_transaction_category_key" as "assignmentKey",
         assignment."appuser_key" as "assignmentAppuserKey", (assignment."deleted_at" is not null) as "assignmentDeleted",
         category."category_key" as "categoryKey", category."name" as "categoryName",
         category."owner_appuser_key" as "categoryOwnerAppuserKey", (category."deleted_at" is not null) as "categoryDeleted",
         category."is_system_category" as "categorySystem",
         exists (select 1 from "category" child where child."parent_category_category_key" = category."category_key" and child."deleted_at" is null) as "categoryHasActiveChildren",
         parent."category_key" as "parentCategoryKey", parent."name" as "parentCategoryName",
         (parent."deleted_at" is not null) as "parentCategoryDeleted",
         parent."owner_appuser_key" as "parentCategoryOwnerAppuserKey", parent."is_system_category" as "parentCategorySystem",
         loan."loan_repayment_link_key" as "loanLinkKey", loan."tenant_key" as "loanLinkTenantKey",
         loan."linked_by_appuser_key" as "loanLinkedByAppuserKey", (loan."deleted_at" is not null) as "loanLinkDeleted",
         loan."interest_amount"::text as "loanInterestAmount", loan."fee_amount"::text as "loanFeeAmount"
       from "transaction" tx
       join "account" account on account."account_key" = tx."account_key"
       left join "transaction_type" transaction_type on transaction_type."transaction_type_key" = tx."transaction_type_key"
       left join "appuser_transaction_category" assignment on assignment."transaction_key" = tx."transaction_key"
       left join "category" category on category."category_key" = assignment."category_key"
       left join "category" parent on parent."category_key" = category."parent_category_category_key"
       left join "loan_repayment_link" loan on loan."transaction_key" = tx."transaction_key"
       where tx."appuser_key" = ? and tx."tenant_key" = ?
         and tx."transaction_date" >= ? and tx."transaction_date" < ?
         and tx."deleted_at" is null
         -- An EXPIRED row never settled (a dropped pending, or a rejected/cancelled bank row
         -- retracted by the sync), so it is no spending. PENDING still counts: it is money committed.
         and ${notExpiredTransactionSql('tx')}
         and account."tenant_key" = ? and account."account_owner_appuser_key" = ?
         and account."closed" = false and account."deleted_at" is null
       order by tx."transaction_key", assignment."appuser_transaction_category_key", loan."loan_repayment_link_key"`,
      [appuserKey, tenantKey, range.start, range.end, tenantKey, appuserKey],
    );
    return rows.map((row) => ({ ...row, transactionDate: normalizeTransactionDate(row.transactionDate) }));
  }
}

function normalizeTransactionDate(value: Date | null | string): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
