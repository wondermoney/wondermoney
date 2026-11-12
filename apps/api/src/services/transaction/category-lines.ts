import { wrap } from '@mikro-orm/core';
import { Big } from 'big.js';

import type { Category } from '@entity/Category';
import type { Transaction } from '@entity/Transaction';
import { amountInCurrencySql } from '@service/reports/report-currency';
import { big, toNumber } from '@utils/money';

import { type CategorySpendingFlags, effectiveCountsAsSpendingSql } from './category-spending';
import { netOfReimbursementsSql, reimbursedAmountsSql } from './reimbursement-sql';

/**
 * "Category lines": the parts of a transaction that count towards a category.
 *
 * A transaction that is not split has one line, its category assignment (or none: uncategorized)
 * for its whole amount. A split transaction has one line per `TransactionSplit`, each for its
 * share. Every total by category (budgets, reports, the dashboard's category spending, the monthly
 * emails, the assistant) reads through here, in JavaScript ({@link categoryLinesOf}) or in SQL
 * ({@link categoryLinesSql}), so a split transaction counts exactly like the same spending entered
 * as separate transactions, and never twice.
 *
 * ## A line's amount in another currency
 *
 * Lines store their amount in the settlement currency only. In any other currency (the user's, the
 * viewer's) a line is the transaction's converted amount shared out in proportion to the line
 * amounts ({@link allocateProRata}): each share rounded half away from zero to 4 decimals (the
 * money columns' scale), the remainder on the largest line. The shares therefore always sum to
 * the converted parent, whatever its rate, and follow every re-conversion; a line has no
 * converted amount exactly when its transaction has none (`fxStatus` `missing`).
 *
 * Shares are taken against the lines' own total, not the transaction's amount, so even lines that
 * were not yet rescaled after an amount change still add up to the transaction.
 *
 * The JavaScript and SQL versions compute the same numbers: same rounding, same tie-break (largest
 * absolute amount, then position, then key).
 *
 * ## Reimbursements
 *
 * A refund linked to the expense it offsets (`TransactionReimbursement`) takes the linked amount
 * off both: the expense spends that much less in its category (pro rata across its split lines),
 * and the refund is that much less income. Totals read the transaction's amount net of its
 * reimbursed amount ({@link netOfReimbursements}, `netOfReimbursementsSql`): the amount scaled by
 * `max(|settlement| - reimbursed, 0) / |settlement|`, rounded half away from zero to 4 decimals,
 * so in the settlement currency it is exactly the amount less the linked total, and in any other
 * currency it follows the transaction's own conversion. The lines then share out the net amount
 * as above. A fully reimbursed expense still has its lines, for nothing.
 *
 * {@link spendingLinesOf} and {@link categoryLinesSql} (every total) read the net amount;
 * {@link categoryLinesOf} is the plain allocation of whatever amount it is handed (a split's lines
 * shown on a row).
 */

/** Scale of the money columns (`numeric(18,4)`). */
const SHARE_SCALE = 4;

/**
 * Split `total` in proportion to `weights`. Every part but one is rounded half away from zero to
 * `scale` decimals; the part with the largest absolute weight (the first, on a tie) takes the
 * remainder, so the parts sum to `total` exactly.
 */
export interface CategoryLine {
  /** In the currency of the amount handed in; null when that amount is null (not converted). */
  amount: null | number;
  /** Null for an uncategorized line. */
  category: Category | null;
  notes: null | string;
  /** The split line's key; null for a transaction that is not split. */
  transactionSplitKey: null | number;
}

export function allocateProRata(total: Big | number | string, weights: (Big | number | string)[], scale: number = SHARE_SCALE): number[] {
  const amounts = weights.map((weight) => big(weight));
  const weightTotal = amounts.reduce((sum, weight) => sum.plus(weight), new Big(0));
  const target = big(total);
  if (amounts.length === 0) return [];
  if (weightTotal.eq(0)) throw new RangeError('Cannot share an amount out by weights that sum to zero');

  const shares = amounts.map((weight) => target.times(weight).div(weightTotal).round(scale, Big.roundHalfUp));
  let largest = 0;
  amounts.forEach((weight, index) => {
    if (weight.abs().gt(amounts[largest]!.abs())) largest = index;
  });
  const others = shares.reduce((sum, share, index) => (index === largest ? sum : sum.plus(share)), new Big(0));
  shares[largest] = target.minus(others);
  return shares.map((share) => toNumber(share, SHARE_SCALE));
}

/**
 * What a report must populate on `Transaction` for {@link categoryLinesOf}: both the single
 * assignment and the split lines, with their categories and parents.
 */
export const CATEGORY_LINE_POPULATE = [
  'appuserTransactionCategories.categoryKey',
  'appuserTransactionCategories.categoryKey.parentCategory',
  'splits.categoryKey',
  'splits.categoryKey.parentCategory',
  'reimbursedAmount',
] as const;

