/**
 * The IMI guide's content for one locale (PropertyTaxGuide.astro): the worked example's values
 * and figures, the method's formulas, its notes and assumptions. Every figure comes from
 * `computePropertyTax` on the example the calculator starts from.
 */
import { CalendarDays, House, Percent, Receipt } from "lucide-react";
import { EBF_46, PROPERTY_TAX_EXAMPLE, computePropertyTax } from "@/lib/calculators/propertyTax";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import { fraction, number, operator, variable, type GuideFigure, type GuideFormulaLine, type GuideTerm } from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const PROPERTY_TAX_GUIDE_IDS = {
  tax: "property-tax-note-tax",
  family: "property-tax-note-family",
  minimum: "property-tax-note-minimum",
  payment: "property-tax-note-payment",
  budget: "property-tax-note-budget",
  rate: "property-tax-note-rate",
  scope: "property-tax-note-scope",
  educational: "property-tax-note-educational",
} as const;

export function buildPropertyTaxGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.propertyTax.${key}`);
  const guide = (key: string) => t(`tools.propertyTax.guide.${key}`);
  const ids = PROPERTY_TAX_GUIDE_IDS;

  const example = computePropertyTax(PROPERTY_TAX_EXAMPLE);
  if (!example.ok) throw new Error("Invalid property tax worked example");
  const { annualTax, monthlyProvision, schedule } = example.result;

  const money = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });
  const values = {
    vpt: money(PROPERTY_TAX_EXAMPLE.vpt, 0),
    rate: formatPercent(locale, PROPERTY_TAX_EXAMPLE.rate, { decimals: 2 }),
    tax: money(annualTax),
    instalment: money(schedule[0].amount),
    monthly: money(monthlyProvision),
  };
  const exemptionValues = {
    ebfYears: String(EBF_46.years),
    ebfExtraYears: String(EBF_46.extensionYears),
    ebfVpt: money(EBF_46.vptMax, 0),
    ebfIncome: money(EBF_46.incomeMax, 0),
  };

  // The VPT times the municipal rate is the year's IMI.
  const tax: GuideFigure[] = [
    { label: tool("fields.vpt"), value: money(PROPERTY_TAX_EXAMPLE.vpt), icon: House },
    { label: tool("fields.rate"), value: values.rate, icon: Percent },
    { label: tool("result.annualTax"), value: values.tax, icon: Receipt },
  ];

  // When it is paid: one card per instalment.
  const instalments: GuideFigure[] = schedule.map((entry) => ({
    label: tool(`months.${entry.month}`),
    value: money(entry.amount),
    icon: CalendarDays,
  }));

  const annual = () => variable(tool("result.annualTax"), ids.tax);
  const formulas: GuideFormulaLine[] = [
    {
      result: annual(),
      expression: [
        variable(tool("fields.vpt"), ids.scope),
        operator("×"),
        variable(tool("fields.rate"), ids.rate),
        operator("−"),
        variable(tool("result.deduction"), ids.family),
      ],
    },
    {
      result: variable(guide("terms.budget"), ids.budget),
      expression: [fraction([annual()], [number(formatNumber(locale, 12))])],
    },
  ];

  const note = (key: keyof typeof ids, textKey: string): GuideTerm => ({
    term: guide(`terms.${key}`),
    body: guide(textKey),
    id: ids[key],
  });
  const notes: GuideTerm[] = [
    note("tax", "methodTax"),
    note("family", "methodFamily"),
    note("minimum", "methodMinimum"),
    note("payment", "methodPayment"),
    note("budget", "methodBudget"),
  ];
  const assumptions: GuideTerm[] = [
    note("rate", "assumptionRate"),
    note("scope", "assumptionScope"),
    note("educational", "assumptionEducational"),
  ];

  return { values, exemptionValues, tax, instalments, formulas, notes, assumptions };
}
