/**
 * The PPR comparison guide's content for one locale (PprComparisonGuide.astro): the values its
 * sentences quote, the four forms of PPR as a term list, and the figures of the worked
 * comparison and of the deduction example. Everything comes from the same product lists and
 * tax rules the comparison and its deduction calculator read.
 */
import { ArrowLeftRight, HandCoins, Landmark, PiggyBank } from "lucide-react";
import {
  PPR_FUNDS_SOURCE,
  PPR_INSURANCE_SOURCE,
  PPR_PRODUCTS,
  PPR_TAX_RULES,
  PPR_TAX_RULES_REVIEWED,
  pprDeduction,
  pprRedemptionRates,
  riskClassSummary,
  type PprProduct,
} from "@/lib/calculators/pprComparison";
import { createPprFormat } from "@/lib/calculators/pprFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import type { GuideFigure, GuideFlowOperator, GuideTerm } from "./guideBlocks";

export const PPR_EXAMPLE_INVESTED = 10_000;
export const PPR_DEDUCTION_EXAMPLE = { age: 40, contribution: 1750, retired: false } as const;

/**
 * The worked comparison: the risk class with the most products that publish both a yearly cost
 * and a 5-year return, and in it the lowest and the highest yearly cost.
 */
export function pprComparisonExample() {
  const comparable = PPR_PRODUCTS.filter(
    (item): item is PprProduct & { riskClass: number; yearlyCost: number } =>
      item.riskClass !== null && item.yearlyCost !== null && item.returns.y5 !== null,
  );
  const byRisk = new Map<number, typeof comparable>();
  for (const item of comparable) byRisk.set(item.riskClass, [...(byRisk.get(item.riskClass) ?? []), item]);
  const [risk, items] = [...byRisk.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0] ?? [];
  if (!risk || !items || items.length < 2) throw new Error("The worked comparison needs two products in one risk class");
  const sortedByCost = [...items].sort((a, b) => a.yearlyCost - b.yearlyCost || a.name.localeCompare(b.name, "pt"));
  const low = sortedByCost[0];
  const high = sortedByCost[sortedByCost.length - 1];
  return { risk, items, low, high, costGap: ((high.yearlyCost - low.yearlyCost) / 100) * PPR_EXAMPLE_INVESTED };
}

/** The forms of PPR the guide lists, each with the comparison's own name for its kind. */
const FORM_KINDS = {
  fund: "fund",
  linked: "insuranceLinked",
  guaranteed: "insuranceGuaranteed",
  pension: "pensionFund",
} as const;

export type PprComparisonGuideContent = {
  values: Record<string, string>;
  forms: GuideTerm[];
  comparison: GuideFigure[];
  deduction: GuideFigure[];
  deductionOperators: GuideFlowOperator[];
};

export function buildPprComparisonGuide(locale: Lang): PprComparisonGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string, values?: Record<string, string>) => t(`tools.pprComparison.${key}`, values);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.pprComparison.guide.${key}`, values);
  const format = createPprFormat(t, locale);

  const { risk, items, low, high, costGap } = pprComparisonExample();
  const summary = riskClassSummary(PPR_PRODUCTS, risk);
  const deductionExample = pprDeduction(PPR_DEDUCTION_EXAMPLE);
  const [under35, from35, over50] = PPR_TAX_RULES.limits.map((band) => format.eur(band.limit));
  const redemptionRates = pprRedemptionRates();
  const [, reduced, lowest] = redemptionRates.outside;
  if (!reduced || !lowest) throw new Error("The redemption copy quotes two reductions for long-held plans");

  const values = {
    risk: String(risk),
    count: String(items.length),
    total: String(summary.count),
    fundsYear: String(PPR_FUNDS_SOURCE.returnsYear),
    insuranceYear: String(PPR_INSURANCE_SOURCE.returnsYear),
    lowName: format.productName(low),
    lowKind: guide(`example.kinds.${low.kind}`),
    lowCost: format.percent(low.yearlyCost),
    lowReturn: format.maybePercent(low.returns.y5),
    highName: format.productName(high),
    highKind: guide(`example.kinds.${high.kind}`),
    highCost: format.percent(high.yearlyCost),
    highReturn: format.maybePercent(high.returns.y5),
    invested: format.eur(PPR_EXAMPLE_INVESTED),
    costGap: format.eur(Math.round(costGap)),
    rate: format.rate(PPR_TAX_RULES.deductionRate),
    under35,
    from35,
    over50,
    full35: format.eur(PPR_TAX_RULES.limits[0].limit / (PPR_TAX_RULES.deductionRate / 100)),
    full50: format.eur(PPR_TAX_RULES.limits[1].limit / (PPR_TAX_RULES.deductionRate / 100)),
    fullOver: format.eur(PPR_TAX_RULES.limits[2].limit / (PPR_TAX_RULES.deductionRate / 100)),
    age: String(PPR_DEDUCTION_EXAMPLE.age),
    exampleContribution: format.eur(PPR_DEDUCTION_EXAMPLE.contribution),
    exampleDeduction: format.eur(deductionExample.deduction),
    capMin: format.eur(PPR_TAX_RULES.overallCap.min),
    capMax: format.eur(PPR_TAX_RULES.overallCap.max),
    years: String(PPR_TAX_RULES.minYearsPerContribution),
    firstHalf: format.rate(PPR_TAX_RULES.firstHalfShare),
    clawback: format.rate(PPR_TAX_RULES.clawbackPerYear),
    legalRate: format.rate(PPR_TAX_RULES.legalRedemption.rate),
    legalEffective: format.rate(redemptionRates.legal),
    otherRate: format.rate(PPR_TAX_RULES.otherRedemptionRate),
    reducedAfter: String(reduced.afterYears),
    reducedRate: format.rate(reduced.rate),
    lowestAfter: String(lowest.afterYears),
    lowestRate: format.rate(lowest.rate),
    transferFee: format.rate(PPR_TAX_RULES.maxGuaranteedTransferFee),
    fundsDate: format.date(PPR_FUNDS_SOURCE.fetchedOn),
    insuranceDate: format.date(PPR_INSURANCE_SOURCE.fetchedOn),
    rulesDate: format.date(PPR_TAX_RULES_REVIEWED),
    funds: String(PPR_PRODUCTS.filter((item) => item.kind === "fund").length),
    insurance: String(PPR_PRODUCTS.filter((item) => item.kind !== "fund").length),
  };

  const forms: GuideTerm[] = Object.entries(FORM_KINDS).map(([form, kind]) => ({
    term: tool(`kinds.${kind}`),
    body: guide(`what.forms.${form}`, values),
  }));

  const product = (name: string, cost: string, fiveYears: string): GuideFigure => ({
    label: name,
    value: cost,
    detail: `${tool("labels.y5")}: ${fiveYears}`,
  });
  const comparison: GuideFigure[] = [
    { ...product(values.lowName, values.lowCost, values.lowReturn), icon: PiggyBank },
    { ...product(values.highName, values.highCost, values.highReturn), icon: Landmark },
    { label: guide("example.gapLabel", { invested: values.invested }), value: values.costGap, icon: ArrowLeftRight },
  ];

  const deduction: GuideFigure[] = [
    { label: tool("deduction.contribution"), value: values.exampleContribution, icon: HandCoins },
    {
      label: guide("tax.deductionLabel"),
      value: values.exampleDeduction,
      icon: Landmark,
      tone: "positive",
      detail: `${values.exampleContribution} × ${values.rate}`,
    },
  ];

  return { values, forms, comparison, deduction, deductionOperators: ["→"] };
}