/**
 * The category lines of `transaction` for `amount`, the transaction's amount in whatever currency
 * the caller totals in. Populate {@link CATEGORY_LINE_POPULATE} first.
 */
export function categoryLinesOf(transaction: Transaction, amount: null | number): CategoryLine[] {
  const splits = liveSplitsOf(transaction);
  if (splits.length === 0) {
    return [{ amount, category: transaction.appuserTransactionCategories.getItems()[0]?.categoryKey ?? null, notes: null, transactionSplitKey: null }];
  }
  const ordered = [...splits].sort((a, b) => a.position - b.position || a.transactionSplitKey - b.transactionSplitKey);
  const shares = amount === null ? ordered.map(() => null) : allocateProRata(amount, ordered.map((split) => split.amount));
  return ordered.map((split, index) => ({
    amount: shares[index] ?? null,
    category: split.categoryKey ?? null,
    notes: split.notes ?? null,
    transactionSplitKey: split.transactionSplitKey,
  }));
}

/**
 * The populated live split lines. An unpopulated collection is a bug in the caller (it would count
 * a split transaction whole, in one category), so it throws. A plain object without the
 * collection (a hand-built row) has none.
 */
function liveSplitsOf(transaction: Transaction) {
  const collection = transaction.splits as Transaction['splits'] | undefined;
  if (!collection) return [];
  if (!collection.isInitialized()) throw new Error('Populate Transaction.splits (CATEGORY_LINE_POPULATE) before reading category lines');
  return collection.getItems().filter((split) => !split.deletedAt);
}

/**
 * The category lines of `transaction` that are spending for the household whose `flags` these are
 * (`category-spending.ts`): a line in "Investments and savings", or in any category the household
 * does not count as spending, is left out, and only that line of a split. The lines share out
 * `amount` net of the transaction's reimbursements ({@link netOfReimbursements}).
 */
export function spendingLinesOf(transaction: Transaction, amount: null | number, flags: CategorySpendingFlags): CategoryLine[] {
  return categoryLinesOf(transaction, netOfReimbursements(transaction, amount)).filter((line) => flags.countsAsSpending(line.category));
}

/**
 * `amount` (the transaction's amount in the caller's currency) net of what the reimbursement links
 * on the transaction take off it; see "Reimbursements" above. A loaded transaction must have
 * `reimbursedAmount` populated ({@link CATEGORY_LINE_POPULATE}), or it throws: it would count a
 * refunded expense whole. A plain object without it (a hand-built row) has none.
 */
export function netOfReimbursements(transaction: Pick<Transaction, 'editedSettlementAmount' | 'reimbursedAmount' | 'settlementAmount'>, amount: null | number): null | number {
  const reimbursed = transaction.reimbursedAmount;
  if (reimbursed === undefined) {
    if (wrap(transaction, true).__managed) throw new Error('Populate Transaction.reimbursedAmount (CATEGORY_LINE_POPULATE) before reading spending lines');
    return amount;
  }
  const settlement = transaction.editedSettlementAmount ?? transaction.settlementAmount;
  if (amount === null || big(reimbursed).eq(0) || settlement == null || big(settlement).eq(0)) return amount;
  const whole = big(settlement).abs();
  const kept = whole.minus(big(reimbursed));
  if (kept.lte(0)) return 0;
  return toNumber(big(amount).times(kept).div(whole).round(SHARE_SCALE, Big.roundHalfUp), SHARE_SCALE);
}

/** Whether the transaction is split. Populate `splits` first. */
export function hasLiveSplits(transaction: Transaction): boolean {
  return liveSplitsOf(transaction).length > 0;
}

/** Whether any line of the transaction is in one of `categoryKeys` (a category filter matches any line). */
export function hasLineInCategories(transaction: Transaction, categoryKeys: Iterable<number | string>): boolean {
  const keys = new Set([...categoryKeys].map(String));
  return categoryLinesOf(transaction, null).some((line) => line.category !== null && keys.has(String(line.category.categoryKey)));
}

