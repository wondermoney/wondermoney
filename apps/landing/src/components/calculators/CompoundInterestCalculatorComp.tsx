import { useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/shared/charts";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import {
  COMPARISON_FALLBACK,
  EXAMPLE_INPUTS,
  MAX_AMOUNT,
  MAX_RATE,
  MAX_RESULT,
  MAX_YEARS,
  compareContributions,
  defaultComparisonContribution,
  type CompoundInterestResult,
  type CompoundInterestTotals,
  type CompoundInterestYear,
  type ContributionComparison,
} from "@/lib/calculators/compoundInterest";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { cn } from "@/lib/utils";

const k = (key: string) => `tools.compoundInterest.${key}`;

export default function CompoundInterestCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <CompoundInterestCalculatorContent />
    </ReactTranslationsProvider>
  );
}

type Translate = ReturnType<typeof useTranslations>["t"];

function CompoundInterestCalculatorContent() {
  const { t, locale } = useTranslations();

  const [principal, setPrincipal] = useState<number>(EXAMPLE_INPUTS.principal);
  const [monthlyContribution, setMonthlyContribution] = useState<number>(
    EXAMPLE_INPUTS.monthlyContribution,
  );
  const [annualRate, setAnnualRate] = useState<number>(EXAMPLE_INPUTS.annualRate);
  const [inflationRate, setInflationRate] = useState<number>(EXAMPLE_INPUTS.inflationRate);
  const [years, setYears] = useState<number>(EXAMPLE_INPUTS.years);
  // Null until the visitor sets it: the comparison then follows the current
  // contribution at +50%.
  const [comparisonInput, setComparisonInput] = useState<number | null>(null);
  const comparisonContribution =
    comparisonInput ?? defaultComparisonContribution(monthlyContribution);

  const comparison = useMemo(
    () =>
      compareContributions(
        { principal, monthlyContribution, annualRate, inflationRate, years },
        comparisonContribution,
      ),
    [principal, monthlyContribution, annualRate, inflationRate, years, comparisonContribution],
  );
  const result = comparison.current;

  // One "tool_used" event per page view, on the visitor's first edit. It carries
  // no figures: what people type stays in the browser.
  const reportedUse = useRef(false);
  const edit = (setter: (value: number) => void) => (value: number) => {
    if (!reportedUse.current) {
      reportedUse.current = true;
      pushGtmEvent({ event: "tool_used", tool: "compound_interest", page_type: getPageType() });
    }
    setter(value);
  };

  const money = (value: number) => formatMoney(locale, value);
  const yearsLabel = (count: number) =>
    count === 1 ? t(k("yearsCountOne")) : t(k("yearsCount"), { count: formatNumber(locale, count) });

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
        <CalculatorInput
          id="principal"
          label={t(k("initialInvestment"))}
          value={principal}
          onChange={edit(setPrincipal)}
          min={0}
          max={MAX_AMOUNT}
          step={500}
          prefix={"€"}
        />
        <CalculatorInput
          id="monthly"
          label={t(k("monthlyContribution"))}
          value={monthlyContribution}
          onChange={edit(setMonthlyContribution)}
          min={0}
          max={MAX_AMOUNT}
          step={50}
          prefix={"€"}
        />
        <CalculatorInput
          id="rate"
          label={t(k("annualReturn"))}
          value={annualRate}
          onChange={edit(setAnnualRate)}
          min={0}
          max={MAX_RATE}
          step={0.5}
          suffix="%"
          helpText={t(k("rateHelp"))}
        />
        <CalculatorInput
          id="inflation"
          label={t(k("inflation"))}
          value={inflationRate}
          onChange={edit(setInflationRate)}
          min={0}
          max={MAX_RATE}
          step={0.5}
          suffix="%"
          helpText={t(k("inflationHelp"))}
        />
        {/* On leaving the field, show the whole years the result uses; an empty one stays empty. */}
        <div onBlur={() => Number.isFinite(years) && setYears(result.inputs.years)}>
          <CalculatorInput
            id="years"
            label={t(k("investmentPeriod"))}
            value={years}
            onChange={edit(setYears)}
            min={0}
            max={MAX_YEARS}
            step={1}
            suffix={t(k("years"))}
            helpText={t(k("periodHelp"), { max: MAX_YEARS })}
          />
        </div>
        <p className="border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
          {t(k("assumptions"))}
        </p>
      </div>

      <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm">
        <ResultSummary result={result} money={money} yearsLabel={yearsLabel} t={t} />
        {/* A chart needs at least one year to show; the totals above cover the rest. */}
        {result.status === "ok" && (
          <GrowthChart schedule={result.schedule} money={money} locale={locale} t={t} />
        )}
      </div>

      <ComparisonCard
        comparison={comparison}
        comparisonContribution={comparisonContribution}
        onComparisonChange={edit(setComparisonInput)}
        money={money}
        t={t}
      />
    </CalculatorLayout>
  );
}

