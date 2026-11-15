import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import {
  EARLY_REPAYMENT_EXAMPLE,
  EARLY_REPAYMENT_LIMITS,
  computeEarlyRepayment,
  type EarlyRepaymentField,
  type EarlyRepaymentResult,
  type EarlyRepaymentScenario,
  type LoanOutlook,
} from "@/lib/calculators/earlyRepayment";
import { targetMonthFrom } from "@/lib/calculators/emergencyFund";
import { formatFireDuration as formatDuration } from "@/lib/calculators/fireFormat";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent, toIntlLocale } from "@/lib/numberFormat";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { cn } from "@/lib/utils";

type Outcome = "both" | "lowerPayment" | "shorterTerm";
const OUTCOMES: readonly Outcome[] = ["both", "lowerPayment", "shorterTerm"];

const k = (key: string) => `tools.earlyRepayment.${key}`;

export default function EarlyRepaymentCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <EarlyRepaymentCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function EarlyRepaymentCalculatorContent() {
  const { t, locale } = useTranslations();

  const [balance, setBalance] = useState<number>(EARLY_REPAYMENT_EXAMPLE.balance);
  const [termYears, setTermYears] = useState<number>(EARLY_REPAYMENT_EXAMPLE.termYears);
  const [termMonths, setTermMonths] = useState<number>(EARLY_REPAYMENT_EXAMPLE.termMonths);
  const [annualRate, setAnnualRate] = useState<number>(EARLY_REPAYMENT_EXAMPLE.annualRate);
  const [repayment, setRepayment] = useState<number>(EARLY_REPAYMENT_EXAMPLE.repayment);
  const [feePercent, setFeePercent] = useState<number>(EARLY_REPAYMENT_EXAMPLE.feePercent);
  const [outcome, setOutcome] = useState<Outcome>("both");

  // The page is prerendered, so "today" is only known in the browser. Until then the payoff
  // months show a dash rather than the build date.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const calculation = useMemo(
    () =>
      computeEarlyRepayment({ balance, termYears, termMonths, annualRate, repayment, feePercent }),
    [balance, termYears, termMonths, annualRate, repayment, feePercent],
  );

  // The shared landing tool event: one `tool_used` per page view, on the visitor's first edit,
  // without amounts. pushGtmEvent drops it unless analytics consent was given.
  const usageSent = useRef(false);
  const reportUse = () => {
    if (usageSent.current) return;
    usageSent.current = true;
    pushGtmEvent({ event: "tool_used", tool: "early_repayment", page_type: getPageType() });
  };
  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      reportUse();
      setter(value);
    };

  const money = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });

  const limits: Record<EarlyRepaymentField, string> = {
    balance: money(EARLY_REPAYMENT_LIMITS.maxBalance, 0),
    termYears: formatNumber(locale, EARLY_REPAYMENT_LIMITS.maxTermYears),
    termMonths: formatNumber(locale, 11),
    annualRate: formatPercent(locale, EARLY_REPAYMENT_LIMITS.maxAnnualRate, { decimals: 0 }),
    repayment: money(EARLY_REPAYMENT_LIMITS.maxBalance, 0),
    feePercent: formatPercent(locale, EARLY_REPAYMENT_LIMITS.maxFeePercent, { decimals: 0 }),
  };
  const errorFor = (field: EarlyRepaymentField): string | undefined => {
    if (calculation.ok) return undefined;
    const error = calculation.errors[field];
    return error
      ? t(k(`errors.${field}.${error}`), {
          max: limits[field],
          min: money(EARLY_REPAYMENT_LIMITS.minBalance, 0),
        })
      : undefined;
  };

  const result = calculation.ok ? calculation.result : null;

  return (
    <>
      <CalculatorLayout>
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <CalculatorInput
            id="earlyRepaymentBalance"
            label={t(k("balance"))}
            value={balance}
            onChange={edit(setBalance)}
            min={EARLY_REPAYMENT_LIMITS.minBalance}
            max={EARLY_REPAYMENT_LIMITS.maxBalance}
            step={1000}
            prefix={"€"}
            helpText={t(k("balanceHelp"))}
            error={errorFor("balance")}
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">{t(k("termLabel"))}</legend>
            <div className="grid grid-cols-2 gap-3">
              <CalculatorInput
                id="earlyRepaymentTermYears"
                label={t(k("termYears"))}
                value={termYears}
                onChange={edit(setTermYears)}
                min={0}
                max={EARLY_REPAYMENT_LIMITS.maxTermYears}
                step={1}
                error={errorFor("termYears")}
              />
              <CalculatorInput
                id="earlyRepaymentTermMonths"
                label={t(k("termMonths"))}
                value={termMonths}
                onChange={edit(setTermMonths)}
                min={0}
                max={11}
                step={1}
                error={errorFor("termMonths")}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t(k("termHelp"))}</p>
          </fieldset>
          <CalculatorInput
            id="earlyRepaymentRate"
            label={t(k("interestRate"))}
            value={annualRate}
            onChange={edit(setAnnualRate)}
            min={0}
            max={EARLY_REPAYMENT_LIMITS.maxAnnualRate}
            step={0.05}
            suffix="%"
            helpText={t(k("rateHelp"))}
            error={errorFor("annualRate")}
          />
          <CalculatorInput
            id="earlyRepaymentAmount"
            label={t(k("repayment"))}
            value={repayment}
            onChange={edit(setRepayment)}
            min={0}
            max={EARLY_REPAYMENT_LIMITS.maxBalance}
            step={1000}
            prefix={"€"}
            helpText={t(k("repaymentHelp"))}
            error={errorFor("repayment")}
          />
          <CalculatorInput
            id="earlyRepaymentFee"
            label={t(k("fee"))}
            value={feePercent}
            onChange={edit(setFeePercent)}
            min={0}
            max={EARLY_REPAYMENT_LIMITS.maxFeePercent}
            step={0.1}
            suffix="%"
            helpText={t(k("feeHelp"))}
            error={errorFor("feePercent")}
          />
          <div className="space-y-2">
            <p id="earlyRepaymentOutcomeLabel" className="text-sm font-medium text-foreground">
              {t(k("showLabel"))}
            </p>
            <div
              role="group"
              aria-labelledby="earlyRepaymentOutcomeLabel"
              className="flex flex-wrap gap-2"
            >
              {OUTCOMES.map((option) => {
                const active = outcome === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={active}
                    onClick={() => edit(setOutcome)(option)}
                    className={cn(
                      "h-9 rounded-md border px-3 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      active
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-input bg-background text-foreground hover:bg-accent",
                    )}
                  >
                    {t(k(`show.${option}`))}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-6 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <Results result={result} outcome={outcome} now={now} money={money} />
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
      </CalculatorLayout>

      {result && result.status !== "cleared" && (
        <Comparison result={result} outcome={outcome} now={now} money={money} />
      )}
    </>
  );
}

type Money = (value: number, decimals?: number) => string;
type Scenario = "lowerPayment" | "shorterTerm";

const scenariosFor = (outcome: Outcome): Scenario[] =>
  (["lowerPayment", "shorterTerm"] as const).filter(
    (scenario) => outcome === "both" || outcome === scenario,
  );

/** Durations in words, and the month of the last payment once "today" is known. */
function useLoanFormatters(now: Date | null) {
  const { locale } = useTranslations();
  return {
    duration: (months: number) => formatDuration(locale, months),
    // The long month name: some engines render pt-PT's short form as "11/2028".
    payoffMonth: (months: number) =>
      now && months > 0
        ? new Intl.DateTimeFormat(toIntlLocale(locale), {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(targetMonthFrom(now, months))
        : "—",
  };
}

function Results({
  result,
  outcome,
  now,
  money,
}: {
  result: EarlyRepaymentResult;
  outcome: Outcome;
  now: Date | null;
  money: Money;
}) {
  const { t } = useTranslations();
  const { duration, payoffMonth } = useLoanFormatters(now);

  if (result.status === "cleared") {
    return (
      <>
        <p className="rounded-lg bg-success/10 px-4 py-3 text-sm text-foreground">
          {t(k("status.cleared"))}
        </p>
        {result.repaymentUnused > 0 && <UnusedNote result={result} money={money} />}
        <CalculatorResult
          items={[
            { label: t(k("table.interestSaved")), value: money(result.shorterTerm.interestSaved) },
            { label: t(k("table.fee")), value: money(result.fee) },
            {
              label: t(k(result.shorterTerm.netSaving < 0 ? "netCost" : "netSaving")),
              value: money(Math.abs(result.shorterTerm.netSaving)),
              highlight: true,
            },
          ]}
        />
        {result.shorterTerm.netSaving < 0 && <FeeExceedsNote />}
        <OriginalReference original={result.original} duration={duration} money={money} />
      </>
    );
  }

  const scenarios = scenariosFor(outcome);
  const anyLoss = scenarios.some((scenario) => result[scenario].netSaving < 0);

  return (
    <>
      {result.status === "none" && (
        <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
          {t(k("status.none"))}
        </p>
      )}

      <div className={cn("grid gap-4", scenarios.length > 1 && "sm:grid-cols-2")}>
        {scenarios.map((scenario) => (
          <ScenarioCard
            key={scenario}
            kind={scenario}
            scenario={result[scenario]}
            money={money}
            duration={duration}
            payoffMonth={payoffMonth}
          />
        ))}
      </div>
      {anyLoss && result.status !== "none" && <FeeExceedsNote />}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <SummaryItem label={t(k("summary.repaid"))} value={money(result.repaymentApplied)} />
        <SummaryItem label={t(k("summary.fee"))} value={money(result.fee)} />
        <SummaryItem label={t(k("summary.balanceAfter"))} value={money(result.balanceAfter)} />
      </dl>
    </>
  );
}

function Comparison({
  result,
  outcome,
  now,
  money,
}: {
  result: EarlyRepaymentResult;
  outcome: Outcome;
  now: Date | null;
  money: Money;
}) {
  const { t } = useTranslations();
  const { duration, payoffMonth } = useLoanFormatters(now);
  const scenarios = scenariosFor(outcome);

  return (
    <section className="mt-10 space-y-6" aria-labelledby="early-repayment-comparison">
      <h2
        id="early-repayment-comparison"
        className="text-2xl font-semibold tracking-tight text-foreground"
      >
        {t(k("table.title"))}
      </h2>
      <ComparisonTable
        result={result}
        scenarios={scenarios}
        money={money}
        duration={duration}
        payoffMonth={payoffMonth}
      />
      <p className="text-xs text-muted-foreground">{t(k("resultNote"))}</p>
      <BalanceChart result={result} scenarios={scenarios} money={money} />
    </section>
  );
}

function ScenarioCard({
  kind,
  scenario,
  money,
  duration,
  payoffMonth,
}: {
  kind: Scenario;
  scenario: EarlyRepaymentScenario;
  money: Money;
  duration: (months: number) => string;
  payoffMonth: (months: number) => string;
}) {
  const { t } = useTranslations();
  const loss = scenario.netSaving < 0;
  const hasDate = payoffMonth(scenario.months) !== "—";

  return (
    <section className="min-w-0 rounded-lg border border-border p-4" aria-label={t(k(`${kind}.title`))}>
      <h3 className="text-sm font-semibold text-foreground">{t(k(`${kind}.title`))}</h3>
      <p className="mt-3 text-sm text-muted-foreground">{t(k(`${kind}.headline`))}</p>
      {/* Geist Mono is for money only: the duration is set in the body face. */}
      <p
        className={cn(
          "break-words text-2xl font-bold text-primary",
          kind === "lowerPayment" && "font-mono",
        )}
      >
        {kind === "lowerPayment" ? money(scenario.monthlyPayment) : duration(scenario.monthsSaved)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {kind === "lowerPayment"
          ? t(k("lowerPayment.change"), { amount: money(scenario.paymentReduction) })
          : t(k(hasDate ? "shorterTerm.change" : "shorterTerm.changeNoDate"), {
              term: duration(scenario.months),
              date: payoffMonth(scenario.months),
            })}
      </p>
      <dl className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-muted-foreground">{t(k("table.interestSaved"))}</dt>
          <dd className="font-mono text-foreground">{money(scenario.interestSaved)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="font-medium text-foreground">{t(k(loss ? "netCost" : "netSaving"))}</dt>
          <dd className={cn("font-mono font-semibold", loss ? "text-destructive-text" : "text-foreground")}>
            {money(Math.abs(scenario.netSaving))}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words font-mono text-foreground">{value}</dd>
    </div>
  );
}

function ComparisonTable({
  result,
  scenarios,
  money,
  duration,
  payoffMonth,
}: {
  result: EarlyRepaymentResult;
  scenarios: readonly Scenario[];
  money: Money;
  duration: (months: number) => string;
  payoffMonth: (months: number) => string;
}) {
  const { t } = useTranslations();
  const columns: Array<{ key: "original" | "lowerPayment" | "shorterTerm"; loan: LoanOutlook }> = [
    { key: "original", loan: result.original },
    ...scenarios.map((key) => ({ key, loan: result[key] })),
  ];
  const scenarioOf = (key: (typeof columns)[number]["key"]) =>
    key === "original" ? null : result[key];

  // Durations and months are words, so only the money rows use Geist Mono.
  const rows: Array<{
    label: string;
    words?: boolean;
    cell: (column: (typeof columns)[number]) => string;
  }> = [
    { label: t(k("table.monthlyPayment")), cell: ({ loan }) => money(loan.monthlyPayment) },
    { label: t(k("table.lastPayment")), cell: ({ loan }) => money(loan.lastPayment) },
    { label: t(k("table.timeLeft")), words: true, cell: ({ loan }) => duration(loan.months) },
    {
      label: t(k("table.payoffMonth")),
      words: true,
      cell: ({ loan }) => payoffMonth(loan.months),
    },
    { label: t(k("table.totalInterest")), cell: ({ loan }) => money(loan.totalInterest) },
    {
      label: t(k("table.interestSaved")),
      cell: ({ key }) => {
        const scenario = scenarioOf(key);
        return scenario ? money(scenario.interestSaved) : "—";
      },
    },
    {
      label: t(k("table.fee")),
      cell: ({ key }) => (key === "original" ? "—" : money(result.fee)),
    },
    {
      label: t(k("table.netSaving")),
      cell: ({ key }) => {
        const scenario = scenarioOf(key);
        return scenario ? money(scenario.netSaving) : "—";
      },
    },
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[36rem] text-sm">
        <caption className="sr-only">{t(k("table.caption"))}</caption>
        <thead className="bg-paper-2 text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              <span className="sr-only">{t(k("table.figure"))}</span>
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-3 py-2 text-right font-medium">
                {t(k(`table.${column.key}`))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-border-2">
              <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">
                {row.label}
              </th>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-right text-foreground",
                    !row.words && "font-mono",
                  )}
                >
                  {row.cell(column)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalanceChart({
  result,
  scenarios,
  money,
}: {
  result: EarlyRepaymentResult;
  scenarios: readonly Scenario[];
  money: Money;
}) {
  const { t, locale } = useTranslations();
  const series = [
    { key: "original" as const, color: "var(--chart-1)", dash: "4 4" },
    ...scenarios.map((key) => ({
      key,
      color: key === "lowerPayment" ? "var(--chart-2)" : "var(--chart-3)",
      dash: undefined,
    })),
  ];
  const data = result.original.yearEndBalances.map((_, year) => {
    const point: Record<string, number | undefined> = { year };
    for (const { key } of series) {
      const loan = key === "original" ? result.original : result[key];
      point[key] = loan.yearEndBalances[year];
    }
    return point;
  });

  return (
    <div className="h-64 w-full min-w-0" role="img" aria-label={t(k("chart.label"))}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
          <XAxis
            dataKey="year"
            label={{ value: t(k("chart.year")), position: "insideBottomRight", offset: -5 }}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            tickFormatter={(value: number) => formatMoney(locale, value, { compact: true })}
            tick={{ fontSize: 12 }}
            width={64}
          />
          <Tooltip
            // @ts-expect-error Recharts tooltip types are very broken
            formatter={(value: number, name: string) => [money(value, 0), name]}
          />
          <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
          {series.map(({ key, color, dash }) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={t(k(`table.${key}`))}
              stroke={`oklch(${color})`}
              strokeWidth={2}
              strokeDasharray={dash}
              dot={false}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function OriginalReference({
  original,
  duration,
  money,
}: {
  original: LoanOutlook;
  duration: (months: number) => string;
  money: Money;
}) {
  const { t } = useTranslations();
  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <h3 className="font-semibold text-foreground">{t(k("table.original"))}</h3>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
        <SummaryItem label={t(k("table.monthlyPayment"))} value={money(original.monthlyPayment)} />
        <SummaryItem label={t(k("table.timeLeft"))} value={duration(original.months)} />
        <SummaryItem label={t(k("table.totalInterest"))} value={money(original.totalInterest)} />
      </dl>
    </div>
  );
}

function UnusedNote({ result, money }: { result: EarlyRepaymentResult; money: Money }) {
  const { t } = useTranslations();
  return (
    <p className="text-sm text-muted-foreground">
      {t(k("status.unused"), {
        needed: money(result.repaymentApplied),
        unused: money(result.repaymentUnused),
      })}
    </p>
  );
}

function FeeExceedsNote() {
  const { t } = useTranslations();
  return <p className="text-sm text-destructive-text">{t(k("status.feeExceeds"))}</p>;
}
