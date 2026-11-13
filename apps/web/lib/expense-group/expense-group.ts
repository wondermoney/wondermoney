import { parseDecimal } from "@wondermoney/shared/decimal";

import {
  amountToUnits,
  decimalToUnits,
  formatUnitsForInput,
  parseSplitLineAmount,
  type SplitLineError,
  unitsToDecimal,
  unitsToNumber,
} from "@/lib/account/transaction-split";
import { isTransferType } from "@/lib/account/transaction-transfer";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";
import type {
  CurrencyAmount,
  ExpenseGroup,
  ExpenseGroupMember,
  ExpenseGroupSplitMethod,
  GroupExpense,
  ShareInput,
  SuggestedPayment,
  UpdateExpenseGroupInput,
} from "@/lib/api/expense-group/types";
import { formatWireDecimalInput } from "@/lib/utils/number";

/**
 * The rules the client applies to expense groups (`lib/api/expense-group`): the live preview of
 * how a transaction's amount is shared out, which mirrors the API's `computeShares`
 * (`apps/api/src/services/expense-group/expense-group-math.ts`) so "left to assign" says exactly
 * what the server will accept; how a balance and a payment read; and which transactions can be
 * shared at all.
 *
 * Money is counted in the split editor's integer units of 0.0001 (`transaction-split.ts`), as
 * bigints, so a preview never hangs on a float. Percentages are counted in hundredths.
 */

const CENT = 100n;
/** 100% in hundredths of a percent. */
const WHOLE_PERCENT = 10_000n;

const abs = (value: bigint) => (value < 0n ? -value : value);
const sign = (value: bigint) => (value < 0n ? -1n : 1n);

/** `numerator / denominator` to the nearest cent in units, halves up; both non-negative. */
function roundedCents(numerator: bigint, denominator: bigint): bigint {
  const cents =
    (numerator * 2n + denominator * CENT) / (2n * denominator * CENT);
  return cents * CENT;
}

/** A person in the share form, with what was typed for them (amounts and percentages only). */
export interface SharePerson {
  memberKey: number;
  value: string;
}

export type ShareLineError = SplitLineError;

export interface SharePreviewLine {
  memberKey: number;
  /** The share, signed like the transaction, in units; null while it cannot be worked out. */
  units: bigint | null;
  error: ShareLineError | null;
  /** `percentages`: the percentage read, in hundredths. */
  percentHundredths?: bigint | null;
}

export type ShareProblem =
  "no-people" | "line-errors" | "unassigned" | "over-assigned" | "zero-share";

export interface SharePreview {
  shares: SharePreviewLine[];
  /**
   * `amounts`: what is still to assign as a positive magnitude (negative when over), in units.
   * Zero for the other methods, which always add up.
   */
  remainingUnits: bigint;
  /** `percentages`: what is still to assign, in percent (negative when over); else 0. */
  remainingPercent: number;
  /** The first reason the shares cannot be saved, or null when they can. */
  problem: ShareProblem | null;
}

/** A percentage as typed ("25", "25%", "12,5"), in hundredths; at most two decimals. */
function parsePercent(
  input: string,
  locale: string,
): { hundredths: bigint | null; error: ShareLineError | null } {
  const text = input.trim().replace(/\s*%$/, "");
  if (text === "") return { hundredths: null, error: null };
  const parsed = parseDecimal(text, { locale });
  if (parsed === null || parsed.startsWith("-")) {
    return { hundredths: null, error: "invalid" };
  }
  const value = decimalToUnits(parsed);
  if (value === null || value % CENT !== 0n) {
    return { hundredths: null, error: "too-precise" };
  }
  if (value === 0n) return { hundredths: null, error: "zero" };
  const hundredths = value / CENT;
  if (hundredths > WHOLE_PERCENT) return { hundredths: null, error: "invalid" };
  return { hundredths, error: null };
}

/**
 * How `totalUnits` (the transaction's signed amount) is shared out between `people` by
 * `method`, as the API would do it:
 *
 * - **equal**: the amount over the people, each rounded half up to the cent, the remainder on
 *   the first person;
 * - **percentages**: each person's percentage (more than 0, at most 2 decimals, together exactly
 *   100), rounded the same way, the remainder on the largest percentage (the first of equals);
 * - **amounts**: each person's amount as typed (a magnitude, at most 4 decimals), which must add
 *   up to the whole.
 *
 * No share may be zero.
 */
