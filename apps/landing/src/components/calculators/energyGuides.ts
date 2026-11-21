/**
 * The content of the energy and fuel guides for one locale: the electricity price index
 * (ElectricityIndexGuide.astro), the electricity tariff comparison
 * (ElectricityTariffComparisonGuide.astro) and fuel prices (FuelPricesGuide.astro). Each worked
 * example's figures come from the page's own calculation on the example it describes; the
 * reading notes and the method steps are the guides' own strings, each under its term.
 */
import { BadgePercent, CalendarDays, Fuel, Landmark, Receipt, Zap } from "lucide-react";
import {
  ELECTRICITY_BILL_EXAMPLE,
  computeElectricityBill,
  type ElectricityBillInput,
} from "@/lib/calculators/electricityBill";
import { computeFuelCost, fuelCostExample } from "@/lib/calculators/fuelCost";
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

type Translate = ReturnType<typeof getTranslations>;

/** A `{ term, body }` pair from the catalogue as a term list entry. */
const pair = (t: Translate, key: string, id?: string, params?: Record<string, string>): GuideTerm => ({
  term: t(`${key}.term`),
  body: t(`${key}.body`, params),
  ...(id ? { id } : {}),
});

export const ELECTRICITY_INDEX_GUIDE_IDS = {
  power: "electricity-index-note-power",
  energy: "electricity-index-note-energy",
  cav: "electricity-index-note-cav",
  iec: "electricity-index-note-iec",
  vat: "electricity-index-note-vat",
  vatRules: "electricity-index-note-vat-rules",
  bi: "electricity-index-note-bi-hourly",
} as const;

export type ElectricityIndexGuideContent = {
  readTerms: GuideTerm[];
  /** The example's three months: simple, bi-hourly, and a higher power. */
  scenarios: GuideFigure[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
};

export function buildElectricityIndexGuide(
  locale: Lang,
  values: Record<string, string>,
): ElectricityIndexGuideContent {
  const t = getTranslations(locale);
  const k = (key: string) => `tools.electricityIndex.guide.${key}`;
  const tool = (key: string) => t(`tools.electricityIndex.${key}`);
  const ids = ELECTRICITY_INDEX_GUIDE_IDS;

  const calculate = (overrides: Partial<ElectricityBillInput>) => {
    const outcome = computeElectricityBill({ ...ELECTRICITY_BILL_EXAMPLE, ...overrides });
    if (!outcome.ok) throw new Error("The electricity bill worked example has invalid inputs");
    return outcome.result;
  };
  const euro = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const setup = (kva: number, kwh: number) => `${formatNumber(locale, kva, 2)} kVA · ${formatNumber(locale, kwh, 0)} kWh`;

  const simple = calculate({});
  const bi = calculate({ option: "biHourly", offPeakPercent: 50 });
  const bigger = calculate({ contractedPower: 6.9, consumption: 300 });
  const { contractedPower, consumption } = ELECTRICITY_BILL_EXAMPLE;
  const scenarios: GuideFigure[] = [
    { label: tool("fields.optionSimple"), value: euro(simple.total), icon: Zap, detail: setup(contractedPower, consumption) },
    { label: tool("fields.optionBi"), value: euro(bi.total), icon: Zap, detail: setup(contractedPower, consumption) },
    { label: tool("fields.optionSimple"), value: euro(bigger.total), icon: Zap, detail: setup(6.9, 300) },
  ];

  const step = (key: string) => t(k(`method.steps.${key}.term`));
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(tool("result.total")),
      expression: [
        variable(step("a"), ids.power),
        operator("+"),
        variable(step("b"), ids.energy),
        operator("+"),
        variable(step("c"), ids.cav),
        operator("+"),
        variable(step("d"), ids.iec),
        operator("+"),
        variable(step("e"), ids.vat),
      ],
    },
  ];

  return {
    readTerms: [
      { term: t(k("read.estimatorTerm")), body: t(k("read.estimator")) },
      { term: t(k("read.indexTerm")), body: t(k("read.index")) },
      { term: t(k("read.marketTerm")), body: t(k("read.market")) },
    ],
    scenarios,
    formulas,
    notes: [
      pair(t, k("method.steps.a"), ids.power),
      pair(t, k("method.steps.b"), ids.energy),
      pair(t, k("method.steps.c"), ids.cav),
      pair(t, k("method.steps.d"), ids.iec),
      pair(t, k("method.steps.e"), ids.vat),
      { term: t(k("method.vatTerm")), body: t(k("method.vat"), values), id: ids.vatRules },
      { term: t(k("method.biTerm")), body: t(k("method.bi"), values), id: ids.bi },
    ],
  };
}

export type TariffComparisonGuideContent = {
  useTerms: GuideTerm[];
  /** Regulated tariff − cheapest offer = difference, in the first year. */
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  steps: GuideTerm[];
};

