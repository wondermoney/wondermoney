/**
 * The index projection guide's content for one locale (IndexProjectionGuide.astro, on the
 * investment return page): the worked example's values and figures, the method's formulas and
 * its notes. Every figure comes from `computeIndexProjection` on the example the projection
 * starts from.
 */
import { ReceiptText, Sprout, TrendingUp } from "lucide-react";
import { INDEX_PROJECTION_EXAMPLE, computeIndexProjection } from "@/lib/calculators/indexProjection";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { getTranslations } from "@/lib/translations";
import {
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
export const INDEX_PROJECTION_GUIDE_IDS = {
  method: "index-projection-note-method",
  assumptions: "index-projection-note-assumptions",
} as const;

export function indexProjectionExampleResult() {
  const result = computeIndexProjection(INDEX_PROJECTION_EXAMPLE);
  if (result.status !== "ok") throw new Error("Invalid index projection worked example");
  return result;
}

export type IndexProjectionGuideContent = {
  values: Record<string, string | number>;
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
};

export function buildIndexProjectionGuide(locale: Lang): IndexProjectionGuideContent {
  const t = getTranslations(locale);
  const copy = (key: string) => t(`tools.investmentReturn.projection.${key}`);
  const ids = INDEX_PROJECTION_GUIDE_IDS;
  const inputs = INDEX_PROJECTION_EXAMPLE;
  const result = indexProjectionExampleResult();
  const money = (value: number) => formatMoney(locale, value);

  const values = {
    principal: money(inputs.principal),
    monthly: money(inputs.monthlyContribution),
    years: inputs.years,
    annualRate: formatPercent(locale, inputs.annualRate),
    fee: formatPercent(locale, inputs.annualFee, { decimals: 2 }),
    beforeFees: money(result.beforeFees),
    afterFees: money(result.afterFees),
    feeImpact: money(result.feeImpact),
  };

  const flow: GuideFigure[] = [
    { label: copy("beforeFees"), value: values.beforeFees, icon: TrendingUp },
    { label: copy("feeImpact"), value: values.feeImpact, icon: ReceiptText, tone: "negative" },
    { label: copy("afterFees"), value: values.afterFees, icon: Sprout },
  ];

  const f = (key: string) => copy(`formula.${key}`);
  const one = () => number(formatNumber(locale, 1));
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(f("netFactor"), ids.method),
      expression: [
        group([one(), operator("+"), variable(f("annualReturn"), ids.assumptions)]),
        operator("×"),
        group([one(), operator("−"), variable(f("annualFee"), ids.method)]),
      ],
    },
    {
      result: variable(f("monthlyFactor"), ids.method),
      expression: [
        group([variable(f("netFactorLower"), ids.method)], [one(), operator("÷"), number(formatNumber(locale, 12))]),
      ],
    },
    {
      result: variable(f("balanceEnd"), ids.method),
      expression: [
        variable(f("balanceStart"), ids.method),
        operator("×"),
        variable(f("monthlyFactorLower"), ids.method),
        operator("+"),
        variable(f("contribution"), ids.assumptions),
      ],
    },
  ];

  return {
    values,
    flow,
    flowOperators: ["−", "="],
    formulas,
    notes: [
      { term: copy("methodTerm"), body: copy("method"), id: ids.method },
      { term: copy("assumptionsTerm"), body: copy("assumptions"), id: ids.assumptions },
    ],
  };
}
