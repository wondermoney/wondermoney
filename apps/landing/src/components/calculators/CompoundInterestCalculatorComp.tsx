import { useState, useMemo } from "react";
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
} from "recharts";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import { computeCompoundInterest } from "@/lib/calculators/compoundInterest";
import type { Lang } from "@/lib/i18nLocale";
import { toIntlLocale } from "@/lib/numberFormat";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function CompoundInterestCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <CompoundInterestCalculatorCompContent />
    </ReactTranslationsProvider>
  );
}

function CompoundInterestCalculatorCompContent() {
  const { t, locale } = useTranslations();

  const eurFormatter = useMemo(
    () =>
      new Intl.NumberFormat(toIntlLocale(locale), {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }),
    [locale],
  );

  const [principal, setPrincipal] = useState(10000);
  const [monthlyContribution, setMonthlyContribution] = useState(200);
  const [annualRate, setAnnualRate] = useState(7);
  const [years, setYears] = useState(20);

  const { chartData, finalBalance, totalContributions, totalInterest } =
    useMemo(() => {
      return computeCompoundInterest({
        principal,
        monthlyContribution,
        annualRate,
        years,
      });
    }, [principal, monthlyContribution, annualRate, years]);

  return (
    <CalculatorLayout>
      {/* Inputs */}
      <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
        <CalculatorInput
          id="principal"
          label={t("tools.compoundInterest.initialInvestment")}
          value={principal}
          onChange={setPrincipal}
          min={0}
          max={10000000}
          step={500}
          prefix={"\u20AC"}
        />
        <CalculatorInput
          id="monthly"
          label={t("tools.compoundInterest.monthlyContribution")}
          value={monthlyContribution}
          onChange={setMonthlyContribution}
          min={0}
          max={100000}
          step={50}
          prefix={"\u20AC"}
        />
        <CalculatorInput
          id="rate"
          label={t("tools.compoundInterest.annualReturn")}
          value={annualRate}
          onChange={setAnnualRate}
          min={0}
          max={30}
          step={0.5}
          suffix="%"
          helpText={t("tools.compoundInterest.rateHelp")}
        />
        <CalculatorInput
          id="years"
          label={t("tools.compoundInterest.investmentPeriod")}
          value={years}
          onChange={setYears}
          min={1}
          max={50}
          step={1}
          suffix={t("tools.compoundInterest.years")}
        />
      </div>

      {/* Results */}
      <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm sticky top-20 lg:top-24">
        <CalculatorResult
          items={[
            {
              label: t("tools.compoundInterest.totalContributions"),
              value: eurFormatter.format(totalContributions),
            },
            {
              label: t("tools.compoundInterest.totalInterest"),
              value: eurFormatter.format(totalInterest),
            },
            {
              label: t("tools.compoundInterest.finalBalance"),
              value: eurFormatter.format(finalBalance),
              highlight: true,
            },
          ]}
        />

        {/* Chart */}
        <div className="h-72 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="oklch(var(--border))"
              />
              <XAxis
                dataKey="year"
                label={{
                  value: t("tools.compoundInterest.year"),
                  position: "insideBottomRight",
                  offset: -5,
                }}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                tickFormatter={(v: number) => `\u20AC${Math.round(v / 1000)}k`}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                // @ts-expect-error Recharts tooltip types are very broken
                formatter={(value: number, name: string) => [
                  eurFormatter.format(value),
                  name,
                ]}
              />
              <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
              <Area
                type="monotone"
                dataKey="contributions"
                name={t("tools.compoundInterest.contributions")}
                stackId="1"
                stroke="oklch(var(--primary))"
                fill="oklch(var(--primary) / 0.3)"
              />
              <Area
                type="monotone"
                dataKey="interest"
                name={t("tools.compoundInterest.interestEarned")}
                stackId="1"
                stroke="oklch(var(--chart-3))"
                fill="oklch(var(--chart-3) / 0.3)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </CalculatorLayout>
  );
}
