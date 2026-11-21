/**
 * The mortgage transfer guide's content for one locale (MortgageTransferGuide.astro): what to
 * compare as a term list, the worked example's values and figures, and the method's formulas
 * with the notes they link to. Every figure comes from `computeMortgageTransfer` on the
 * example the calculator starts from, with the example's switching costs.
 */
import { CalendarClock, FileText, Landmark, Scale, Stamp, Wallet } from "lucide-react";
import {
  MORTGAGE_TRANSFER_EXAMPLE,
  MORTGAGE_TRANSFER_LIMITS,
  computeMortgageTransfer,
  type MortgageTransferInput,
  type MortgageTransferResult,
} from "@/lib/calculators/mortgageTransfer";
import { formatFireDuration as formatDuration } from "@/lib/calculators/fireFormat";
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
export const MORTGAGE_TRANSFER_GUIDE_IDS = {
  saving: "mortgage-transfer-note-saving",
  breakEven: "mortgage-transfer-note-break-even",
  longerTerm: "mortgage-transfer-note-longer-term",
  fixedRate: "mortgage-transfer-note-fixed-rate",
  sameBalance: "mortgage-transfer-note-same-balance",
  timing: "mortgage-transfer-note-timing",
  fees: "mortgage-transfer-note-fees",
  noDiscounting: "mortgage-transfer-note-no-discounting",
  rounding: "mortgage-transfer-note-rounding",
  lender: "mortgage-transfer-note-lender",
  limits: "mortgage-transfer-note-limits",
} as const;

const { exampleCosts, exampleLongerTermYears, ...defaults } = MORTGAGE_TRANSFER_EXAMPLE;

function calculate(overrides: Partial<MortgageTransferInput>): MortgageTransferResult {
  const calculation = computeMortgageTransfer({ ...defaults, ...exampleCosts, ...overrides });
  if (!calculation.ok) throw new Error("The mortgage transfer worked example has invalid inputs");
  return calculation.result;
}