export function previewShares(
  totalUnits: bigint,
  method: ExpenseGroupSplitMethod,
  people: SharePerson[],
  locale: string,
): SharePreview {
  const magnitude = abs(totalUnits);
  const signOf = sign(totalUnits);
  const empty = { remainingUnits: 0n, remainingPercent: 0 };
  if (people.length === 0) {
    return { shares: [], ...empty, problem: "no-people" };
  }

  if (method === "equal") {
    const count = BigInt(people.length);
    const each = roundedCents(magnitude, count);
    const first = magnitude - each * (count - 1n);
    const shares = people.map((person, index) => ({
      memberKey: person.memberKey,
      units: signOf * (index === 0 ? first : each),
      error: null,
    }));
    const zero = shares.some((share) => share.units * signOf <= 0n);
    return { shares, ...empty, problem: zero ? "zero-share" : null };
  }

  if (method === "percentages") {
    const parsed = people.map((person) => parsePercent(person.value, locale));
    const assigned = parsed.reduce((sum, p) => sum + (p.hundredths ?? 0n), 0n);
    const remaining = WHOLE_PERCENT - assigned;
    const remainingPercent = Number(remaining) / 100;
    const readable = parsed.every((p) => p.hundredths !== null);

    let amounts: (bigint | null)[] = parsed.map(() => null);
    if (readable && remaining === 0n) {
      let largest = 0;
      parsed.forEach((p, index) => {
        if (p.hundredths! > parsed[largest]!.hundredths!) largest = index;
      });
      amounts = parsed.map((p) =>
        roundedCents(magnitude * p.hundredths!, WHOLE_PERCENT),
      );
      const others = amounts.reduce<bigint>(
        (sum, value, index) => (index === largest ? sum : sum + value!),
        0n,
      );
      amounts[largest] = magnitude - others;
    } else if (readable) {
      // Not yet 100: each share as it would be, for the preview.
      amounts = parsed.map((p) =>
        roundedCents(magnitude * p.hundredths!, WHOLE_PERCENT),
      );
    }

    const shares = people.map((person, index) => ({
      memberKey: person.memberKey,
      units: amounts[index] === null ? null : signOf * amounts[index]!,
      error: parsed[index]!.error,
      percentHundredths: parsed[index]!.hundredths,
    }));
    let problem: ShareProblem | null = null;
    if (!readable) problem = "line-errors";
    else if (remaining > 0n) problem = "unassigned";
    else if (remaining < 0n) problem = "over-assigned";
    else if (amounts.some((value) => value! <= 0n)) problem = "zero-share";
    return { shares, remainingUnits: 0n, remainingPercent, problem };
  }

  const lines = people.map((person) =>
    parseSplitLineAmount(person.value, totalUnits, locale),
  );
  const assigned = lines.reduce((sum, line) => sum + abs(line.units ?? 0n), 0n);
  const remainingUnits = magnitude - assigned;
  const shares = people.map((person, index) => ({
    memberKey: person.memberKey,
    units: lines[index]!.units,
    error: lines[index]!.error,
  }));
  let problem: ShareProblem | null = null;
  if (lines.some((line) => line.units === null || line.error !== null)) {
    problem = "line-errors";
  } else if (remainingUnits > 0n) problem = "unassigned";
  else if (remainingUnits < 0n) problem = "over-assigned";
  return { shares, remainingUnits, remainingPercent: 0, problem };
}

/** The `shares` of `POST .../shares`; call only when the preview reports no problem. */
export function toShareRequest(
  method: ExpenseGroupSplitMethod,
  people: SharePerson[],
  preview: SharePreview,
): ShareInput[] {
  return people.map((person, index) => {
    const line = preview.shares[index];
    if (method === "equal") return { memberId: person.memberKey };
    if (method === "percentages") {
      if (line?.percentHundredths == null) {
        throw new Error("A share has no percentage");
      }
      return {
        memberId: person.memberKey,
        percentage: Number(line.percentHundredths) / 100,
      };
    }
    if (line?.units == null) throw new Error("A share has no amount");
    return {
      memberId: person.memberKey,
      amount: unitsToNumber(abs(line.units)),
    };
  });
}

/**
 * The form's starting values when editing how a transaction is shared: its method, and per
 * person the amount (`amounts`) or the percentage (`percentages`, worked back from the amounts
 * to two decimals, the largest share taking the rest so they make 100).
 */
