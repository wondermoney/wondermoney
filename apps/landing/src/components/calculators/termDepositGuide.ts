/**
 * The term deposit guide's content for one locale (TermDepositGuide.astro): the "how to read"
 * terms, the worked example's values and figures, the method's formulas and its notes. Every
 * figure comes from `computeTermDeposit` on the worked example, so the guide can never quote
 * other numbers than the calculator shows.
 */
import { Coins, Landmark, Percent, PiggyBank, Receipt, Wallet } from "lucide-react";
import {
  TERM_DEPOSIT_EXAMPLE,
  TERM_DEPOSIT_LIMITS,
  computeTermDeposit,
  type TermDepositInput,
  type TermDepositResult,
} from "@/lib/calculators/termDeposit";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  fraction,
  group,
  number,
  operator,
  variable,
  type GuideFigure,
  type GuideFlowOperator,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the terms and notes the formulas link to: the same in every locale. */
export const TERM_DEPOSIT_GUIDE_IDS = {
  gross: "term-deposit-gross",
  tax: "term-deposit-tax",
  net: "term-deposit-net",
  final: "term-deposit-final",
  yield: "term-deposit-yield",
  maturity: "term-deposit-note-maturity",
  periodic: "term-deposit-note-periodic",
  reinvest: "term-deposit-note-reinvest",
  taxNote: "term-deposit-note-tax",
  yieldNote: "term-deposit-note-yield",
  excluded: "term-deposit-note-excluded",
  privacy: "term-deposit-note-privacy",
} as const;

/** The example on its three steps: paid at maturity, quarterly and reinvested, then taxed. */
export function termDepositExampleResults(): {
  atMaturity: TermDepositResult;
  compounded: TermDepositResult;
  taxed: TermDepositResult;
} {
  const example = TERM_DEPOSIT_EXAMPLE;
  const calculate = (overrides: Partial<TermDepositInput> = {}): TermDepositResult => {
    const calculation = computeTermDeposit({ ...example, ...overrides });
    if (!calculation.ok) throw new Error("The term deposit worked example has invalid inputs");
    return calculation.result;
  };
  return {
    atMaturity: calculate(),
    compounded: calculate({ payout: example.comparePayout, reinvest: true }),
    taxed: calculate({ taxRate: example.exampleTaxRate }),
  };
}

export type TermDepositGuideContent = {
  values: Record<string, string>;
  readTerms: GuideTerm[];
  maturityFlow: GuideFigure[];
  maturityOperators: GuideFlowOperator[];
  taxFlow: GuideFigure[];
  taxOperators: GuideFlowOperator[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
};

export function buildTermDepositGuide(locale: Lang): TermDepositGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.termDeposit.${key}`);
  const guide = (key: string) => t(`tools.termDeposit.guide.${key}`);
  const ids = TERM_DEPOSIT_GUIDE_IDS;

  const example = TERM_DEPOSIT_EXAMPLE;
  const { atMaturity, compounded, taxed } = termDepositExampleResults();
  const money = (value: number) => formatMoney(locale, value, { decimals: Number.isInteger(value) ? 0 : 2 });
  const percent = (value: number, decimals = 2) => formatPercent(locale, value, { decimals });

  const values = {
    amount: money(example.amount),
    rate: percent(example.annualRate, Number.isInteger(example.annualRate) ? 0 : 2),
    months: formatNumber(locale, example.termMonths),
    gross: money(atMaturity.grossInterest),
    final: money(atMaturity.finalBalance),
    yield: percent(atMaturity.effectiveAnnualNetYield),
    compoundedPayments: formatNumber(locale, compounded.payments.length),
    compoundedGross: money(compounded.grossInterest),
    compoundedFinal: money(compounded.finalBalance),
    compoundedYield: percent(compounded.effectiveAnnualNetYield),
    compoundedExtra: money(Math.round((compounded.grossInterest - atMaturity.grossInterest) * 100) / 100),
    taxRate: percent(example.exampleTaxRate, 0),
    tax: money(taxed.tax),
    net: money(taxed.netInterest),
    taxedFinal: money(taxed.finalBalance),
    taxedYield: percent(taxed.effectiveAnnualNetYield),
    maxMonths: formatNumber(locale, TERM_DEPOSIT_LIMITS.maxTermMonths),
  };

  const maturityFlow: GuideFigure[] = [
    { label: tool("amount"), value: values.amount, icon: Wallet },
    {
      label: tool("grossInterest"),
      value: values.gross,
      icon: Coins,
      detail: `${values.amount} × ${values.rate} × ${values.months} ÷ ${formatNumber(locale, 12)}`,
    },
    { label: tool("finalBalance"), value: values.final, icon: Landmark },
  ];

  const taxFlow: GuideFigure[] = [
    { label: tool("grossInterest"), value: values.gross, icon: Coins },
    { label: tool("tax"), value: values.tax, icon: Receipt, detail: `${values.gross} × ${values.taxRate}` },
    { label: tool("netInterest"), value: values.net, icon: PiggyBank, tone: "positive" },
    { label: tool("netYield"), value: values.taxedYield, icon: Percent },
  ];

  const f = (key: string) => guide(`formula.${key}`);
  const interest = () => variable(f("interestLower"), ids.periodic);
  const tax = () => variable(f("taxLower"), ids.taxNote);
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(f("interest"), ids.periodic),
      expression: [
        variable(f("balance"), ids.reinvest),
        operator("×"),
        variable(f("annualRate"), ids.maturity),
        operator("×"),
        fraction([variable(f("periodMonths"), ids.periodic)], [number(formatNumber(locale, 12))]),
      ],
    },
    {
      result: variable(f("tax"), ids.taxNote),
      expression: [interest(), operator("×"), variable(f("taxRate"), ids.tax)],
    },
    {
      result: variable(f("netInterest"), ids.net),
      expression: [interest(), operator("−"), tax()],
    },
    {
      result: variable(f("yield"), ids.yieldNote),
      expression: [
        group(
          [fraction([variable(f("finalBalance"), ids.final)], [variable(f("amount"), ids.maturity)])],
          [number(formatNumber(locale, 12)), operator("÷"), variable(f("termMonths"), ids.maturity)],
        ),
        operator("−"),
        number(formatNumber(locale, 1)),
      ],
    },
  ];

  const term = (key: string, id: string): GuideTerm => ({
    term: guide(`${key}Term`),
    body: guide(`${key}Body`),
    id,
  });

  return {
    values,
    readTerms: [
      term("read.gross", ids.gross),
      term("read.tax", ids.tax),
      term("read.net", ids.net),
      term("read.final", ids.final),
      term("read.yield", ids.yield),
    ],
    maturityFlow,
    maturityOperators: ["+", "="],
    taxFlow,
    taxOperators: ["−", "=", "→"],
    formulas,
    notes: [
      term("method.maturity", ids.maturity),
      term("method.periodic", ids.periodic),
      term("method.reinvest", ids.reinvest),
      term("method.tax", ids.taxNote),
      term("method.yield", ids.yieldNote),
      term("method.excluded", ids.excluded),
      term("method.privacy", ids.privacy),
    ],
  };
}
