/**
 * The term deposit offers guide's content for one locale (TermDepositOffersGuide.astro): the
 * worked example on the highest rate listed, computed by `offerReturn` as the table computes
 * each row, and the method's steps as a term list.
 */
import { Coins, Percent, PiggyBank, Receipt } from "lucide-react";
import { DEPOSIT_TAX_RATE } from "@/lib/calculators/depositRates";
import {
  TERM_DEPOSIT_OFFERS,
  TERM_DEPOSIT_OFFERS_AS_OF,
  offerReturn,
  sortOffers,
} from "@/lib/calculators/termDepositOffers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import type { GuideFigure, GuideFlowOperator, GuideTerm } from "./guideBlocks";

export const TERM_DEPOSIT_OFFERS_EXAMPLE_AMOUNT = 10_000;

export function termDepositOffersExample() {
  const top = sortOffers(TERM_DEPOSIT_OFFERS)[0];
  const result = offerReturn(top, TERM_DEPOSIT_OFFERS_EXAMPLE_AMOUNT);
  if (!result) throw new Error("The term deposit offers worked example has invalid inputs");
  return { top, result };
}

export type TermDepositOffersGuideContent = {
  values: Record<string, string>;
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  steps: GuideTerm[];
};

export function buildTermDepositOffersGuide(locale: Lang): TermDepositOffersGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.termDepositOffers.${key}`);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.termDepositOffers.guide.${key}`, values);
  const { top, result } = termDepositOffersExample();

  const eur = (value: number) => formatMoney(locale, value, { currency: "EUR", decimals: 2 });
  const percent = (value: number) => formatPercent(locale, value, { decimals: 2 });
  const values = {
    amount: formatMoney(locale, TERM_DEPOSIT_OFFERS_EXAMPLE_AMOUNT, { currency: "EUR", decimals: 0 }),
    months: String(top.termMonths),
    rate: percent(top.tanb),
    bank: top.bank,
    gross: eur(result.grossInterest),
    net: eur(result.netInterest),
    yearly: percent(result.netAnnualYield),
    taxRate: String(DEPOSIT_TAX_RATE),
    date: TERM_DEPOSIT_OFFERS_AS_OF,
    count: String(TERM_DEPOSIT_OFFERS.length),
  };
  const tax = Math.round((result.grossInterest - result.netInterest) * 100) / 100;

  const flow: GuideFigure[] = [
    {
      label: guide("method.steps.aTerm"),
      value: values.gross,
      icon: Coins,
      detail: `${values.amount} × ${values.rate} × ${values.months} ÷ ${formatNumber(locale, 12)}`,
    },
    {
      label: guide("method.steps.bTerm"),
      value: eur(tax),
      icon: Receipt,
      detail: `${values.gross} × ${formatPercent(locale, DEPOSIT_TAX_RATE, { decimals: 0 })}`,
    },
    { label: tool("columns.netInterest"), value: values.net, icon: PiggyBank, tone: "positive" },
    { label: guide("method.steps.cTerm"), value: values.yearly, icon: Percent },
  ];

  const step = (key: string): GuideTerm => ({
    term: guide(`method.steps.${key}Term`),
    body: guide(`method.steps.${key}Body`, values),
  });

  return {
    values,
    flow,
    flowOperators: ["−", "=", "→"],
    steps: [step("a"), step("b"), step("c"), step("d")],
  };
}