export function prefillShares(
  expense: Pick<GroupExpense, "splitMethod" | "shares">,
  locale: string,
): { method: ExpenseGroupSplitMethod; values: Record<number, string> } {
  const shares = expense.shares.map((share) => ({
    memberKey: share.expenseGroupMemberKey,
    units: abs(amountToUnits(share.amount)),
  }));
  const values: Record<number, string> = {};
  if (expense.splitMethod === "amounts") {
    for (const share of shares) {
      values[share.memberKey] = formatUnitsForInput(share.units, locale);
    }
  } else if (expense.splitMethod === "percentages") {
    const total = shares.reduce((sum, share) => sum + share.units, 0n);
    let largest = 0;
    shares.forEach((share, index) => {
      if (share.units > shares[largest]!.units) largest = index;
    });
    const hundredths = shares.map((share) =>
      total === 0n
        ? 0n
        : (share.units * WHOLE_PERCENT * 2n + total) / (2n * total),
    );
    hundredths[largest] =
      WHOLE_PERCENT -
      hundredths.reduce(
        (sum, value, index) => (index === largest ? sum : sum + value),
        0n,
      );
    shares.forEach((share, index) => {
      values[share.memberKey] = formatWireDecimalInput(
        unitsToDecimal(hundredths[index]! * CENT),
        locale,
      );
    });
  } else {
    for (const share of shares) values[share.memberKey] = "";
  }
  return { method: expense.splitMethod, values };
}

// ---------------------------------------------------------------------------------------------
// Balances and wording
// ---------------------------------------------------------------------------------------------

export type BalanceStatus = "owed" | "owes" | "settled";

/** Positive: the group owes them; negative: they owe the group; under a unit: square. */
export function balanceStatus(amount: number): BalanceStatus {
  const value = amountToUnits(amount);
  if (value > 0n) return "owed";
  if (value < 0n) return "owes";
  return "settled";
}

/** The currencies where the viewer is not square, in the API's order. */
export function nonZeroBalances(balances: CurrencyAmount[]): CurrencyAmount[] {
  return balances.filter(
    (balance) => balanceStatus(balance.amount) !== "settled",
  );
}

export type PaymentPerspective = "you-owe" | "owes-you" | "others";

/** How a payment reads: "You owe Ana", "Ana owes you", or "Ana owes Rui". */
export function paymentPerspective(
  payment: Pick<SuggestedPayment, "fromMemberKey" | "toMemberKey">,
  members: ExpenseGroupMember[],
): PaymentPerspective {
  const you = members.find((member) => member.isYou)?.expenseGroupMemberKey;
  if (you !== undefined && payment.fromMemberKey === you) return "you-owe";
  if (you !== undefined && payment.toMemberKey === you) return "owes-you";
  return "others";
}

/** A member by key; the name stays readable for a person since removed. */
export function memberName(
  members: ExpenseGroupMember[],
  memberKey: number,
): string {
  return (
    members.find((member) => member.expenseGroupMemberKey === memberKey)
      ?.name ?? "—"
  );
}

/**
 * A settlement may be linked to a real transaction only when money crosses the household's
 * edge: exactly one of the two people is someone of the household.
 */
export function canLinkSettlement(
  members: ExpenseGroupMember[],
  fromMemberKey: number,
  toMemberKey: number,
): boolean {
  const isHousehold = (key: number) =>
    members.find((member) => member.expenseGroupMemberKey === key)
      ?.isHouseholdMember === true;
  if (fromMemberKey === toMemberKey) return false;
  return isHousehold(fromMemberKey) !== isHousehold(toMemberKey);
}

/** Who paid, by default: the viewer when they are in the group, else its first household member. */
export function defaultPayerKey(members: ExpenseGroupMember[]): number | null {
  const household = members.filter((member) => member.isHouseholdMember);
  return (
    (household.find((member) => member.isYou) ?? household[0])
      ?.expenseGroupMemberKey ?? null
  );
}

/** Active groups first, archived ones apart, each in the API's order (newest first). */
export function partitionGroups(groups: ExpenseGroup[]): {
  active: ExpenseGroup[];
  archived: ExpenseGroup[];
} {
  return {
    active: groups.filter((group) => !group.archived),
    archived: groups.filter((group) => group.archived),
  };
}

// ---------------------------------------------------------------------------------------------
// The transaction side
// ---------------------------------------------------------------------------------------------

/** The group a transaction is shared in (a split line names one of its people), or null. */
export function sharedGroupOf(
  transaction: Pick<Transaction, "splits">,
): number | null {
  const line = (transaction.splits ?? []).find(
    (split) => split.expenseGroupMember,
  );
  return line?.expenseGroupMember?.expenseGroupKey ?? null;
}