/**
 * The category lines of a household's transactions as a SQL derived table, the counterpart of
 * {@link categoryLinesOf}. One row per line, with columns:
 *
 * - `transaction_key`, `category_key` (null: uncategorized);
 * - `appuser_settlement_amount`: the line's share of the transaction's amount in the user's
 *   currency, null when the transaction has none. Named like the transaction column so the
 *   amount helpers in `utils/account-amounts.ts` read it unchanged;
 * - `transaction_split_key` (null for an unsplit transaction), `appuser_transaction_category_key`
 *   and `appuser_key` (the assigning member; the transaction's owner for a split line);
 * - `counts_as_spending`: false for a line in a category that does not count as spending for the
 *   household (its value or its parent's is off), as `CategorySpendingFlags.countsAsSpending` in
 *   `category-spending.ts`.
 *
 * With `amountInCurrencyKey`, the lines share out the transaction's amount as a total in that
 * currency reads it before any rate (`amountInCurrencySql` in `report-currency.ts`): the
 * settlement amount when the transaction was settled in that currency, else the amount in the
 * user's currency. The column keeps its name.
 *
 * Either way the amount is net of the transaction's reimbursements (`netOfReimbursementsSql`), as
 * {@link spendingLinesOf} reads it.
 *
 * Scoped to `tenantKey`, which is inlined (validated as an integer) so the fragment can be used
 * from both Kysely and raw SQL. Callers still apply their own transaction conditions (tenant,
 * privacy, status, dates) through their join to `transaction`.
 */
export function categoryLinesSql(tenantKey: number, options: { amountInCurrencyKey?: number } = {}): string {
  if (!Number.isSafeInteger(tenantKey)) throw new TypeError('tenantKey must be an integer');
  const gross = options.amountInCurrencyKey === undefined ? 't.appuser_settlement_amount' : amountInCurrencySql('t', options.amountInCurrencyKey);
  const base = netOfReimbursementsSql('t', gross, 'line_reimbursed.reimbursed_amount');
  const reimbursed = `left join ${reimbursedAmountsSql(tenantKey)} line_reimbursed on line_reimbursed.transaction_key = t.transaction_key`;
  const shares = `
    select ranked.*, sum(ranked.share) over (partition by ranked.transaction_key) as share_total
    from (
      select s.transaction_key, s.category_key, s.transaction_split_key, t.appuser_key,
        ${base} as base,
        round(${base} * s.amount / nullif(sum(s.amount) over (partition by s.transaction_key), 0), ${SHARE_SCALE}) as share,
        row_number() over (partition by s.transaction_key order by abs(s.amount) desc, s.position asc, s.transaction_split_key asc) as line_rank
      from "transaction_split" s
      join "transaction" t on t.transaction_key = s.transaction_key
      ${reimbursed}
      where s.deleted_at is null and s.tenant_key = ${tenantKey}
    ) ranked`;
  const lines = `
    select split.transaction_key, split.category_key,
      case when split.line_rank = 1 then split.base - (split.share_total - split.share) else split.share end as appuser_settlement_amount,
      split.transaction_split_key, null::int as appuser_transaction_category_key, split.appuser_key
    from (${shares}) split
    union all
    select a.transaction_key, a.category_key, ${base} as appuser_settlement_amount,
      null::int as transaction_split_key, a.appuser_transaction_category_key, a.appuser_key
    from "appuser_transaction_category" a
    join "transaction" t on t.transaction_key = a.transaction_key
    ${reimbursed}
    where a.deleted_at is null and t.tenant_key = ${tenantKey}
      and not exists (select 1 from "transaction_split" s where s.transaction_key = a.transaction_key and s.deleted_at is null)`;
  return `(
    select line.*, (${effectiveCountsAsSpendingSql('line_category', tenantKey)} and ${effectiveCountsAsSpendingSql('line_parent', tenantKey)}) as counts_as_spending
    from (${lines}) line
    left join "category" line_category on line_category.category_key = line.category_key
    left join "category" line_parent on line_parent.category_key = line_category.parent_category_category_key
  )`;
}

/**
 * SQL: the transaction aliased `alias` has a category line that counts as spending for the
 * household `tenantKey`, the row-level counterpart of {@link spendingLinesOf} (some line kept). An
 * unsplit transaction has one line, its category assignment (none: uncategorized, which counts); a
 * split one counts when any live line does. `tenantKey` is inlined, validated as an integer.
 */
export function hasSpendingLineSql(alias: string, tenantKey: number): string {
  if (!Number.isSafeInteger(tenantKey)) throw new TypeError('tenantKey must be an integer');
  const row = `"${alias}"`;
  const counts = `(${effectiveCountsAsSpendingSql('spending_category', tenantKey)} and ${effectiveCountsAsSpendingSql('spending_parent', tenantKey)})`;
  const categories = `left join "category" spending_category on spending_category.category_key = spending_line.category_key
      left join "category" spending_parent on spending_parent.category_key = spending_category.parent_category_category_key`;
  return `(case when exists (select 1 from "transaction_split" live_split where live_split.transaction_key = ${row}."transaction_key" and live_split.deleted_at is null)
    then exists (select 1 from "transaction_split" spending_line ${categories}
      where spending_line.transaction_key = ${row}."transaction_key" and spending_line.deleted_at is null and ${counts})
    else not exists (select 1 from "appuser_transaction_category" spending_line ${categories}
      where spending_line.transaction_key = ${row}."transaction_key" and spending_line.deleted_at is null and not ${counts})
  end)`;
}
