/**
 * The youth mortgage guide's content for one locale (YouthMortgageGuide.astro): the worked
 * example's values and figures, the method's formulas with the notes they link to, and the
 * guarantee's conditions and the assumptions as term lists. Every figure comes from
 * `computeYouthMortgage` on the example the calculator starts from.
 */
import { CalendarClock, Landmark, Receipt, Wallet } from "lucide-react";
import { YOUTH_GUARANTEE, YOUTH_MORTGAGE_EXAMPLE, computeYouthMortgage } from "@/lib/calculators/youthMortgage";
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
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const YOUTH_MORTGAGE_GUIDE_IDS = {
  payment: "youth-mortgage-note-payment",
  taxes: "youth-mortgage-note-taxes",
  cash: "youth-mortgage-note-cash",
  guarantee: "youth-mortgage-note-guarantee",
  banks: "youth-mortgage-note-banks",
  rate: "youth-mortgage-note-rate",
  assumptionTaxes: "youth-mortgage-note-assumption-taxes",
  scope: "youth-mortgage-note-scope",
} as const;

const CONDITIONS = ["Age", "Home", "Property", "Price", "Income", "Date"] as const;

export function buildYouthMortgageGuide(locale: Lang) {
  const t = getTranslations(locale);
  const result = (key: string) => t(`tools.youthMortgage.result.${key}`);
  const field = (key: string) => t(`tools.youthMortgage.fields.${key}`);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.youthMortgage.guide.${key}`, values);
  const ids = YOUTH_MORTGAGE_GUIDE_IDS;

  const example = computeYouthMortgage(YOUTH_MORTGAGE_EXAMPLE);
  if (!example.ok) throw new Error("Invalid youth mortgage worked example");
  const money = (value: number, decimals = 0) => formatMoney(locale, value, { decimals });
  const { price, annualRate, termYears } = YOUTH_MORTGAGE_EXAMPLE;
  const values = {
    price: money(price),
    rate: formatPercent(locale, annualRate, { decimals: 2 }),
    years: String(termYears),
    loan: money(example.result.loan),
    monthly: money(example.result.monthlyPayment, 2),
    taxesWithout: money(example.result.taxesWithout, 2),
    taxesWith: money(example.result.taxesWithYoung, 2),
    cash: money(example.result.cashWithYoung, 2),
    date: YOUTH_GUARANTEE.reviewedOn,
    maxAge: String(YOUTH_GUARANTEE.maxAge),
    minAge: String(YOUTH_GUARANTEE.minAge),
    maxPrice: money(YOUTH_GUARANTEE.maxPrice),
    maxIncome: money(YOUTH_GUARANTEE.maxIncome),
    percent: String(YOUTH_GUARANTEE.guaranteePercent),
  };

  // The loan and its payment, then the taxes without and with the young exemption.
  const loan: GuideFigure[] = [
    { label: result("loan"), value: money(example.result.loan, 2), icon: Landmark },
    { label: result("monthly"), value: values.monthly, icon: CalendarClock },
  ];
  const taxes: GuideFigure[] = [
    { label: result("taxesWithout"), value: values.taxesWithout, icon: Receipt },
    { label: result("taxesWith"), value: values.taxesWith, icon: Receipt, tone: "positive" },
    { label: result("cashWith"), value: values.cash, icon: Wallet },
  ];

  const monthlyRate = () => variable(t("tools.mortgage.guide.labels.monthlyRate"), ids.rate);
  const loanVar = () => variable(result("loan"), ids.payment);
  const one = () => number(formatNumber(locale, 1));
  const formulas: GuideFormulaLine[] = [
    {
      result: loanVar(),
      expression: [variable(field("price"), ids.payment), operator("−"), variable(field("deposit"), ids.payment)],
    },
    {
      result: variable(result("ltv"), ids.guarantee),
      expression: [fraction([loanVar()], [variable(field("price"), ids.payment)]), operator("×"), number(formatNumber(locale, 100))],
    },
    {
      result: monthlyRate(),
      expression: [fraction([variable(field("annualRate"), ids.rate)], [number(formatNumber(locale, 12))])],
    },
    {
      result: variable(result("monthly"), ids.payment),
      expression: [
        fraction(
          [loanVar(), operator("×"), monthlyRate()],
          [
            one(),
            operator("−"),
            group([one(), operator("+"), monthlyRate()], [operator("−"), variable(t("tools.mortgage.guide.labels.payments"), ids.payment)]),
          ],
        ),
      ],
    },
    {
      result: variable(guide("labels.cash"), ids.cash),
      expression: [
        variable(field("deposit"), ids.cash),
        operator("+"),
        variable(guide("labels.taxes"), ids.taxes),
      ],
    },
  ];

  const note = (key: keyof typeof ids, textKey: string): GuideTerm => ({
    term: guide(`terms.${key}`),
    body: guide(textKey, values),
    id: ids[key],
  });
  const notes: GuideTerm[] = [
    note("payment", "methodPayment"),
    note("taxes", "methodTaxes"),
    note("cash", "methodCash"),
    note("guarantee", "methodGuarantee"),
  ];
  const conditions: GuideTerm[] = CONDITIONS.map((key) => ({
    term: guide(`terms.condition${key}`),
    body: guide(`condition${key}`, values),
  }));
  const assumptions: GuideTerm[] = [
    note("banks", "assumptionBanks"),
    note("rate", "assumptionRate"),
    note("assumptionTaxes", "assumptionTaxes"),
    note("scope", "assumptionScope"),
  ];

  return { values, loan, taxes, formulas, notes, conditions, assumptions };
}
