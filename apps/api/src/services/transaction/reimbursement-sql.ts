import { groupTakenOffOfSql, groupTakenOffRowsSql } from '@service/expense-group/expense-group-sql';

import { accountAudienceSql } from '../account/account-visibility-sql';

import { notExpiredTransactionSql } from './transaction-status';

/**
 * The SQL side of reimbursement links (`TransactionReimbursement`): which links count, and how
 * much of a transaction they take off spending or income. The arithmetic itself is applied by
 * `category-lines.ts` (and its SQL twin there), so every total by category reads it in one place.
 *
 * Kept free of entity and service imports: `Transaction.reimbursedAmount` (a lazy formula) is
 * built from {@link reimbursedAmountOfSql}.
 *
 * ## Which links count
 *
 * A link counts while it is live and both of its transactions are live (not deleted, not EXPIRED)
 * on live accounts, settled in the same currency, and seen by the same members: both on shared
 * accounts, or both on private accounts seen by exactly the same people (owner and shares,
 * `accountAudienceSql`). Linking checks all of this; reading
 * checks it again, so a link whose side was deleted, expired or moved behind a private account
 * afterwards simply stops counting (on both sides at once) instead of leaking or double counting.
 * None of it depends on who is looking, so a total is the same for every member who can see it.
 *
 * ## Expense groups
 *
 * The "reimbursed amount" these helpers hand to the totals also holds what expense groups take off
 * a transaction (`expense-group/expense-group-sql.ts`): the shares of people outside the household
 * and the settlements linked to it. Totals read both as one amount, so they stay in step.
 */

/** SQL: the link aliased `link` counts (see the module comment). `link` is an alias written by the caller. */
export function countingReimbursementLinkSql(link: string): string {
  return `(${link}.deleted_at is null and exists (
    select 1 from "transaction" link_expense
    join "account" link_expense_account on link_expense_account.account_key = link_expense.account_key
    join "transaction" link_refund on link_refund.transaction_key = ${link}.reimbursement_transaction_key
    join "account" link_refund_account on link_refund_account.account_key = link_refund.account_key
    where link_expense.transaction_key = ${link}.expense_transaction_key
      and link_expense.deleted_at is null and link_refund.deleted_at is null
      and link_expense_account.deleted_at is null and link_refund_account.deleted_at is null
      and link_expense.tenant_key = ${link}.tenant_key and link_refund.tenant_key = ${link}.tenant_key
      and link_expense.settlement_currency_key = link_refund.settlement_currency_key
      and ${accountAudienceSql('link_expense_account')} = ${accountAudienceSql('link_refund_account')}
      and ${notExpiredTransactionSql('link_expense')} and ${notExpiredTransactionSql('link_refund')}))`;
}

/**
 * SQL: the reimbursed amount of the transaction whose key is `transactionKeySql`, as a positive
 * amount in its settlement currency: what the counting links on it add up to, on either side
 * (a transaction is an expense or a reimbursement by its sign), plus what expense groups take off
 * it (see "Expense groups" above). 0 when it has none.
 */
export function reimbursedAmountOfSql(transactionKeySql: string): string {
  return `(coalesce((select sum(reimbursed_link.amount) from "transaction_reimbursement" reimbursed_link
    where (reimbursed_link.expense_transaction_key = ${transactionKeySql} or reimbursed_link.reimbursement_transaction_key = ${transactionKeySql})
      and ${countingReimbursementLinkSql('reimbursed_link')}), 0) + ${groupTakenOffOfSql(transactionKeySql)})`;
}

/**
 * The household's reimbursed amounts as a derived table with columns `transaction_key` and
 * `reimbursed_amount` (positive, in the transaction's settlement currency), one row per
 * transaction with a counting link or an amount expense groups take off. For joining in totals
 * that read many rows at once. `tenantKey` is inlined, validated as an integer.
 */
export function reimbursedAmountsSql(tenantKey: number): string {
  if (!Number.isSafeInteger(tenantKey)) throw new TypeError('tenantKey must be an integer');
  const side = (column: string) => `select link.${column} as transaction_key, link.amount
      from "transaction_reimbursement" link
      where link.tenant_key = ${tenantKey} and ${countingReimbursementLinkSql('link')}`;
  return `(select side.transaction_key, sum(side.amount) as reimbursed_amount from (
      ${side('expense_transaction_key')}
      union all
      ${side('reimbursement_transaction_key')}
      union all
      ${groupTakenOffRowsSql(tenantKey)}
    ) side group by side.transaction_key)`;
}

/**
 * SQL: `amountSql` (the transaction aliased `alias`, in whatever currency the caller totals in)
 * net of its reimbursed amount `reimbursedSql`: scaled by `max(|settlement| - reimbursed, 0) /
 * |settlement|` and rounded half away from zero to 4 decimals, like `netOfReimbursements` in
 * `category-lines.ts`. In the settlement currency this is exactly the amount less the reimbursed
 * amount; in another one it follows the transaction's own conversion. Unchanged when nothing is
 * reimbursed; null when the amount is.
 */
export function netOfReimbursementsSql(alias: string, amountSql: string, reimbursedSql: string): string {
  const settlement = `coalesce(${alias}.edited_settlement_amount, ${alias}.settlement_amount)`;
  return `(case when coalesce(${reimbursedSql}, 0) = 0 or coalesce(${settlement}, 0) = 0 then ${amountSql}
    else round(${amountSql} * greatest(abs(${settlement}) - coalesce(${reimbursedSql}, 0), 0) / abs(${settlement}), 4) end)`;
}
