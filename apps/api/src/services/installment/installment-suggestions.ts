import { toCalendarDate, utcDayNumber } from '@service/account/credit-card-cycle';

import { normalizeInstallmentStem, parseInstallmentMarker } from './installment-description';
import { addMonthsClamped, startOfUtcDay } from './installment-schedule';

/**
 * Suggested installment plans, from posted rows whose descriptions carry an "n/N" marker.
 *
 * Only a suggestion: nothing here writes, and a plan exists only once the user accepts one. Rows
 * are grouped by account, purchase name (the description without the marker, folded) and count;
 * inside a group, rows of one purchase share an amount (the last installment may differ by the
 * rounding), and a number appears once per purchase, so two identical purchases stay apart. A bare
 * `n/N` with no keyword can be a calendar date, so it takes two agreeing rows to suggest a plan.
 */

export interface InstallmentSuggestion {
  accountKey: number;
  description: string;
  installmentAmount: number;
  installmentCount: number;
  key: string;
  purchaseDate: string;
  totalAmount: number;
  transactions: { amount: number; description: string; installmentNumber: number; transactionDate: string; transactionKey: number }[];
}

export interface SuggestionTransaction {
  accountKey: number;
  /** Signed, in the account's currency: a charge is negative. */
  amount: number;
  description: string;
  transactionDate: Date;
  transactionKey: number;
}

interface MarkedRow {
  amount: number;
  description: string;
  explicit: boolean;
  installmentCount: number;
  installmentNumber: number;
  stem: string;
  transactionDate: Date;
  transactionKey: number;
}

const cents = (amount: number) => Math.round(amount * 100);

/** The most common amount in cents, the smallest on a tie. */
export function buildInstallmentSuggestions(transactions: readonly SuggestionTransaction[]): InstallmentSuggestion[] {
  const groups = new Map<string, { accountKey: number; rows: MarkedRow[] }>();
  for (const transaction of transactions) {
    if (!(transaction.amount < 0)) continue;
    const marker = parseInstallmentMarker(transaction.description);
    if (!marker) continue;
    const groupKey = `${transaction.accountKey}|${normalizeInstallmentStem(marker.stem)}|${marker.installmentCount}`;
    const group = groups.get(groupKey) ?? { accountKey: transaction.accountKey, rows: [] };
    group.rows.push({
      amount: -transaction.amount,
      description: transaction.description,
      explicit: marker.explicit,
      installmentCount: marker.installmentCount,
      installmentNumber: marker.installmentNumber,
      stem: marker.stem,
      transactionDate: transaction.transactionDate,
      transactionKey: transaction.transactionKey,
    });
    groups.set(groupKey, group);
  }

  const suggestions: InstallmentSuggestion[] = [];
  for (const { accountKey, rows } of groups.values()) {
    const count = rows[0]?.installmentCount ?? 0;
    // The rounding of a split lands on one installment, so a purchase's amounts differ by less than a cent per installment.
    const tolerance = Math.max(count, 1);
    const clusters: MarkedRow[][] = [];
    const ordered = rows.toSorted((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime() || a.installmentNumber - b.installmentNumber || a.transactionKey - b.transactionKey);
    for (const candidate of ordered) {
      const cluster = clusters.find((members) =>
        !members.some((member) => member.installmentNumber === candidate.installmentNumber)
        && members.every((member) => Math.abs(cents(member.amount) - cents(candidate.amount)) <= tolerance));
      if (cluster) cluster.push(candidate);
      else clusters.push([candidate]);
    }
    for (const cluster of clusters) {
      if (cluster.length < 2 && !cluster.some((member) => member.explicit)) continue;
      suggestions.push(suggestionFor(accountKey, cluster));
    }
  }
  return suggestions.sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || a.key.localeCompare(b.key));
}

function modalCents(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

function suggestionFor(accountKey: number, rows: MarkedRow[]): InstallmentSuggestion {
  const [first] = rows;
  if (!first) throw new Error('A suggestion needs at least one row');
  const count = first.installmentCount;
  const last = rows.find((candidate) => candidate.installmentNumber === count);
  const regular = rows.filter((candidate) => candidate.installmentNumber !== count);
  const installmentCents = modalCents((regular.length > 0 ? regular : rows).map((candidate) => cents(candidate.amount)));
  const totalCents = last && regular.length > 0 ? installmentCents * (count - 1) + cents(last.amount) : installmentCents * count;

  // A bank that dates every installment on the purchase day says so by giving them one date.
  const sameDay = rows.length > 1 && rows.every((candidate) => utcDayNumber(candidate.transactionDate) === utcDayNumber(first.transactionDate));
  const purchaseDate = sameDay ? startOfUtcDay(first.transactionDate) : addMonthsClamped(startOfUtcDay(first.transactionDate), -(first.installmentNumber - 1));

  return {
    accountKey,
    description: first.stem || first.description,
    installmentAmount: installmentCents / 100,
    installmentCount: count,
    key: `${accountKey}:${first.transactionKey}`,
    purchaseDate: toCalendarDate(purchaseDate),
    totalAmount: totalCents / 100,
    transactions: rows
      .toSorted((a, b) => a.installmentNumber - b.installmentNumber)
      .map((candidate) => ({
        amount: candidate.amount,
        description: candidate.description,
        installmentNumber: candidate.installmentNumber,
        transactionDate: toCalendarDate(candidate.transactionDate),
        transactionKey: candidate.transactionKey,
      })),
  };
}
