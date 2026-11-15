/**
 * Debt-to-income ratio: the share of net monthly household income that goes to
 * credit repayments. Thresholds are a general rule of thumb, not any lender's or
 * regulator's limit; those differ by country and lender.
 */

export type DebtToIncomeBand = "healthy" | "caution" | "high";

/** Below this ratio (in percent) the result reads as healthy. */
export const DEBT_TO_INCOME_CAUTION_FROM = 30;
/** Above this ratio (in percent) the result reads as high. */
export const DEBT_TO_INCOME_HIGH_ABOVE = 40;

export type DebtToIncomeParams = {
  /** Net monthly household income, after tax and social contributions. */
  monthlyIncome: number;
  /** Monthly credit repayments. */
  payments: ReadonlyArray<number>;
};

export type DebtToIncomeResult =
  | {
      status: "ok";
      totalPayments: number;
      /** Percent, rounded to one decimal. */
      ratio: number;
      band: DebtToIncomeBand;
      remainingIncome: number;
      exceedsIncome: boolean;
    }
  | {
      /** Income is zero, empty or negative: a ratio cannot be worked out. */
      status: "noIncome";
      totalPayments: number;
      ratio: null;
      band: null;
      remainingIncome: null;
      exceedsIncome: false;
    };

export type DebtPaymentRow = {
  id: string;
  amount: number;
};

export type DebtScenario =
  | { kind: "change"; paymentId: string; amount: number }
  | { kind: "add"; amount: number };

export type DebtScenarioComparison = {
  current: DebtToIncomeResult;
  scenario: DebtToIncomeResult;
  /** New ratio minus current ratio, in percentage points; null without income. */
  pointsChange: number | null;
};

/** The household the page's worked example describes; the calculator starts from it. */
export const DEBT_TO_INCOME_WORKED_EXAMPLE = {
  monthlyIncome: 2800,
  rows: [
    { id: "home", amount: 720 },
    { id: "personal", amount: 0 },
    { id: "car", amount: 210 },
    { id: "cards", amount: 70 },
    { id: "other", amount: 0 },
  ],
  scenario: { kind: "change", paymentId: "car", amount: 0 },
} as const satisfies {
  monthlyIncome: number;
  rows: ReadonlyArray<DebtPaymentRow>;
  scenario: DebtScenario;
};

function toAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function classifyDebtToIncome(ratio: number): DebtToIncomeBand {
  if (ratio < DEBT_TO_INCOME_CAUTION_FROM) return "healthy";
  if (ratio <= DEBT_TO_INCOME_HIGH_ABOVE) return "caution";
  return "high";
}

export function computeDebtToIncome(params: DebtToIncomeParams): DebtToIncomeResult {
  const totalPayments = params.payments.reduce((sum, amount) => sum + toAmount(amount), 0);
  const monthlyIncome = toAmount(params.monthlyIncome);

  if (monthlyIncome === 0) {
    return {
      status: "noIncome",
      totalPayments,
      ratio: null,
      band: null,
      remainingIncome: null,
      exceedsIncome: false,
    };
  }

  // The band follows the rounded figure so the verdict matches the number shown.
  const ratio = roundToOneDecimal((totalPayments / monthlyIncome) * 100);

  return {
    status: "ok",
    totalPayments,
    ratio,
    band: classifyDebtToIncome(ratio),
    remainingIncome: monthlyIncome - totalPayments,
    exceedsIncome: totalPayments > monthlyIncome,
  };
}

export function applyDebtScenario(
  rows: ReadonlyArray<DebtPaymentRow>,
  scenario: DebtScenario,
): number[] {
  const amounts = rows.map((row) =>
    scenario.kind === "change" && row.id === scenario.paymentId ? scenario.amount : row.amount,
  );

  return scenario.kind === "add" ? [...amounts, scenario.amount] : amounts;
}

export function compareDebtScenario(
  monthlyIncome: number,
  rows: ReadonlyArray<DebtPaymentRow>,
  scenario: DebtScenario,
): DebtScenarioComparison {
  const current = computeDebtToIncome({
    monthlyIncome,
    payments: rows.map((row) => row.amount),
  });
  const next = computeDebtToIncome({
    monthlyIncome,
    payments: applyDebtScenario(rows, scenario),
  });

  return {
    current,
    scenario: next,
    pointsChange:
      current.ratio === null || next.ratio === null
        ? null
        : roundToOneDecimal(next.ratio - current.ratio),
  };
}
