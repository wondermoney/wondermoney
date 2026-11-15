import { useMemo, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import {
  SAVINGS_GOAL_EXAMPLE,
  SAVINGS_GOAL_LIMITS,
  SOLVE_FOR_OPTIONS,
  computeSavingsGoal,
  type SavingsGoalField,
  type SavingsGoalResult,
  type SavingsGoalYear,
  type SolveFor,
} from "@/lib/calculators/savingsGoal";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { cn } from "@/lib/utils";

export default function SavingsGoalCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <SavingsGoalCalculatorContent />
    </ReactTranslationsProvider>
  );
}

type Translate = ReturnType<typeof useTranslations>["t"];
type Money = (value: number, decimals?: number) => string;

const k = (key: string) => `tools.savingsGoal.${key}`;

// Recharts sorts legend and tooltip items alphabetically by default, which differs per locale;
// keep them in stacking order instead.
const SERIES_ORDER = ["savings", "contributions", "growth"];
const bySeries = (item: { dataKey?: unknown }) => SERIES_ORDER.indexOf(String(item.dataKey));

function SavingsGoalCalculatorContent() {
  const { t, locale } = useTranslations();

  const [solveFor, setSolveFor] = useState<SolveFor>(SAVINGS_GOAL_EXAMPLE.solveFor);
  const [goalAmount, setGoalAmount] = useState<number>(SAVINGS_GOAL_EXAMPLE.goalAmount);
  const [startingSavings, setStartingSavings] = useState<number>(
    SAVINGS_GOAL_EXAMPLE.startingSavings,
  );
  const [monthlyContribution, setMonthlyContribution] = useState<number>(
    SAVINGS_GOAL_EXAMPLE.monthlyContribution,
  );
  const [years, setYears] = useState<number>(SAVINGS_GOAL_EXAMPLE.years);
  const [months, setMonths] = useState<number>(SAVINGS_GOAL_EXAMPLE.months);
  const [annualReturn, setAnnualReturn] = useState<number>(SAVINGS_GOAL_EXAMPLE.annualReturn);

  const calculation = useMemo(
    () =>
      computeSavingsGoal({
        solveFor,
        goalAmount,
        startingSavings,
        monthlyContribution,
        years,
        months,
        annualReturn,
      }),
    [solveFor, goalAmount, startingSavings, monthlyContribution, years, months, annualReturn],
  );

  // The shared landing tool event: one `tool_used` per page view, on the visitor's first edit,
  // without amounts. pushGtmEvent drops it unless analytics consent was given.
  const usageSent = useRef(false);
  const markUsed = () => {
    if (usageSent.current) return;
    usageSent.current = true;
    pushGtmEvent({ event: "tool_used", tool: "savings_goal", page_type: getPageType() });
  };
  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      markUsed();
      setter(value);
    };

  const money: Money = (value, decimals = 0) => formatMoney(locale, value, { decimals });
  const cents = (value: number) => money(value, Number.isInteger(value) ? 0 : 2);
  const duration = (count: number) => durationLabel(count, locale, t);

  const limits: Record<SavingsGoalField, string> = {
    goalAmount: money(SAVINGS_GOAL_LIMITS.maxAmount),
    startingSavings: money(SAVINGS_GOAL_LIMITS.maxAmount),
    monthlyContribution: money(SAVINGS_GOAL_LIMITS.maxAmount),
    period: formatNumber(locale, SAVINGS_GOAL_LIMITS.maxMonths / 12),
    annualReturn: formatPercent(locale, SAVINGS_GOAL_LIMITS.maxAnnualReturn, { decimals: 0 }),
  };
  const errorFor = (field: SavingsGoalField): string | undefined => {
    if (calculation.ok) return undefined;
    const error = calculation.errors[field];
    return error ? t(k(`errors.${field}.${error}`), { max: limits[field] }) : undefined;
  };

  const result = calculation.ok ? calculation.result : null;

  return (
    <>
      <CalculatorLayout>
        {/* Inputs */}
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <fieldset className="space-y-2">
            <legend className="mb-2 block text-sm font-medium text-foreground">
              {t(k("solveForLabel"))}
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {SOLVE_FOR_OPTIONS.map((option) => {
                const active = solveFor === option;
                return (
                  <label
                    key={option}
                    className={cn(
                      "flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                      active
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-input bg-background text-foreground hover:bg-accent",
                    )}
                  >
                    <input
                      type="radio"
                      name="savingsGoalSolveFor"
                      value={option}
                      checked={active}
                      onChange={() => edit(setSolveFor)(option)}
                      className="sr-only"
                    />
                    {t(k(`solveFor.${option}`))}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {solveFor !== "finalAmount" && (
            <CalculatorInput
              id="savingsGoalAmount"
              label={t(k("goalAmount"))}
              value={goalAmount}
              onChange={edit(setGoalAmount)}
              min={0}
              max={SAVINGS_GOAL_LIMITS.maxAmount}
              step={500}
              prefix={"€"}
              helpText={t(k("goalAmountHelp"))}
              error={errorFor("goalAmount")}
            />
          )}
          <CalculatorInput
            id="savingsGoalStartingSavings"
            label={t(k("startingSavings"))}
            value={startingSavings}
            onChange={edit(setStartingSavings)}
            min={0}
            max={SAVINGS_GOAL_LIMITS.maxAmount}
            step={100}
            prefix={"€"}
            helpText={t(k("startingSavingsHelp"))}
            error={errorFor("startingSavings")}
          />
          {solveFor !== "contribution" && (
            <CalculatorInput
              id="savingsGoalMonthlyContribution"
              label={t(k("monthlyContribution"))}
              value={monthlyContribution}
              onChange={edit(setMonthlyContribution)}
              min={0}
              max={SAVINGS_GOAL_LIMITS.maxAmount}
              step={25}
              prefix={"€"}
              helpText={t(k("monthlyContributionHelp"))}
              error={errorFor("monthlyContribution")}
            />
          )}
          {solveFor !== "time" && (
            <fieldset className="space-y-2">
              <legend className="mb-2 block text-sm font-medium text-foreground">
                {t(k("period"))}
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <CalculatorInput
                  id="savingsGoalYears"
                  label={t(k("periodYears"))}
                  value={years}
                  onChange={edit(setYears)}
                  min={0}
                  max={SAVINGS_GOAL_LIMITS.maxMonths / 12}
                  step={1}
                  error={errorFor("period")}
                />
                <CalculatorInput
                  id="savingsGoalMonths"
                  label={t(k("periodMonths"))}
                  value={months}
                  onChange={edit(setMonths)}
                  min={0}
                  max={11}
                  step={1}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t(k("periodHelp"))}</p>
            </fieldset>
          )}
          <CalculatorInput
            id="savingsGoalAnnualReturn"
            label={t(k("annualReturn"))}
            value={annualReturn}
            onChange={edit(setAnnualReturn)}
            min={0}
            max={SAVINGS_GOAL_LIMITS.maxAnnualReturn}
            step={0.5}
            suffix="%"
            helpText={t(k("annualReturnHelp"))}
            error={errorFor("annualReturn")}
          />
        </div>

        {/* Results */}
        <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <ResultPanel result={result} money={money} cents={cents} duration={duration} />
          ) : (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t(k("errors.summary"))}
            </p>
          )}

          <div className="space-y-2 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
            <p className="font-medium text-foreground">{t(k("assumptionsTitle"))}</p>
            <p>{t(k("assumptionsReturn"))}</p>
            <p>{t(k("assumptionsCosts"))}</p>
          </div>
        </div>
      </CalculatorLayout>

      {result && result.years.length > 0 && (
        <Schedule result={result} cents={cents} />
      )}
    </>
  );
}

