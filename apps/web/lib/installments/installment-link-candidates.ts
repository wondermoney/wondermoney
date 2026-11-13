import type {
  Installment,
  InstallmentPlanDetail,
} from "@/lib/api/installment-plans/types";

/**
 * Choosing what to link by hand: a posted card row and an installment of a plan on that card.
 *
 * The API links a row automatically only when its marker ("PARC 03/12"), amount, card and date fit
 * exactly one plan. Everything else is linked here, so the pickers offer what is likely to be the
 * same charge: a posted charge on the plan's card, within about a month of the installment's
 * scheduled day, for about the installment's amount. "Show other amounts" drops the amount rule,
 * because a bank can charge an installment with interest or a different rounding.
 */

/** How far either side of the scheduled day a posted row is still offered. */
export const LINK_WINDOW_DAYS = 31;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The most an amount may differ and still read as the installment: 10%, at least 1.00. */
export function amountTolerance(amount: number): number {
  return Math.max(1, Math.abs(amount) * 0.1);
}

/** Calendar day number of a `YYYY-MM-DD` day or of an ISO instant's UTC date. */
function dayNumber(value: string): number {
  return Math.round(Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`) / DAY_MS);
}

const cents = (amount: number) => Math.round(Math.abs(amount) * 100);

/**
 * The days to search for an installment's charge, as local calendar days (the transaction list
 * takes whole days on the viewer's calendar).
 */
export function linkSearchWindow(scheduledDate: string): {
  fromDate: Date;
  toDate: Date;
} {
  const [year, month, day] = scheduledDate
    .slice(0, 10)
    .split("-")
    .map(Number) as [number, number, number];
  return {
    fromDate: new Date(year, month - 1, day - LINK_WINDOW_DAYS),
    toDate: new Date(year, month - 1, day + LINK_WINDOW_DAYS),
  };
}

/** The fields of a transaction row the pickers read. */
export interface LinkableRow {
  transactionKey: number;
  transactionDate: string;
  settlementAmount: number;
  hidden?: boolean;
  installment?: unknown;
}

/**
 * A row that could pay an installment: a real (not synthetic opening-balance) charge, not hidden,
 * and not already paying one.
 */
export function isLinkableRow(row: LinkableRow): boolean {
  return (
    row.transactionKey > 0 &&
    row.settlementAmount < 0 &&
    row.hidden !== true &&
    !row.installment
  );
}

export interface Closeness {
  /** What the row charged, as a positive amount. */
  amount: number;
  /** Row amount minus installment amount; 0 when they agree to the cent. */
  amountDifference: number;
  /** Whole days between the row's date and the scheduled day. */
  dayDistance: number;
  /** The amount is within {@link amountTolerance}. */
  amountClose: boolean;
}

export function closeness(
  row: Pick<LinkableRow, "transactionDate" | "settlementAmount">,
  installment: Pick<Installment, "amount" | "scheduledDate">,
): Closeness {
  const amount = cents(row.settlementAmount) / 100;
  const amountDifference =
    (cents(row.settlementAmount) - cents(installment.amount)) / 100;
  return {
    amount,
    amountDifference,
    dayDistance: Math.abs(
      dayNumber(row.transactionDate) - dayNumber(installment.scheduledDate),
    ),
    amountClose:
      Math.abs(amountDifference) <= amountTolerance(installment.amount) + 1e-9,
  };
}

const byCloseness = (a: Closeness, b: Closeness) =>
  Math.abs(a.amountDifference) - Math.abs(b.amountDifference) ||
  a.dayDistance - b.dayDistance;

/**
 * The posted rows that could pay `installment`, closest first (amount, then date). Rows outside
 * the date window are dropped; rows with another amount only when `showAllAmounts` is off.
 */
export function linkCandidates<Row extends LinkableRow>(
  rows: readonly Row[],
  installment: Pick<Installment, "amount" | "scheduledDate">,
  { showAllAmounts = false }: { showAllAmounts?: boolean } = {},
): (Closeness & { row: Row })[] {
  return rows
    .filter(isLinkableRow)
    .map((row) => ({ row, ...closeness(row, installment) }))
    .filter(
      (candidate) =>
        candidate.dayDistance <= LINK_WINDOW_DAYS &&
        (showAllAmounts || candidate.amountClose),
    )
    .sort(byCloseness);
}

/** An installment a posted row could be linked to, from the plans on the row's card. */
export interface InstallmentTarget extends Closeness {
  plan: Pick<
    InstallmentPlanDetail,
    "installmentPlanKey" | "description" | "installmentCount" | "currency"
  >;
  installment: Installment;
}

/**
 * The open installments (not matched, or upcoming) of `plans` that `row` could pay, closest first.
 * Like {@link linkCandidates} the other way round: within the date window and of about the same
 * amount, or every open installment with `showAllAmounts` (a bank that dates every installment on
 * the purchase day posts far from the schedule).
 */
export function installmentTargets(
  plans: readonly InstallmentPlanDetail[],
  row: Pick<LinkableRow, "transactionDate" | "settlementAmount">,
  { showAllAmounts = false }: { showAllAmounts?: boolean } = {},
): InstallmentTarget[] {
  return plans
    .flatMap((plan) =>
      plan.installments
        .filter((installment) => installment.status !== "paid")
        .map((installment) => ({
          plan,
          installment,
          ...closeness(row, installment),
        })),
    )
    .filter(
      (target) =>
        showAllAmounts ||
        (target.dayDistance <= LINK_WINDOW_DAYS && target.amountClose),
    )
    .sort(byCloseness);
}
