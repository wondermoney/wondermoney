/**
 * The SQL side of expense groups in the household's totals: how much of a transaction is not the
 * household's own money in or out, because it belongs to someone outside the household.
 *
 * Kept free of entity and service imports, like `transaction/reimbursement-sql.ts`, which adds
 * these amounts to what it takes off a transaction (`Transaction.reimbursedAmount` and
 * `reimbursedAmountsSql`), so every total that is net of reimbursements is net of these too, and
 * `category-lines.ts` shares out what is left over the household's own lines.
 *
 * Two things are taken off, both positive and in the transaction's settlement currency:
 *
 * - **Shares of people outside the household.** A shared expense is split by person
 *   (`TransactionSplit.expenseGroupMemberKey`). A line of a member with no `appuser_key` is money
 *   the household is owed, not spending, so the transaction counts that much less; the category
 *   lines leave the line out ({@link outsideShareLineSql}). A line of a member of the household
 *   counts as usual. A 60 dinner shared by three, one of them you, counts 20.
 * - **Linked settlements.** A friend paying back 20 into the household's account is not income,
 *   and the household paying a friend back is not spending: a settlement linked to the
 *   transaction takes its amount off, as a reimbursement link does. It counts while it is live and
 *   its transaction is settled in the settlement's currency.
 *
 * The service keeps a transaction in one of these roles at a time (shared expense, settlement,
 * reimbursement), so nothing is taken off twice; the totals' `max(|amount| - taken off, 0)` floor
 * holds even if it were.
 */

/** SQL: the split line aliased `line` is the share of someone outside the household. */
export function outsideShareLineSql(line: string): string {
  return `(${line}.expense_group_member_key is not null and exists (select 1 from "expense_group_member" share_member
    where share_member.expense_group_member_key = ${line}.expense_group_member_key and share_member.appuser_key is null))`;
}

/** SQL: the settlement aliased `settlement` counts against its linked transaction. */
function countingSettlementLinkSql(settlement: string): string {
  return `(${settlement}.deleted_at is null and ${settlement}.transaction_key is not null and exists (select 1 from "transaction" settled
    where settled.transaction_key = ${settlement}.transaction_key and settled.tenant_key = ${settlement}.tenant_key
      and settled.settlement_currency_key = ${settlement}.currency_key))`;
}

/**
 * SQL: what expense groups take off the transaction whose key is `transactionKeySql`, positive, in
 * its settlement currency; 0 when nothing.
 */
export function groupTakenOffOfSql(transactionKeySql: string): string {
  return `(coalesce((select sum(abs(outside_line.amount)) from "transaction_split" outside_line
      where outside_line.transaction_key = ${transactionKeySql} and outside_line.deleted_at is null and ${outsideShareLineSql('outside_line')}), 0)
    + coalesce((select sum(linked_settlement.amount) from "expense_group_settlement" linked_settlement
      where linked_settlement.transaction_key = ${transactionKeySql} and ${countingSettlementLinkSql('linked_settlement')}), 0))`;
}

/**
 * The household's group amounts as rows of `transaction_key` and `amount` (positive, in the
 * transaction's settlement currency), several per transaction possibly: for `union all` into a
 * per-transaction sum. `tenantKey` is inlined, validated as an integer.
 */
export function groupTakenOffRowsSql(tenantKey: number): string {
  if (!Number.isSafeInteger(tenantKey)) throw new TypeError('tenantKey must be an integer');
  return `select outside_line.transaction_key, abs(outside_line.amount) as amount
      from "transaction_split" outside_line
      where outside_line.tenant_key = ${tenantKey} and outside_line.deleted_at is null and ${outsideShareLineSql('outside_line')}
      union all
      select linked_settlement.transaction_key, linked_settlement.amount
      from "expense_group_settlement" linked_settlement
      where linked_settlement.tenant_key = ${tenantKey} and ${countingSettlementLinkSql('linked_settlement')}`;
}