function ResultPanel({
  result,
  money,
  cents,
  duration,
}: {
  result: SavingsGoalResult;
  money: Money;
  cents: (value: number) => string;
  duration: (months: number) => string;
}) {
  const { t, locale } = useTranslations();

  const answer = answerFor(result, { t, cents, duration });
  const showTotals =
    result.status === "solved" || result.status === "growthAlone" || result.status === "reached";
  const contributions = { label: t(k("totalContributions")), value: cents(result.totalContributions) };
  const growth = { label: t(k("totalGrowth")), value: cents(result.totalGrowth) };
  const items = !showTotals
    ? []
    : result.solveFor === "finalAmount"
      ? [{ label: t(k("startingSavings")), value: cents(result.startingSavings) }, contributions, growth]
      : [contributions, growth, { label: t(k("finalBalance")), value: cents(result.finalBalance) }];
  const message = statusMessageFor(result, { t, money, cents, duration, locale });
  const isWarning =
    result.status === "never" || result.status === "beyondHorizon" || result.status === "tooLarge";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">{t(k(`answer.${result.solveFor}`))}</p>
        <p className="font-mono text-2xl font-bold text-primary">{answer}</p>
      </div>
      {items.length > 0 && <CalculatorResult items={items} />}
      <p
        aria-live="polite"
        className={cn(
          "rounded-md bg-muted px-4 py-3 text-sm leading-6",
          isWarning ? "text-warning-text" : "text-foreground",
        )}
      >
        {message}
      </p>
    </div>
  );
}

