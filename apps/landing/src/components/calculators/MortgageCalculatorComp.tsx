import { Fragment, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "@/lib/reactTranslations";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "@/components/shared/charts";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import {
  MORTGAGE_EXAMPLE,
  MORTGAGE_LIMITS,
  computeMortgage,
  type MortgageField,
  type MortgageInputError,
  type MortgageYear,
} from "@/lib/calculators/mortgage";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { cn } from "@/lib/utils";

export default function MortgageCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <MortgageCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function MortgageCalculatorContent() {
  const { t, locale } = useTranslations();

  const [loanAmount, setLoanAmount] = useState<number>(MORTGAGE_EXAMPLE.loanAmount);
  const [termYears, setTermYears] = useState<number>(MORTGAGE_EXAMPLE.termYears);
  const [annualRate, setAnnualRate] = useState<number>(MORTGAGE_EXAMPLE.annualRate);
  const [monthlyFees, setMonthlyFees] = useState<number>(MORTGAGE_EXAMPLE.monthlyFees);

  const calculation = useMemo(
    () => computeMortgage({ loanAmount, termYears, annualRate, monthlyFees }),
    [loanAmount, termYears, annualRate, monthlyFees],
  );

  // The shared landing tool event: one `tool_used` per page view, on the visitor's first edit,
  // without amounts. pushGtmEvent drops it unless analytics consent was given.
  const usageSent = useRef(false);
  const edit = (setter: (value: number) => void) => (value: number) => {
    if (!usageSent.current) {
      usageSent.current = true;
      pushGtmEvent({ event: "tool_used", tool: "mortgage", page_type: getPageType() });
    }
    setter(value);
  };

  const money = (value: number, decimals = 0) => formatMoney(locale, value, { decimals });

  const limits: Record<MortgageField, string> = {
    loanAmount: money(MORTGAGE_LIMITS.maxLoanAmount),
    termYears: formatNumber(locale, MORTGAGE_LIMITS.maxTermYears),
    annualRate: formatPercent(locale, MORTGAGE_LIMITS.maxAnnualRate, { decimals: 0 }),
    monthlyFees: money(MORTGAGE_LIMITS.maxMonthlyFees),
  };
  const errorFor = (field: MortgageField): string | undefined => {
    if (calculation.ok) return undefined;
    const error: MortgageInputError | undefined = calculation.errors[field];
    return error
      ? t(`tools.mortgage.errors.${field}.${error}`, {
          max: limits[field],
          min: money(MORTGAGE_LIMITS.minLoanAmount),
        })
      : undefined;
  };

  const result = calculation.ok ? calculation.result : null;
  const hasFees = result !== null && result.totalFees > 0;

  const chartData = useMemo(() => {
    if (!result) return [];
    let principal = 0;
    let interest = 0;
    return result.years.map((year) => {
      principal += year.principal;
      interest += year.interest;
      return { year: year.year, principal: Math.round(principal), interest: Math.round(interest) };
    });
  }, [result]);

  return (
    <>
      <CalculatorLayout>
        {/* Inputs */}
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <CalculatorInput
            id="mortgageLoanAmount"
            label={t("tools.mortgage.loanAmount")}
            value={loanAmount}
            onChange={edit(setLoanAmount)}
            min={MORTGAGE_LIMITS.minLoanAmount}
            max={MORTGAGE_LIMITS.maxLoanAmount}
            step={1000}
            prefix={"€"}
            helpText={t("tools.mortgage.loanAmountHelp")}
            error={errorFor("loanAmount")}
          />
          <CalculatorInput
            id="mortgageLoanTerm"
            label={t("tools.mortgage.loanTerm")}
            value={termYears}
            onChange={edit(setTermYears)}
            min={1}
            max={MORTGAGE_LIMITS.maxTermYears}
            step={1}
            suffix={t("tools.mortgage.years")}
            error={errorFor("termYears")}
          />
          <CalculatorInput
            id="mortgageInterestRate"
            label={t("tools.mortgage.interestRate")}
            value={annualRate}
            onChange={edit(setAnnualRate)}
            min={0}
            max={MORTGAGE_LIMITS.maxAnnualRate}
            step={0.05}
            suffix="%"
            helpText={t("tools.mortgage.rateHelp")}
            error={errorFor("annualRate")}
          />
          <CalculatorInput
            id="mortgageMonthlyFees"
            label={t("tools.mortgage.monthlyFees")}
            value={monthlyFees}
            onChange={edit(setMonthlyFees)}
            min={0}
            max={MORTGAGE_LIMITS.maxMonthlyFees}
            step={5}
            prefix={"€"}
            helpText={t("tools.mortgage.monthlyFeesHelp")}
            error={errorFor("monthlyFees")}
          />
        </div>

        {/* Results */}
        <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <>
              <CalculatorResult
                items={[
                  {
                    label: t("tools.mortgage.totalInterest"),
                    value: money(result.totalInterest, 2),
                  },
                  ...(hasFees
                    ? [
                        {
                          label: t("tools.mortgage.totalFees"),
                          value: money(result.totalFees, 2),
                        },
                      ]
                    : []),
                  {
                    label: t("tools.mortgage.totalPaid"),
                    value: money(result.totalPaid, 2),
                  },
                  ...(hasFees
                    ? [
                        {
                          label: t("tools.mortgage.monthlyPayment"),
                          value: money(result.monthlyPayment, 2),
                        },
                      ]
                    : []),
                  {
                    label: hasFees
                      ? t("tools.mortgage.monthlyTotal")
                      : t("tools.mortgage.monthlyPayment"),
                    value: money(result.monthlyTotal, 2),
                    highlight: true,
                  },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                {t("tools.mortgage.resultNote", {
                  payments: formatNumber(locale, result.numberOfPayments),
                })}
              </p>

              <div
                className="h-72 w-full min-w-0"
                role="img"
                aria-label={t("tools.mortgage.chartLabel")}
              >
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
                    <XAxis
                      dataKey="year"
                      label={{
                        value: t("tools.mortgage.year"),
                        position: "insideBottomRight",
                        offset: -5,
                      }}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      tickFormatter={(v: number) =>
                        formatMoney(locale, v, { compact: true })
                      }
                      tick={{ fontSize: 12 }}
                      width={64}
                    />
                    <Tooltip
                      // @ts-expect-error Recharts tooltip types are very broken
                      formatter={(value: number, name: string) => [money(value), name]}
                    />
                    <Legend
                      formatter={(value) => <span className="text-foreground">{value}</span>}
                    />
                    <Area
                      type="monotone"
                      dataKey="principal"
                      name={t("tools.mortgage.principal")}
                      stackId="1"
                      stroke="oklch(var(--chart-1))"
                      fill="oklch(var(--chart-1) / 0.3)"
                    />
                    <Area
                      type="monotone"
                      dataKey="interest"
                      name={t("tools.mortgage.interest")}
                      stackId="1"
                      stroke="oklch(var(--chart-2))"
                      fill="oklch(var(--chart-2) / 0.3)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("tools.mortgage.errors.summary")}</p>
          )}
        </div>
      </CalculatorLayout>

      {result && <AmortizationSchedule years={result.years} showFees={hasFees} money={money} />}
    </>
  );
}

function AmortizationSchedule({
  years,
  showFees,
  money,
}: {
  years: MortgageYear[];
  showFees: boolean;
  money: (value: number, decimals?: number) => string;
}) {
  const { t } = useTranslations();
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  const toggle = (year: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });

  const cell = "px-3 py-2 text-right font-mono whitespace-nowrap";

  return (
    <section className="mt-10" aria-labelledby="mortgage-schedule-title">
      <h2 id="mortgage-schedule-title" className="text-2xl font-semibold tracking-tight text-foreground">
        {t("tools.mortgage.schedule.title")}
      </h2>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        {t("tools.mortgage.schedule.description")}
      </p>

      <div className="mt-6 overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="bg-paper-2 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {t("tools.mortgage.schedule.period")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("tools.mortgage.schedule.payments")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("tools.mortgage.schedule.principal")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("tools.mortgage.schedule.interest")}
              </th>
              {showFees && (
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("tools.mortgage.schedule.fees")}
                </th>
              )}
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("tools.mortgage.schedule.balance")}
              </th>
            </tr>
          </thead>
          {years.map((year) => {
            const isOpen = open.has(year.year);
            const monthsId = `mortgage-schedule-year-${year.year}`;
            return (
              <Fragment key={year.year}>
              <tbody className="border-t border-border">
                <tr>
                  <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">
                    <button
                      type="button"
                      onClick={() => toggle(year.year)}
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? monthsId : undefined}
                      className="inline-flex items-center gap-1.5 rounded-md hover:text-primary"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                          isOpen && "rotate-90",
                        )}
                      />
                      {t("tools.mortgage.schedule.yearLabel", { year: year.year })}
                      <span className="sr-only">{t("tools.mortgage.schedule.showMonths")}</span>
                    </button>
                  </th>
                  <td className={cell}>{money(year.payment, 2)}</td>
                  <td className={cell}>{money(year.principal, 2)}</td>
                  <td className={cell}>{money(year.interest, 2)}</td>
                  {showFees && <td className={cell}>{money(year.fees, 2)}</td>}
                  <td className={cell}>{money(year.balance, 2)}</td>
                </tr>
              </tbody>
              {isOpen && (
                <tbody id={monthsId} className="bg-paper-2 text-muted-foreground">
                  {year.months.map((month) => (
                    <tr key={month.month}>
                      <th scope="row" className="py-1.5 pl-9 pr-3 text-left font-normal">
                        {t("tools.mortgage.schedule.monthLabel", { month: month.month })}
                      </th>
                      <td className={cn(cell, "py-1.5")}>{money(month.payment, 2)}</td>
                      <td className={cn(cell, "py-1.5")}>{money(month.principal, 2)}</td>
                      <td className={cn(cell, "py-1.5")}>{money(month.interest, 2)}</td>
                      {showFees && <td className={cn(cell, "py-1.5")}>{money(month.fees, 2)}</td>}
                      <td className={cn(cell, "py-1.5")}>{money(month.balance, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              )}
              </Fragment>
            );
          })}
        </table>
      </div>
    </section>
  );
}
