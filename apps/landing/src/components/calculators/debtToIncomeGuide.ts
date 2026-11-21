/**
 * The debt-to-income guide's content for one locale (DebtToIncomeGuide.astro): the bands as a
 * term list, the worked example's figures and the method's formula with its notes. Every
 * figure comes from `compareDebtScenario` on the household the calculator starts from.
 */
import { CalendarClock, Percent, Wallet } from "lucide-react";
import {
  DEBT_TO_INCOME_CAUTION_FROM,
  DEBT_TO_INCOME_HIGH_ABOVE,
  DEBT_TO_INCOME_WORKED_EXAMPLE,
  compareDebtScenario,
  type DebtToIncomeBand,
} from "@/lib/calculators/debtToIncome";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  fraction,
  number,
  operator,
  variable,
  type GuideFigure,
  type GuideFigureTone,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the bands and notes the formula links to: the same in every locale. */
export const DEBT_TO_INCOME_GUIDE_IDS = {
  healthy: "debt-to-income-band-healthy",
  caution: "debt-to-income-band-caution",
  high: "debt-to-income-band-high",
  counts: "debt-to-income-note-counts",
  excludes: "debt-to-income-note-excludes",
  income: "debt-to-income-note-income",
  rounding: "debt-to-income-note-rounding",
  privacy: "debt-to-income-note-privacy",
} as const;

const BAND_TONE: Record<DebtToIncomeBand, GuideFigureTone> = {
  healthy: "positive",
  caution: "default",
  high: "negative",
};

export function buildDebtToIncomeGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.debtToIncome.${key}`);
  const guide = (key: string, values?: Record<string, string | number>) =>
    t(`tools.debtToIncome.guide.${key}`, values);
  const ids = DEBT_TO_INCOME_GUIDE_IDS;

  const example = DEBT_TO_INCOME_WORKED_EXAMPLE;
  const { current, scenario } = compareDebtScenario(example.monthlyIncome, example.rows, example.scenario);
  if (current.status !== "ok" || scenario.status !== "ok") {
    throw new Error("The debt-to-income worked example has invalid inputs");
  }
  const amountOf = (id: string) => example.rows.find((row) => row.id === id)?.amount ?? 0;
  const money = (value: number) => formatMoney(locale, value);
  const percent = (value: number) => formatPercent(locale, value);

  const exampleValues = {
    income: money(example.monthlyIncome),
    home: money(amountOf("home")),
    car: money(amountOf("car")),
    cards: money(amountOf("cards")),
    total: money(current.totalPayments),
    ratio: percent(current.ratio),
    scenarioTotal: money(scenario.totalPayments),
    scenarioRatio: percent(scenario.ratio),
  };

  const bandName = (band: DebtToIncomeBand) => tool(`band${band[0].toUpperCase()}${band.slice(1)}`);
  const bands: GuideTerm[] = [
    {
      term: guide("bandHealthyRange", { caution: DEBT_TO_INCOME_CAUTION_FROM }),
      body: guide("bandHealthyBody"),
      id: ids.healthy,
    },
    {
      term: guide("bandCautionRange", { caution: DEBT_TO_INCOME_CAUTION_FROM, high: DEBT_TO_INCOME_HIGH_ABOVE }),
      body: guide("bandCautionBody"),
      id: ids.caution,
    },
    {
      term: guide("bandHighRange", { high: DEBT_TO_INCOME_HIGH_ABOVE }),
      body: guide("bandHighBody"),
      id: ids.high,
    },
  ];

  // Payments ÷ income = the ratio, as the calculator shows its arithmetic.
  const flow: GuideFigure[] = [
    { label: tool("totalPayments"), value: exampleValues.total, icon: CalendarClock },
    { label: tool("income"), value: exampleValues.income, icon: Wallet },
    { label: tool("ratio"), value: exampleValues.ratio, icon: Percent, detail: bandName(current.band), detailText: true },
  ];

  // The ratio now and after the change, each a share of income in its band.
  const comparison: GuideFigure[] = [
    { label: tool("scenarioCurrent"), result: current },
    { label: tool("scenarioAfter"), result: scenario },
  ].map(({ label, result }) => ({
    label,
    value: percent(result.ratio),
    detail: money(result.totalPayments),
    share: result.ratio,
    shareLabel: bandName(result.band),
    shareLabelText: true,
    tone: BAND_TONE[result.band],
  }));

  const formulas: GuideFormulaLine[] = [
    {
      result: variable(tool("ratio"), ids.rounding),
      expression: [
        fraction([variable(tool("totalPayments"), ids.counts)], [variable(tool("income"), ids.income)]),
        operator("×"),
        number(formatNumber(locale, 100)),
      ],
    },
  ];

  const note = (key: string, id: string): GuideTerm => ({
    term: guide(`${key}Term`),
    body: guide(key === "methodRounding" || key === "methodPrivacy" ? key : `${key}Body`),
    id,
  });

  return {
    exampleValues,
    bands,
    flow,
    comparison,
    formulas,
    notes: [
      note("methodCounts", ids.counts),
      note("methodExcludes", ids.excludes),
      note("methodIncome", ids.income),
      note("methodRounding", ids.rounding),
      note("methodPrivacy", ids.privacy),
    ],
  };
}
