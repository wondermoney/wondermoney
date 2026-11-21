/**
 * The gold price guide's content for one locale (GoldPriceGuide.astro): the worked example's
 * values and figures, computed by `computeGoldValue` at the page's latest price, the purities
 * and the method's steps as term lists, the method's formulas, and what the value leaves out.
 */
import { Gem, Scale, Weight } from "lucide-react";
import {
  GOLD_PRICE_SOURCE,
  GOLD_PURITIES,
  computeGoldValue,
  goldPriceSummary,
  goldValueExample,
} from "@/lib/calculators/goldValue";
import { formatMoney, formatNumber } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  fraction,
  number,
  operator,
  variable,
  type GuideFigure,
  type GuideFlowOperator,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the method's steps, which the formulas link to: the same in every locale. */
export const GOLD_PRICE_GUIDE_IDS = {
  price: "gold-price-note-price",
  pureGold: "gold-price-note-pure-gold",
  value: "gold-price-note-value",
  offer: "gold-price-note-offer",
} as const;

export function goldPriceExampleResults() {
  const example = goldValueExample();
  const outcome = computeGoldValue(example);
  if (!outcome.ok) throw new Error("The gold value worked example has invalid inputs");
  const ring = computeGoldValue({ ...example, grams: 4, purity: "k18" });
  if (!ring.ok) throw new Error("The gold ring example has invalid inputs");
  return { example, result: outcome.result, ring: ring.result };
}

export type GoldPriceGuideContent = {
  values: Record<string, string>;
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  purities: GuideTerm[];
  formulas: GuideFormulaLine[];
  steps: GuideTerm[];
  limits: GuideTerm[];
  /** The last limit, a sentence without a term. */
  limitsNote: string;
};

export function buildGoldPriceGuide(locale: Lang): GoldPriceGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string, values?: Record<string, string | number>) => t(`tools.goldPrice.${key}`, values);
  const guide = (key: string) => t(`tools.goldPrice.guide.${key}`);
  const ids = GOLD_PRICE_GUIDE_IDS;
  const { example, result, ring } = goldPriceExampleResults();
  const summary = goldPriceSummary();

  const euro = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });
  const grams = (value: number) => `${formatNumber(locale, value)} g`;
  const values = {
    grams: grams(example.grams),
    price: `${euro(example.price)}/g`,
    pureGrams: grams(result.pureGrams),
    value: euro(result.value),
    ringValue: euro(ring.value),
    ringPure: grams(ring.pureGrams),
    ounce: euro(summary.eurPerOunce, 0),
    asOf: GOLD_PRICE_SOURCE.asOf,
    fetched: GOLD_PRICE_SOURCE.fetchedOn,
  };

  const purity = GOLD_PURITIES.find((candidate) => candidate.id === example.purity) ?? GOLD_PURITIES[0];
  const flow: GuideFigure[] = [
    {
      label: tool("fields.grams"),
      value: values.grams,
      icon: Weight,
      detail: tool(`purities.${purity.id}`, {
        karat: formatNumber(locale, purity.karat, purity.karat % 1 ? 1 : 0),
        fineness: purity.fineness,
      }),
      detailText: true,
    },
    {
      label: tool("result.pureGrams"),
      value: values.pureGrams,
      icon: Scale,
      detail: `${values.grams} × ${purity.fineness} ÷ ${formatNumber(locale, 1000)}`,
    },
    {
      label: tool("result.value"),
      value: values.value,
      icon: Gem,
      detail: `${values.pureGrams} × ${values.price}`,
    },
  ];

  const f = (key: string) => guide(`method.formula.${key}`);
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(f("pureGold"), ids.pureGold),
      expression: [
        variable(f("weight"), ids.pureGold),
        operator("×"),
        fraction([variable(f("fineness"), ids.pureGold)], [number(formatNumber(locale, 1000))]),
      ],
    },
    {
      result: variable(f("value"), ids.value),
      expression: [variable(f("pureGoldLower"), ids.pureGold), operator("×"), variable(f("priceLower"), ids.price)],
    },
    {
      result: variable(f("price"), ids.price),
      expression: [fraction([variable(f("nbpPrice"), ids.price)], [variable(f("zlotyPerEuro"), ids.price)])],
    },
    {
      result: variable(f("offerShare"), ids.offer),
      expression: [
        fraction([variable(f("offer"), ids.offer)], [variable(f("valueLower"), ids.value)]),
        operator("×"),
        number(formatNumber(locale, 100)),
      ],
    },
  ];

  const term = (key: string, id?: string): GuideTerm => ({
    term: guide(`${key}Term`),
    body: guide(`${key}Body`),
    ...(id ? { id } : {}),
  });

  return {
    values,
    flow,
    flowOperators: ["→", "→"],
    purities: GOLD_PURITIES.map((item) => term(`purity.items.${item.id}`)),
    formulas,
    steps: [
      term("method.steps.a", ids.price),
      term("method.steps.b", ids.pureGold),
      term("method.steps.c", ids.value),
      term("method.steps.d", ids.offer),
    ],
    limits: ["metal", "buyers", "purity", "reference"].map((key) => term(`limits.items.${key}`)),
    limitsNote: guide("limits.items.education"),
  };
}