export function buildTariffComparisonGuide(
  locale: Lang,
  example: { regulated: number; cheapest: number },
): TariffComparisonGuideContent {
  const t = getTranslations(locale);
  const k = (key: string) => `tools.electricityTariffComparison.guide.${key}`;
  const tool = (key: string) => t(`tools.electricityTariffComparison.${key}`);
  const euro = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const firstYear = tool("results.firstYear");

  return {
    useTerms: [
      { term: t(k("use.quickTerm")), body: t(k("use.quick")) },
      { term: t(k("use.fullTerm")), body: t(k("use.full")) },
      { term: t(k("use.diagramTerm")), body: t(k("use.diagram")) },
      { term: tool("myTariff.title"), body: t(k("use.mine")) },
      { term: tool("solar.title"), body: t(k("use.solar")) },
      { term: t(k("use.optionsTerm")), body: t(k("use.options")) },
    ],
    flow: [
      { label: t(k("example.regulatedLabel")), value: euro(example.regulated), icon: Landmark, detail: firstYear },
      { label: t(k("example.cheapestLabel")), value: euro(example.cheapest), icon: Zap, detail: firstYear },
      {
        label: t(k("example.differenceLabel")),
        value: euro(example.regulated - example.cheapest),
        icon: BadgePercent,
        tone: "positive",
      },
    ],
    flowOperators: ["−", "="],
    steps: ["a", "b", "c", "d", "e", "f", "g"].map((key) => pair(t, k(`method.steps.${key}`))),
  };
}

export const FUEL_PRICES_GUIDE_IDS = {
  distance: "fuel-prices-note-distance",
  litres: "fuel-prices-note-litres",
  cost: "fuel-prices-note-cost",
  year: "fuel-prices-note-year",
} as const;

export type FuelPricesGuideContent = {
  /** Values for the guide's strings. */
  values: Record<string, string>;
  readTerms: GuideTerm[];
  /** Litres → monthly cost → year. */
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
  limits: GuideTerm[];
};

export function buildFuelPricesGuide(locale: Lang, values: Record<string, string>): FuelPricesGuideContent {
  const t = getTranslations(locale);
  const k = (key: string) => `tools.fuelPrices.guide.${key}`;
  const tool = (key: string) => t(`tools.fuelPrices.${key}`);
  const ids = FUEL_PRICES_GUIDE_IDS;

  const example = fuelCostExample();
  const outcome = computeFuelCost(example);
  if (!outcome.ok) throw new Error("The fuel cost worked example has invalid inputs");
  const { result } = outcome;
  const euro = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });
  const litres = `${formatNumber(locale, result.monthlyLitres, 1)} L`;

  const flow: GuideFigure[] = [
    {
      label: tool("result.litres"),
      value: litres,
      icon: Fuel,
      detail: `${formatNumber(locale, example.distance)} km × ${formatNumber(locale, example.consumption, 1)} ÷ 100`,
    },
    {
      label: tool("result.monthly"),
      value: euro(result.monthly),
      icon: Receipt,
      detail: `${litres} × ${euro(example.price, 3)}/L`,
    },
    { label: tool("result.yearly"), value: euro(result.yearly, 0), icon: CalendarDays, detail: `12 × ${euro(result.monthly)}` },
  ];

  const step = (key: string) => t(k(`method.steps.${key}.term`));
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(step("b"), ids.litres),
      expression: [
        fraction(
          [variable(step("a"), ids.distance), operator("×"), variable(tool("fields.consumption"))],
          [number(formatNumber(locale, 100))],
        ),
      ],
    },
    {
      result: variable(step("c"), ids.cost),
      expression: [variable(step("b"), ids.litres), operator("×"), variable(tool("fields.price"))],
    },
    {
      result: variable(step("d"), ids.year),
      expression: [number(formatNumber(locale, 12)), operator("×"), variable(step("c"), ids.cost)],
    },
  ];

  const limitKeys = Object.keys(t<Record<string, unknown>>(k("limits.items"), { returnObjects: true }));

  return {
    values,
    readTerms: [
      { term: tool("latest.title"), body: t(k("read.prices"), values) },
      { term: tool("stations.title"), body: t(k("read.stations"), values) },
      { term: t(k("read.calculatorTerm")), body: t(k("read.calculator")) },
      { term: t(k("read.noForecastTerm")), body: t(k("read.noForecast")) },
    ],
    flow,
    flowOperators: ["→", "→"],
    formulas,
    notes: [
      pair(t, k("method.steps.a"), ids.distance),
      pair(t, k("method.steps.b"), ids.litres),
      pair(t, k("method.steps.c"), ids.cost),
      pair(t, k("method.steps.d"), ids.year),
    ],
    limits: limitKeys.map((key) => pair(t, k(`limits.items.${key}`))),
  };
}