function Schedule({
  result,
  cents,
}: {
  result: SavingsGoalResult;
  cents: (value: number) => string;
}) {
  const { t, locale } = useTranslations();

  const chartData = useMemo(
    () => [
      { years: 0, savings: result.startingSavings, contributions: 0, growth: 0 },
      ...result.years.map((row) => ({
        years: row.month / 12,
        savings: result.startingSavings,
        contributions: row.contributions,
        growth: row.growth,
      })),
    ],
    [result],
  );

  const cell = "px-3 py-2 text-right font-mono whitespace-nowrap";
  const rowLabel = (row: SavingsGoalYear) =>
    row.month % 12 === 0
      ? t(k("schedule.yearLabel"), { year: formatNumber(locale, row.year) })
      : t(k("schedule.monthLabel"), { month: formatNumber(locale, row.month) });

  return (
    <section className="mt-10" aria-labelledby="savings-goal-schedule-title">
      <h2
        id="savings-goal-schedule-title"
        className="text-2xl font-semibold tracking-tight text-foreground"
      >
        {t(k("schedule.title"))}
      </h2>
      <p className="mt-2 max-w-3xl text-muted-foreground">{t(k("schedule.description"))}</p>

      <div
        className="mt-6 h-72 w-full min-w-0"
        role="img"
        aria-label={t(k("schedule.chartLabel"))}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
            <XAxis
              dataKey="years"
              type="number"
              domain={[0, "dataMax"]}
              allowDecimals={false}
              tickFormatter={(value: number) => formatNumber(locale, value)}
              label={{ value: t(k("schedule.yearAxis")), position: "insideBottomRight", offset: -5 }}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              tickFormatter={(value: number) => formatMoney(locale, value, { compact: true })}
              tick={{ fontSize: 12 }}
              width={64}
            />
            <Tooltip
              itemSorter={bySeries}
              labelFormatter={(value) =>
                t(k("schedule.tooltipLabel"), {
                  months: formatNumber(locale, Math.round(Number(value) * 12)),
                })
              }
              // @ts-expect-error Recharts tooltip types are very broken
              formatter={(value: number, name: string) => [cents(value), name]}
            />
            <Legend
              itemSorter={bySeries}
              formatter={(value) => <span className="text-foreground">{value}</span>}
            />
            <Area
              type="monotone"
              dataKey="savings"
              name={t(k("schedule.startingSavings"))}
              stackId="1"
              stroke="oklch(var(--chart-1))"
              fill="oklch(var(--chart-1) / 0.3)"
            />
            <Area
              type="monotone"
              dataKey="contributions"
              name={t(k("schedule.contributions"))}
              stackId="1"
              stroke="oklch(var(--chart-2))"
              fill="oklch(var(--chart-2) / 0.3)"
            />
            <Area
              type="monotone"
              dataKey="growth"
              name={t(k("schedule.growth"))}
              stackId="1"
              stroke="oklch(var(--chart-3))"
              fill="oklch(var(--chart-3) / 0.3)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-6 overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="sr-only">{t(k("schedule.title"))}</caption>
          <thead className="bg-paper-2 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {t(k("schedule.period"))}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t(k("schedule.contributions"))}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t(k("schedule.growth"))}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t(k("schedule.balance"))}
              </th>
            </tr>
          </thead>
          <tbody>
            {result.years.map((row) => (
              <tr key={row.month} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">
                  {rowLabel(row)}
                </th>
                <td className={cell}>{cents(row.contributions)}</td>
                <td className={cell}>{cents(row.growth)}</td>
                <td className={cell}>{cents(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** "2 years and 11 months", "1 year", "7 months". */
function durationLabel(totalMonths: number, locale: Lang, t: Translate): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const yearsText =
    years === 1 ? t(k("durationYearsOne")) : t(k("durationYears"), { count: formatNumber(locale, years) });
  const monthsText =
    months === 1
      ? t(k("durationMonthsOne"))
      : t(k("durationMonths"), { count: formatNumber(locale, months) });
  if (years === 0) return monthsText;
  if (months === 0) return yearsText;
  return t(k("durationJoin"), { years: yearsText, months: monthsText });
}

function answerFor(
  result: SavingsGoalResult,
  {
    t,
    cents,
    duration,
  }: { t: Translate; cents: (value: number) => string; duration: (months: number) => string },
): string {
  if (result.status === "tooLarge") return "—";
  switch (result.solveFor) {
    case "contribution":
      return cents(result.monthlyContribution);
    case "finalAmount":
      return cents(result.finalBalance);
    case "time":
      if (result.status === "reached") return t(k("alreadyThere"));
      if (result.status === "never") return t(k("never"));
      if (result.status === "beyondHorizon") return t(k("overHundredYears"));
      return duration(result.months ?? 0);
  }
}

function statusMessageFor(
  result: SavingsGoalResult,
  {
    t,
    money,
    cents,
    duration,
    locale,
  }: {
    t: Translate;
    money: Money;
    cents: (value: number) => string;
    duration: (months: number) => string;
    locale: Lang;
  },
): string {
  const values = {
    goal: cents(result.goalAmount),
    savings: cents(result.startingSavings),
    contribution: cents(result.monthlyContribution),
    final: cents(result.finalBalance),
    period: result.months === null ? "" : duration(result.months),
    rate: formatPercent(locale, result.annualReturn, {
      decimals: Number.isInteger(result.annualReturn) ? 0 : 2,
    }),
    max: money(SAVINGS_GOAL_LIMITS.maxBalance),
  };

  switch (result.status) {
    case "tooLarge":
      return t(k("status.tooLarge"), values);
    case "reached":
      return t(k(result.solveFor === "time" ? "status.reachedTime" : "status.reached"), values);
    case "growthAlone":
      return t(k("status.growthAlone"), values);
    case "never":
      return t(k("status.never"), values);
    case "beyondHorizon":
      return t(k("status.beyondHorizon"), values);
    case "solved":
      return t(k(`status.${result.solveFor}`), values);
  }
}