function ResultSummary({
  result,
  money,
  yearsLabel,
  t,
}: {
  result: CompoundInterestResult;
  money: (value: number) => string;
  yearsLabel: (count: number) => string;
  t: Translate;
}) {
  const figure = (totals: CompoundInterestTotals | null, key: keyof CompoundInterestTotals) =>
    totals ? money(totals[key]) : "—";
  const rows = [
    { label: t(k("totalContributions")), key: "contributed" },
    { label: t(k("totalInterest")), key: "growth" },
    { label: t(k("finalBalance")), key: "finalValue" },
  ] as const;

  return (
    <div className="space-y-4">
      {/* One ledger: the parts, then the final value as the answer under a firmer rule. */}
      <table className="w-full text-sm sm:text-base">
        <caption className="sr-only">
          {t(k("resultsCaption"), { years: yearsLabel(result.inputs.years) })}
        </caption>
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th scope="col" className="py-2 pr-2 text-left font-normal">
              <span className="sr-only">{t(k("figureColumn"))}</span>
            </th>
            <th scope="col" className="px-2 py-2 text-right font-normal">
              {t(k("nominalColumn"))}
            </th>
            <th scope="col" className="py-2 pl-2 text-right font-normal">
              {t(k("realColumn"))}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) =>
            row.key === "finalValue" ? (
              <tr key={row.key} className="border-t border-foreground/20 align-baseline">
                <th scope="row" className="pt-4 pr-2 pb-1 text-left font-medium text-foreground">
                  {row.label}
                </th>
                <td className="px-2 pt-4 pb-1 text-right font-mono text-xl font-semibold leading-tight tracking-tight text-primary sm:text-2xl">
                  {figure(result.nominal, row.key)}
                </td>
                <td className="pt-4 pb-1 pl-2 text-right font-mono text-lg font-semibold leading-tight tracking-tight text-foreground sm:text-xl">
                  {figure(result.real, row.key)}
                </td>
              </tr>
            ) : (
              <tr key={row.key} className="border-b border-border">
                <th scope="row" className="py-2.5 pr-2 text-left font-normal text-ink-2">
                  {row.label}
                </th>
                <td className="px-2 py-2.5 text-right font-mono font-medium text-foreground">
                  {figure(result.nominal, row.key)}
                </td>
                <td className="py-2.5 pl-2 text-right font-mono font-medium text-foreground">
                  {figure(result.real, row.key)}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      <div aria-live="polite" className="space-y-2">
        <p
          className={cn(
            "rounded-md bg-muted px-4 py-3 text-sm leading-6",
            result.status === "tooLarge" ? "text-warning-text" : "text-foreground",
          )}
        >
          {statusMessage(result, money, yearsLabel, t)}
        </p>
        {result.real && result.inflationAtOrAboveReturn && result.status === "ok" && (
          <p className="rounded-md bg-muted px-4 py-3 text-sm leading-6 text-warning-text">
            {t(k("inflationWarning"), { growth: money(result.real.growth) })}
          </p>
        )}
        {result.adjusted && (
          <p className="text-sm leading-6 text-warning-text">
            {t(k("adjusted"), {
              maxAmount: money(MAX_AMOUNT),
              maxRate: MAX_RATE,
              maxYears: MAX_YEARS,
            })}
          </p>
        )}
      </div>
    </div>
  );
}

