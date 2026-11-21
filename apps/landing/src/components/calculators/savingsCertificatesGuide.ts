/**
 * The savings certificates guide's content for one locale (SavingsCertificatesGuide.astro):
 * the worked example's values and figures, the method's formulas and its notes. Every figure
 * comes from `computeSavingsCertificates` on the worked example, and the rule values from
 * SAVINGS_CERTIFICATES_RULES, so the guide never quotes other numbers than the calculator.
 */
import { Coins, Landmark, Wallet } from "lucide-react";
import {
  SAVINGS_CERTIFICATES_EXAMPLE,
  SAVINGS_CERTIFICATES_RULES,
  computeSavingsCertificates,
} from "@/lib/calculators/savingsCertificates";
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

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const SAVINGS_CERTIFICATES_GUIDE_IDS = {
  quarter: "savings-certificates-note-quarter",
  tax: "savings-certificates-note-tax",
  yield: "savings-certificates-note-yield",
} as const;

export function savingsCertificatesExampleResult() {
  const example = computeSavingsCertificates(SAVINGS_CERTIFICATES_EXAMPLE);
  if (!example.ok) throw new Error("Invalid savings certificates worked example");
  return example.result;
}

function monthLabel(lang: string, month: string) {
  return new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01`));
}

export type SavingsCertificatesGuideContent = {
  values: Record<string, string>;
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
};

export function buildSavingsCertificatesGuide(locale: Lang): SavingsCertificatesGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.savingsCertificates.${key}`);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.savingsCertificates.guide.${key}`, values);
  const ids = SAVINGS_CERTIFICATES_GUIDE_IDS;
  const rules = SAVINGS_CERTIFICATES_RULES;

  const result = savingsCertificatesExampleResult();
  const money = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });
  const pct = (value: number) => formatPercent(locale, value, { decimals: 2 });

  const values = {
    amount: money(SAVINGS_CERTIFICATES_EXAMPLE.amount, 0),
    years: formatNumber(locale, SAVINGS_CERTIFICATES_EXAMPLE.years),
    baseRate: pct(SAVINGS_CERTIFICATES_EXAMPLE.baseRate),
    grossInterest: money(result.grossInterest),
    irs: money(result.irs),
    netInterest: money(result.netInterest),
    finalValue: money(result.finalValue),
    netYield: pct(result.netAnnualYield),
    irsRate: formatPercent(locale, rules.irsRate, { decimals: 0 }),
    maxBase: pct(rules.maxBaseRate),
    termYears: formatNumber(locale, rules.termYears),
    minAmount: money(rules.minAmount, 0),
    maxAmount: money(rules.maxAmount, 0),
    rulesDate: guide("rulesDateValue"),
    referenceMonth: monthLabel(locale, rules.referenceBaseRate.month),
    referenceRate: pct(rules.referenceBaseRate.rate),
    // The monthly refresh can move the rate off the ceiling, so the page says "the ceiling" only when it is.
    referenceRateNote:
      rules.referenceBaseRate.rate === rules.maxBaseRate
        ? guide("referenceRateAtCeiling", { rate: pct(rules.referenceBaseRate.rate) })
        : pct(rules.referenceBaseRate.rate),
  };

  const flow: GuideFigure[] = [
    { label: tool("result.invested"), value: values.amount, icon: Wallet },
    {
      label: tool("result.netInterest"),
      value: values.netInterest,
      icon: Coins,
      tone: "positive",
      detail: `${values.grossInterest} − ${values.irs}`,
    },
    { label: tool("result.finalValue"), value: values.finalValue, icon: Landmark },
  ];

  const f = (key: string) => guide(`formula.${key}`);
  const interest = () => variable(f("interestLower"), ids.quarter);
  const irs = () => variable(f("irs"), ids.tax);
  const one = () => number(formatNumber(locale, 1));
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(f("quarterInterest"), ids.quarter),
      expression: [
        variable(f("balance"), ids.quarter),
        operator("×"),
        fraction(
          [variable(f("baseRate"), ids.quarter), operator("+"), variable(f("bonus"), ids.quarter)],
          [number(formatNumber(locale, 4))],
        ),
      ],
    },
    { result: irs(), expression: [interest(), operator("×"), number(values.irsRate)] },
    {
      result: variable(f("newBalance"), ids.tax),
      expression: [variable(f("balance"), ids.quarter), operator("+"), interest(), operator("−"), irs()],
    },
    {
      result: variable(f("yield"), ids.yield),
      expression: [
        group(
          [fraction([variable(f("finalValue"), ids.yield)], [variable(f("amount"), ids.yield)])],
          [one(), operator("÷"), variable(f("years"), ids.yield)],
        ),
        operator("−"),
        one(),
      ],
    },
  ];

  const note = (key: string, id: string): GuideTerm => ({
    term: guide(`${key}Term`),
    body: guide(`${key}Body`, values),
    id,
  });

  return {
    values,
    flow,
    flowOperators: ["+", "="],
    formulas,
    notes: [note("methodQuarter", ids.quarter), note("methodTax", ids.tax), note("methodYield", ids.yield)],
  };
}