export function buildMortgageTransferGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.mortgageTransfer.${key}`);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.mortgageTransfer.guide.${key}`, values);
  const ids = MORTGAGE_TRANSFER_GUIDE_IDS;

  const example = calculate({});
  const longer = calculate({ newTermYears: exampleLongerTermYears });
  if (example.breakEven.kind !== "month" || !longer.longerTerm || longer.netSaving >= 0) {
    throw new Error("The mortgage transfer worked example no longer tells its story");
  }

  const money = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });
  const duration = (months: number) => formatDuration(locale, months);
  const percent = (value: number) => formatPercent(locale, value, { decimals: 1 });
  const values = {
    balance: money(defaults.balance, 0),
    term: duration(example.current.months),
    currentRate: percent(defaults.currentRate),
    currentFees: money(defaults.currentMonthlyFees, 0),
    currentMonthly: money(example.current.monthlyTotal),
    newRate: percent(defaults.newRate),
    newFees: money(defaults.newMonthlyFees, 0),
    offerMonthly: money(example.offer.monthlyTotal),
    monthlySaving: money(example.monthlySaving),
    exitFeeRate: percent(exampleCosts.exitFeePercent),
    exitFee: money(example.costs.exitFee, 0),
    newLoanFees: money(example.costs.newLoanFees, 0),
    valuationFee: money(example.costs.valuationFee, 0),
    legalFees: money(example.costs.legalFees, 0),
    costs: money(example.costs.total, 0),
    breakEvenMonth: formatNumber(locale, example.breakEven.month),
    breakEvenTime: duration(example.breakEven.month),
    currentTotal: money(example.current.totalCost),
    offerTotal: money(example.offer.totalCost),
    netSaving: money(example.netSaving),
    interestSaved: money(example.interestSaved),
    longerTerm: duration(longer.offer.months),
    longerMonthly: money(longer.offer.monthlyTotal),
    longerSaving: money(longer.monthlySaving),
    extraInterest: money(longer.longerTerm.extraInterest),
    longerNetCost: money(-longer.netSaving),
    minBalance: money(MORTGAGE_TRANSFER_LIMITS.minBalance, 0),
    maxBalance: money(MORTGAGE_TRANSFER_LIMITS.maxBalance, 0),
    maxYears: formatNumber(locale, MORTGAGE_TRANSFER_LIMITS.maxTermYears),
    maxRate: formatPercent(locale, MORTGAGE_TRANSFER_LIMITS.maxAnnualRate, { decimals: 0 }),
    maxExitFee: formatPercent(locale, MORTGAGE_TRANSFER_LIMITS.maxExitFeePercent, { decimals: 0 }),
  };

  const compare: GuideTerm[] = Object.values(
    t<Record<string, { term: string; body: string }>>("tools.mortgageTransfer.guide.compare.items", {
      returnObjects: true,
    }),
  ).map(({ term, body }) => ({ term, body }));

  // The monthly cost of each loan, insurance and fees included, and the difference.
  const monthly: GuideFigure[] = [
    { label: tool("results.currentMonthly"), value: values.currentMonthly, icon: CalendarClock },
    { label: tool("results.offerMonthly"), value: values.offerMonthly, icon: CalendarClock },
    { label: guide("labels.monthlySaving"), value: values.monthlySaving, icon: Wallet, tone: "positive" },
  ];

  // What the switch costs up front.
  const costs: GuideFigure[] = [
    { label: tool("costs.exitFee"), value: money(example.costs.exitFee), icon: Landmark },
    { label: tool("costs.newLoanFees"), value: money(example.costs.newLoanFees), icon: FileText },
    { label: tool("costs.valuationFee"), value: money(example.costs.valuationFee), icon: Scale },
    { label: tool("costs.legalFees"), value: money(example.costs.legalFees), icon: Stamp },
  ];

  // Each loan's total cost over the rest of the term, and what switching saves.
  const totals: GuideFigure[] = [
    { label: tool("table.current"), value: values.currentTotal },
    { label: tool("table.offer"), value: values.offerTotal },
    { label: tool("results.netSaving"), value: values.netSaving, tone: "positive" },
  ];

  const monthlyRate = () => variable(t("tools.mortgage.guide.labels.monthlyRate"), ids.fixedRate);
  const one = () => number(formatNumber(locale, 1));
  const formulas: GuideFormulaLine[] = [
    {
      result: monthlyRate(),
      expression: [fraction([variable(tool("current.rate"), ids.fixedRate)], [number(formatNumber(locale, 12))])],
    },
    {
      result: variable(tool("table.monthlyPayment"), ids.rounding),
      expression: [
        fraction(
          [variable(tool("current.balance"), ids.sameBalance), operator("×"), monthlyRate()],
          [
            one(),
            operator("−"),
            group([one(), operator("+"), monthlyRate()], [operator("−"), variable(t("tools.mortgage.guide.labels.payments"), ids.timing)]),
          ],
        ),
      ],
    },
    {
      result: variable(tool("table.monthlyTotal"), ids.fees),
      expression: [
        variable(tool("table.monthlyPayment"), ids.rounding),
        operator("+"),
        variable(tool("table.monthlyFees"), ids.fees),
      ],
    },
    {
      result: variable(guide("labels.monthlySaving"), ids.saving),
      expression: [
        variable(guide("labels.currentMonthTotal"), ids.saving),
        operator("−"),
        variable(guide("labels.offerMonthTotal"), ids.saving),
      ],
    },
    {
      result: variable(tool("results.netSaving"), ids.saving),
      expression: [
        variable(guide("labels.currentTotalCost"), ids.noDiscounting),
        operator("−"),
        group([
          variable(guide("labels.offerTotalCost"), ids.noDiscounting),
          operator("+"),
          variable(tool("results.switchingCosts"), ids.breakEven),
        ]),
      ],
    },
  ];

  const term = (key: string) => guide(`method.terms.${key}`);
  const notes: GuideTerm[] = [
    { term: term("saving"), body: guide("method.saving"), id: ids.saving },
    { term: term("breakEven"), body: guide("method.breakEven"), id: ids.breakEven },
    { term: term("longerTerm"), body: guide("method.longerTerm"), id: ids.longerTerm },
  ];
  const assumption = (key: keyof typeof ids, body = guide(`method.assumptions.${key}`)): GuideTerm => ({
    term: term(key === "lender" ? "lenderFigures" : key),
    body,
    id: ids[key],
  });
  const assumptions: GuideTerm[] = [
    assumption("fixedRate"),
    assumption("sameBalance"),
    assumption("timing"),
    assumption("fees"),
    assumption("noDiscounting"),
    assumption("rounding"),
    assumption("lender", guide("method.assumptions.lenderFigures")),
    assumption("limits", guide("method.limits", values)),
  ];

  return { values, compare, monthly, costs, totals, formulas, notes, assumptions };
}