function statusMessage(
  result: CompoundInterestResult,
  money: (value: number) => string,
  yearsLabel: (count: number) => string,
  t: Translate,
): string {
  switch (result.status) {
    case "tooLarge":
      return t(k("statusTooLarge"), { max: money(MAX_RESULT) });
    case "incomplete":
      return t(k("statusIncomplete"));
    case "nothingInvested":
      return t(k("statusNothingInvested"));
    case "noPeriod":
      return t(k("statusNoPeriod"));
    case "ok":
      return t(k("summary"), {
        years: yearsLabel(result.inputs.years),
        contributed: money(result.nominal.contributed),
        final: money(result.nominal.finalValue),
        real: money(result.real.finalValue),
      });
  }
}

function GrowthChart({
  schedule,
  money,
  locale,
  t,
}: {
  schedule: CompoundInterestYear[];
  money: (value: number) => string;
  locale: Lang;
  t: Translate;
}) {
  return (
    <div className="space-y-3">
      <div className="h-72 w-full min-w-0" role="img" aria-label={t(k("chartLabel"))}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={schedule} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
            <XAxis
              dataKey="year"
              label={{ value: t(k("year")), position: "insideBottomRight", offset: -5 }}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              tickFormatter={(value: number) => formatMoney(locale, value, { compact: true })}
              tick={{ fontSize: 12 }}
              width={64}
            />
            <Tooltip
              // @ts-expect-error Recharts tooltip types are very broken
              formatter={(value: number, name: string) => [money(value), name]}
              itemStyle={{ color: "oklch(var(--foreground))" }}
              labelFormatter={(year) => `${t(k("year"))} ${String(year)}`}
            />
            <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
            <Area
              type="monotone"
              dataKey="contributed"
              name={t(k("contributions"))}
              stackId="1"
              stroke="oklch(var(--chart-1))"
              fill="oklch(var(--chart-1) / 0.3)"
            />
            <Area
              type="monotone"
              dataKey="growth"
              name={t(k("interestEarned"))}
              stackId="1"
              stroke="oklch(var(--chart-3))"
              fill="oklch(var(--chart-3) / 0.3)"
            />
            <Line
              type="monotone"
              dataKey="realValue"
              name={t(k("realValue"))}
              stroke="oklch(var(--chart-2))"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-primary underline decoration-primary/40 underline-offset-4">
          {t(k("tableToggle"))}
        </summary>
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t(k("tableCaption"))}</caption>
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="py-2 pr-2 text-left font-normal">
                  {t(k("year"))}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-normal">
                  {t(k("contributions"))}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-normal">
                  {t(k("interestEarned"))}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-normal">
                  {t(k("value"))}
                </th>
                <th scope="col" className="py-2 pl-2 text-right font-normal">
                  {t(k("realValue"))}
                </th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((row) => (
                <tr key={row.year} className="border-b border-border-2 last:border-0">
                  <th scope="row" className="py-1.5 pr-2 text-left font-mono font-normal">
                    {row.year}
                  </th>
                  <td className="px-2 py-1.5 text-right font-mono">{money(row.contributed)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{money(row.growth)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{money(row.value)}</td>
                  <td className="py-1.5 pl-2 text-right font-mono">{money(row.realValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function ComparisonCard({
  comparison,
  comparisonContribution,
  onComparisonChange,
  money,
  t,
}: {
  comparison: ContributionComparison;
  comparisonContribution: number;
  onComparisonChange: (value: number) => void;
  money: (value: number) => string;
  t: Translate;
}) {
  const { current, comparison: other, difference } = comparison;
  const { locale } = useTranslations();
  const signed = (value: number) => formatMoney(locale, value, { sign: value === 0 ? "auto" : "always" });

  const rows: Array<{ label: string; pick: (r: CompoundInterestResult) => number | null; strong?: boolean }> = [
    {
      label: t(k("monthlyContribution")),
      pick: (r) => (r.status === "incomplete" ? null : r.inputs.monthlyContribution),
    },
    { label: t(k("totalContributions")), pick: (r) => r.nominal?.contributed ?? null },
    { label: t(k("totalInterest")), pick: (r) => r.nominal?.growth ?? null },
    { label: t(k("finalBalance")), pick: (r) => r.nominal?.finalValue ?? null, strong: true },
    { label: t(k("finalValueReal")), pick: (r) => r.real?.finalValue ?? null, strong: true },
  ];
  const differences = difference
    ? [
        difference.monthlyContribution,
        difference.nominal.contributed,
        difference.nominal.growth,
        difference.nominal.finalValue,
        difference.real.finalValue,
      ]
    : null;

  return (
    <section
      aria-labelledby="compound-comparison-title"
      className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm lg:col-span-2"
    >
      <div>
        <h2 id="compound-comparison-title" className="text-lg font-semibold text-foreground">
          {t(k("comparisonTitle"))}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(k("comparisonIntro"))}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
        <CalculatorInput
          id="comparisonMonthly"
          label={t(k("comparisonContribution"))}
          value={comparisonContribution}
          onChange={onComparisonChange}
          min={0}
          max={MAX_AMOUNT}
          step={50}
          prefix={"€"}
          helpText={t(k("comparisonHelp"), { fallback: money(COMPARISON_FALLBACK) })}
        />

        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <caption className="sr-only">{t(k("comparisonTitle"))}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="py-2 pr-2 text-left font-normal">
                    <span className="sr-only">{t(k("figureColumn"))}</span>
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">
                    {t(k("currentColumn"))}
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">
                    {t(k("comparisonColumn"))}
                  </th>
                  <th scope="col" className="py-2 pl-2 text-right font-normal">
                    {t(k("differenceColumn"))}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const a = row.pick(current);
                  const b = row.pick(other);
                  const diff = differences?.[index];
                  return (
                    <tr
                      key={row.label}
                      className={cn(
                        "border-b border-border-2 last:border-0",
                        row.strong && "font-semibold text-foreground",
                      )}
                    >
                      <th scope="row" className="py-2 pr-2 text-left font-normal text-foreground">
                        {row.label}
                      </th>
                      <td className="px-2 py-2 text-right font-mono">{a === null ? "—" : money(a)}</td>
                      <td className="px-2 py-2 text-right font-mono">{b === null ? "—" : money(b)}</td>
                      <td
                        className={cn(
                          "py-2 pl-2 text-right font-mono",
                          diff !== undefined && diff > 0 && "text-success-text",
                          diff !== undefined && diff < 0 && "text-destructive-text",
                        )}
                      >
                        {diff === undefined ? "—" : signed(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p aria-live="polite" className="text-sm leading-6 text-foreground">
            {comparisonMessage(comparison, money, t)}
          </p>
        </div>
      </div>
    </section>
  );
}

function comparisonMessage(
  { current, comparison, difference }: ContributionComparison,
  money: (value: number) => string,
  t: Translate,
): string {
  if (current.status === "incomplete" || comparison.status === "incomplete") {
    return t(k("comparisonIncomplete"));
  }
  if (!difference) return t(k("comparisonUnavailable"));
  if (current.inputs.years === 0) return t(k("comparisonNoPeriod"));
  const values = {
    amount: money(Math.abs(difference.monthlyContribution)),
    final: money(Math.abs(difference.nominal.finalValue)),
    real: money(Math.abs(difference.real.finalValue)),
  };
  if (difference.monthlyContribution > 0) return t(k("comparisonMore"), values);
  if (difference.monthlyContribution < 0) return t(k("comparisonLess"), values);
  return t(k("comparisonSame"));
}

