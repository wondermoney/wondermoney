/**
 * The buy versus rent guide's content for one locale (BuyVsRentGuide.astro): how to read the
 * result as a term list, the worked example's values and figures, and the method's notes and
 * formulas. Every figure comes from `computeBuyVsRent` on the example the calculator starts
 * from.
 */
import { BadgePercent, House, Landmark, PiggyBank, Scale, Wallet } from "lucide-react";
import {
  BUY_VS_RENT_EXAMPLE,
  BUY_VS_RENT_EXAMPLE_ALTERNATIVE_RENT,
  BUY_VS_RENT_LIMITS,
  computeBuyVsRent,
  type BuyVsRentInput,
  type BuyVsRentResult,
} from "@/lib/calculators/buyVsRent";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  group,
  number,
  operator,
  variable,
  type GuideFigure,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const BUY_VS_RENT_GUIDE_IDS = {
  start: "buy-vs-rent-note-start",
  loan: "buy-vs-rent-note-loan",
  monthly: "buy-vs-rent-note-monthly",
  growth: "buy-vs-rent-note-growth",
  returns: "buy-vs-rent-note-returns",
  netWorth: "buy-vs-rent-note-net-worth",
} as const;

function calculate(input: BuyVsRentInput): BuyVsRentResult {
  const calculation = computeBuyVsRent(input);
  if (!calculation.ok) throw new Error("The buy versus rent worked example has invalid inputs");
  return calculation.result;
}

export function buildBuyVsRentGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string, values?: Record<string, string>) => t(`tools.buyVsRent.${key}`, values);
  const guide = (key: string) => t(`tools.buyVsRent.guide.${key}`);
  const ids = BUY_VS_RENT_GUIDE_IDS;

  const input = BUY_VS_RENT_EXAMPLE;
  const example = calculate(input);
  const alternative = calculate({ ...input, monthlyRent: BUY_VS_RENT_EXAMPLE_ALTERNATIVE_RENT });
  const [today] = example.years;
  const end = example.years[example.years.length - 1];

  const money = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });
  const percent = (value: number) => formatPercent(locale, value, { decimals: 0 });
  const L = BUY_VS_RENT_LIMITS;

  const values = {
    price: money(input.homePrice, 0),
    downPayment: money(input.downPayment, 0),
    downPaymentShare: percent((input.downPayment / input.homePrice) * 100),
    loan: money(example.loanAmount, 0),
    rate: formatPercent(locale, input.mortgageRate, { decimals: 1 }),
    term: formatNumber(locale, input.mortgageTermYears),
    purchaseCostsPct: percent(input.purchaseCostsPct),
    purchaseCosts: money(example.purchaseCosts, 0),
    upfront: money(example.upfrontCash, 0),
    rent: money(input.monthlyRent, 0),
    rentIncrease: percent(input.rentIncreasePct),
    appreciation: percent(input.appreciationPct),
    ownershipCostsPct: percent(input.ownershipCostsPct),
    investmentReturn: percent(input.investmentReturnPct),
    monthlyReturn: formatPercent(locale, ((1 + input.investmentReturnPct / 100) ** (1 / 12) - 1) * 100, {
      decimals: 3,
    }),
    sellingCostsPct: percent(input.sellingCostsPct),
    horizon: formatNumber(locale, input.horizonYears),
    startSellingCosts: money(today.sellingCosts, 0),
    startOwner: money(today.ownerNetWorth, 0),
    startGap: money(Math.abs(today.difference), 0),
    mortgagePayment: money(example.monthlyMortgagePayment),
    ownershipMonthly: money(example.firstMonthOwnerCost - example.monthlyMortgagePayment),
    owningMonthly: money(example.firstMonthOwnerCost),
    rentMonthly: money(example.firstMonthRent),
    monthlyGap: money(example.firstMonthOwnerCost - example.firstMonthRent),
    homeValue: money(end.homeValue),
    sellingCosts: money(end.sellingCosts),
    loanBalance: money(end.loanBalance),
    ownerNetWorth: money(example.ownerNetWorth),
    renterNetWorth: money(example.renterNetWorth),
    difference: money(Math.abs(example.difference)),
    breakEvenYear: formatNumber(locale, example.breakEvenYear ?? 0),
    altRent: money(BUY_VS_RENT_EXAMPLE_ALTERNATIVE_RENT, 0),
    altDifference: money(Math.abs(alternative.difference)),
    maxPrice: money(L.maxHomePrice, 0),
    maxRent: money(L.maxMonthlyRent, 0),
    maxHorizon: formatNumber(locale, L.maxHorizonYears),
    minGrowth: percent(L.minGrowthPct),
    maxGrowth: percent(L.maxGrowthPct),
  };

  const read: GuideTerm[] = Object.values(
    t<Record<string, { term: string; body: string }>>("tools.buyVsRent.guide.read", { returnObjects: true }),
  ).map(({ term, body }) => ({ term, body }));

  // What selling the home at the end would leave the owner (who has nothing invested here),
  // in whole euros so four cards fit a row.
  const owner: GuideFigure[] = [
    { label: tool("table.homeValue"), value: money(end.homeValue, 0), icon: House },
    { label: tool("fields.sellingCostsPct.label"), value: money(end.sellingCosts, 0), icon: BadgePercent },
    { label: tool("table.loanBalance"), value: money(end.loanBalance, 0), icon: Landmark },
    { label: tool("table.ownerNetWorth"), value: money(example.ownerNetWorth, 0), icon: Wallet },
  ];

  // The two paths at the end, and how far buying is ahead.
  const ahead = example.difference >= 0;
  const paths: GuideFigure[] = [
    { label: tool("table.ownerNetWorth"), value: values.ownerNetWorth, icon: House },
    { label: tool("table.renterNetWorth"), value: values.renterNetWorth, icon: PiggyBank },
    {
      label: tool(ahead ? "results.buyAhead" : "results.rentAhead"),
      value: values.difference,
      icon: Scale,
      tone: "positive",
    },
  ];

  const investments = () => variable(guide("labels.investments"), ids.monthly);
  const annualReturn = () => variable(tool("fields.investmentReturnPct.label"), ids.returns);
  const one = () => number(formatNumber(locale, 1));
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(tool("chartBuy"), ids.netWorth),
      expression: [
        variable(tool("table.homeValue"), ids.growth),
        operator("−"),
        variable(tool("fields.sellingCostsPct.label"), ids.netWorth),
        operator("−"),
        variable(tool("table.loanBalance"), ids.loan),
        operator("+"),
        investments(),
      ],
    },
    { result: variable(tool("chartRent"), ids.netWorth), expression: [investments()] },
    {
      result: variable(guide("formulaReturn"), ids.returns),
      expression: [
        group([one(), operator("+"), annualReturn()], [one(), operator("÷"), number(formatNumber(locale, 12))]),
        operator("−"),
        one(),
      ],
    },
  ];

  const notes: GuideTerm[] = (Object.keys(ids) as Array<keyof typeof ids>).map((key) => ({
    term: guide(`methodTerms.${key}`),
    body: guide(`method.${key}`),
    id: ids[key],
  }));

  return { values, read, owner, paths, formulas, notes };
}