export type GroupShareBlocker =
  "unavailable" | "transfer" | "loan-repayment" | "reimbursement" | "zero";

/**
 * Why a transaction cannot be shared in a group, or null when it can. A transaction plays one
 * part at a time (the API answers 409 `expense_group_transaction_conflict` otherwise): never a
 * transfer between own accounts, a loan repayment, or a reimbursement link. A settlement's
 * linked transaction is refused by the API, which the row does not say.
 */
export function groupShareBlocker(
  transaction: Pick<
    Transaction,
    | "transactionKey"
    | "transactionTypeKey"
    | "loanRepayment"
    | "reimbursements"
    | "settlementAmount"
    | "editedSettlementAmount"
  >,
): GroupShareBlocker | null {
  if (transaction.transactionKey <= 0) return "unavailable";
  if (isTransferType(transaction.transactionTypeKey?.name)) return "transfer";
  if (transaction.loanRepayment) return "loan-repayment";
  if ((transaction.reimbursements ?? []).length > 0) return "reimbursement";
  const amount = Number(
    transaction.editedSettlementAmount ?? transaction.settlementAmount,
  );
  if (!Number.isFinite(amount) || amountToUnits(amount) === 0n) return "zero";
  return null;
}

/** A transaction's amount as the API shares it: the user's edit wins. In units. */
export function shareTotalUnits(
  transaction: Pick<Transaction, "settlementAmount" | "editedSettlementAmount">,
): bigint {
  return amountToUnits(
    Number(transaction.editedSettlementAmount ?? transaction.settlementAmount),
  );
}

// ---------------------------------------------------------------------------------------------
// Editing a group
// ---------------------------------------------------------------------------------------------

/**
 * What an "Edit group" draft changes, as the `PATCH` body: only the fields that differ, the name
 * trimmed and the currency upper-cased as the API stores them; null when nothing changes. The
 * name must not be blank (the form checks it first). The API takes any known currency at any
 * time: it only sets what new settlements default to, and recorded ones keep their own.
 */
export function groupEditChanges(
  group: Pick<ExpenseGroup, "name" | "currencyCode">,
  draft: { name: string; currencyCode: string },
): UpdateExpenseGroupInput | null {
  const name = draft.name.trim();
  const currencyCode = draft.currencyCode.trim().toUpperCase();
  const changes: UpdateExpenseGroupInput = {
    ...(name !== group.name ? { name } : {}),
    ...(currencyCode !== group.currencyCode ? { currencyCode } : {}),
  };
  return Object.keys(changes).length > 0 ? changes : null;
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export type ExpenseGroupErrorKey =
  | "not-found"
  | "shares-invalid"
  | "transaction-conflict"
  | "transaction-in-group"
  | "settlement-invalid"
  | "currency-mismatch"
  | "amount-exceeded"
  | "member-invalid"
  | "member-in-use"
  | "not-empty"
  | "account-read-only";

/** The message for a refused group write, by the API's error code; null for anything else. */
export function expenseGroupErrorKey(
  error: unknown,
): ExpenseGroupErrorKey | null {
  switch (getApiErrorCode(error)) {
    case API_ERROR_CODE.NOT_FOUND:
      return "not-found";
    case API_ERROR_CODE.EXPENSE_GROUP_SHARES_INVALID:
      return "shares-invalid";
    case API_ERROR_CODE.EXPENSE_GROUP_TRANSACTION_CONFLICT:
      return "transaction-conflict";
    case API_ERROR_CODE.TRANSACTION_IN_EXPENSE_GROUP:
      return "transaction-in-group";
    case API_ERROR_CODE.EXPENSE_GROUP_SETTLEMENT_INVALID:
      return "settlement-invalid";
    case API_ERROR_CODE.EXPENSE_GROUP_CURRENCY_MISMATCH:
      return "currency-mismatch";
    case API_ERROR_CODE.EXPENSE_GROUP_AMOUNT_EXCEEDED:
      return "amount-exceeded";
    case API_ERROR_CODE.EXPENSE_GROUP_MEMBER_INVALID:
      return "member-invalid";
    case API_ERROR_CODE.EXPENSE_GROUP_MEMBER_IN_USE:
      return "member-in-use";
    case API_ERROR_CODE.EXPENSE_GROUP_NOT_EMPTY:
      return "not-empty";
    case API_ERROR_CODE.ACCOUNT_READ_ONLY:
      return "account-read-only";
    default:
      return null;
  }
}
