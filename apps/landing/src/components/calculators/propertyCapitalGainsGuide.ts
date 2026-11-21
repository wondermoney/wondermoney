/**
 * The property capital gains guide's content for one locale (PropertyCapitalGainsGuide.astro):
 * the worked example's values and figures, the method's formulas with the notes they link to,
 * the scope and the assumptions. Every figure comes from `computeCapitalGains` on the example
 * the calculator starts from.
 */
import { BadgePercent, House, Landmark, Receipt, TrendingUp, X } from "lucide-react";
import {
  CAPITAL_GAINS_EXAMPLE,
  CAPITAL_GAINS_TABLES,
  computeCapitalGains,
} from "@/lib/calculators/propertyCapitalGains";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import { number, operator, variable, type GuideFigure, type GuideFormulaLine, type GuideTerm } from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const PROPERTY_CAPITAL_GAINS_GUIDE_IDS = {
  gain: "capital-gains-note-gain",
  taxValue: "capital-gains-note-tax-value",
  coefficient: "capital-gains-note-coefficient",
  expenses: "capital-gains-note-expenses",
  half: "capital-gains-note-half",
  exemption: "capital-gains-note-exemption",
  cash: "capital-gains-note-cash",
  brackets: "capital-gains-note-brackets",
  notModelled: "capital-gains-note-not-modelled",
  educational: "capital-gains-note-educational",
} as const;

export function buildPropertyCapitalGainsGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.propertyCapitalGains.${key}`);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.propertyCapitalGains.guide.${key}`, values);
  const ids = PROPERTY_CAPITAL_GAINS_GUIDE_IDS;

  const example = computeCapitalGains(CAPITAL_GAINS_EXAMPLE);
  if (!example.ok) throw new Error("Invalid property capital gains worked example");
  const { result } = example;

  const money = (value: number) => formatMoney(locale, value, { decimals: 0 });
  const coefficient = formatNumber(locale, result.coefficient, 2);
  const inclusion = formatPercent(locale, CAPITAL_GAINS_TABLES.inclusionBp / 100, { decimals: 0 });
  const values = {
    saleValue: money(CAPITAL_GAINS_EXAMPLE.saleValue),
    purchaseValue: money(CAPITAL_GAINS_EXAMPLE.purchaseValue),
    purchaseYear: String(CAPITAL_GAINS_EXAMPLE.purchaseYear),
    coefficient,
    adjustedPurchase: money(result.adjustedPurchase),
    expenses: money(result.expenses),
    gain: money(result.gain),
    included: money(result.includedIncome),
    otherIncome: money(CAPITAL_GAINS_EXAMPLE.otherIncome),
    extraTax: money(result.extraTax),
    saleYear: String(CAPITAL_GAINS_TABLES.saleYear),
    firstYear: String(CAPITAL_GAINS_TABLES.firstYear),
    portaria: CAPITAL_GAINS_TABLES.portaria,
    reviewed: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(CAPITAL_GAINS_TABLES.reviewed),
    ),
  };

  // The acquisition value brought up to date by the coefficient.
  const update: GuideFigure[] = [
    { label: tool("fields.purchaseValue"), value: values.purchaseValue, icon: House },
    { label: tool("result.coefficient"), value: `×${coefficient}`, icon: X },
    { label: tool("result.adjustedPurchase"), value: values.adjustedPurchase, icon: House },
  ];

  // The gain: the sale value less the updated acquisition value and the expenses.
  const gain: GuideFigure[] = [
    { label: tool("fields.saleValue"), value: values.saleValue, icon: Landmark },
    { label: tool("result.adjustedPurchase"), value: values.adjustedPurchase, icon: House },
    { label: tool("result.expenses"), value: values.expenses, icon: Receipt },
    { label: tool("result.gain"), value: values.gain, icon: TrendingUp },
  ];

  // Half the gain joins the year's income, and the IRS that adds.
  const tax: GuideFigure[] = [
    { label: tool("result.includedIncome"), value: values.included, icon: BadgePercent },
    { label: tool("result.extraTax"), value: values.extraTax, icon: Receipt, tone: "negative" },
  ];

  const adjusted = () => variable(tool("result.adjustedPurchase"), ids.coefficient);
  const gainVar = () => variable(tool("result.gain"), ids.gain);
  const formulas: GuideFormulaLine[] = [
    {
      result: adjusted(),
      expression: [
        variable(tool("fields.purchaseValue"), ids.gain),
        operator("×"),
        variable(tool("result.coefficient"), ids.coefficient),
      ],
    },
    {
      result: gainVar(),
      expression: [
        variable(tool("result.realizationValue"), ids.taxValue),
        operator("−"),
        adjusted(),
        operator("−"),
        variable(tool("result.expenses"), ids.expenses),
      ],
    },
    {
      result: variable(guide("labels.included"), ids.half),
      expression: [variable(tool("result.taxableGain"), ids.exemption), operator("×"), number(inclusion)],
    },
    {
      result: variable(tool("result.extraTax"), ids.half),
      expression: [
        variable(guide("labels.irsWith"), ids.brackets),
        operator("−"),
        variable(guide("labels.irsWithout"), ids.brackets),
      ],
    },
    {
      result: variable(guide("labels.cashAfter"), ids.cash),
      expression: [
        variable(tool("fields.saleValue"), ids.cash),
        operator("−"),
        variable(tool("fields.saleExpenses"), ids.expenses),
        operator("−"),
        variable(tool("fields.loanRepaid"), ids.cash),
        operator("−"),
        variable(tool("result.extraTax"), ids.half),
      ],
    },
  ];

  const note = (key: keyof typeof ids, textKey: string): GuideTerm => ({
    term: guide(`terms.${key}`),
    body: guide(textKey, values),
    id: ids[key],
  });
  const notes: GuideTerm[] = [
    note("gain", "methodGain"),
    note("taxValue", "methodTaxValue"),
    note("coefficient", "methodCoefficient"),
    note("expenses", "methodExpenses"),
    note("half", "methodHalf"),
    note("exemption", "methodExemption"),
    note("cash", "methodCash"),
  ];
  const scope: GuideTerm[] = [
    { term: guide("terms.supported"), body: guide("scopeSupported", values) },
    { term: guide("scopeUnsupportedTerm"), body: guide("scopeUnsupportedBody", values) },
  ];
  const assumptions: GuideTerm[] = [
    note("brackets", "assumptionBrackets"),
    note("notModelled", "assumptionNotModelled"),
    note("educational", "assumptionEducational"),
  ];

  return { values, update, gain, tax, formulas, notes, scope, assumptions };
}
