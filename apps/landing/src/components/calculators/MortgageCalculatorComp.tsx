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
import type { Lang } from "@/lib/i18nLocale";
import { toIntlLocale } from "@/lib/numberFormat";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function MortgageCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <MortgageCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function MortgageCalculatorContent() {
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

  const [propertyPrice, setPropertyPrice] = useState(250000);
  const [downPaymentPct, setDownPaymentPct] = useState(20);
  const [interestRate, setInterestRate] = useState(3.5);
  const [loanTerm, setLoanTerm] = useState(30);

  const { monthlyPayment, totalInterest, totalCost, loanAmount, chartData } =
    useMemo(() => {
      const downPayment = propertyPrice * (downPaymentPct / 100);
      const loan = propertyPrice - downPayment;
      const monthlyRate = interestRate / 100 / 12;
      const numPayments = loanTerm * 12;

      let monthly = 0;
      if (monthlyRate > 0 && numPayments > 0) {
        monthly =
          (loan * (monthlyRate * Math.pow(1 + monthlyRate, numPayments))) /
          (Math.pow(1 + monthlyRate, numPayments) - 1);
      } else if (numPayments > 0) {
        monthly = loan / numPayments;
      }

      const total = monthly * numPayments;
      const interest = total - loan;

      // Build amortization data (yearly)
      const data: {
        year: number;
        principal: number;
        interest: number;
      }[] = [];

      let balance = loan;
      let cumulativePrincipal = 0;
      let cumulativeInterest = 0;

      for (let y = 1; y <= loanTerm; y++) {
        let yearPrincipal = 0;
        let yearInterest = 0;

        for (let m = 0; m < 12; m++) {
          if (balance <= 0) break;
          const interestPayment = balance * monthlyRate;
          const principalPayment = Math.min(monthly - interestPayment, balance);
          balance -= principalPayment;
          yearPrincipal += principalPayment;
          yearInterest += interestPayment;
        }

        cumulativePrincipal += yearPrincipal;
        cumulativeInterest += yearInterest;

        data.push({
          year: y,
          principal: Math.round(cumulativePrincipal),
          interest: Math.round(cumulativeInterest),
        });
      }

      return {
        monthlyPayment: Math.round(monthly),
        totalInterest: Math.round(interest),
        totalCost: Math.round(total),
        loanAmount: Math.round(loan),
        chartData: data,
      };
    }, [propertyPrice, downPaymentPct, interestRate, loanTerm]);

  return (
    <CalculatorLayout>
      {/* Inputs */}
      <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
        <CalculatorInput
          id="propertyPrice"
          label={t("tools.mortgage.propertyPrice")}
          value={propertyPrice}
          onChange={setPropertyPrice}
          min={10000}
          max={10000000}
          step={5000}
          prefix={"\u20AC"}
        />
        <CalculatorInput
          id="downPayment"
          label={t("tools.mortgage.downPayment")}
          value={downPaymentPct}
          onChange={setDownPaymentPct}
          min={0}
          max={100}
          step={1}
          suffix="%"
        />
        <CalculatorInput
          id="interestRate"
          label={t("tools.mortgage.interestRate")}
          value={interestRate}
          onChange={setInterestRate}
          min={0}
          max={20}
          step={0.1}
          suffix="%"
          helpText={t("tools.mortgage.rateHelp")}
        />
        <CalculatorInput
          id="loanTerm"
          label={t("tools.mortgage.loanTerm")}
          value={loanTerm}
          onChange={setLoanTerm}
          min={1}
          max={50}
          step={1}
          suffix={t("tools.mortgage.years")}
        />
      </div>

      {/* Results */}
      <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm sticky top-20 lg:top-24">
        <CalculatorResult
          items={[
            {
              label: t("tools.mortgage.loanAmount"),
              value: eurFormatter.format(loanAmount),
            },
            {
              label: t("tools.mortgage.totalInterest"),
              value: eurFormatter.format(totalInterest),
            },
            {
              label: t("tools.mortgage.totalCost"),
              value: eurFormatter.format(totalCost),
            },
            {
              label: t("tools.mortgage.monthlyPayment"),
              value: eurFormatter.format(monthlyPayment),
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
                  value: t("tools.mortgage.year"),
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
                dataKey="principal"
                name={t("tools.mortgage.principal")}
                stackId="1"
                stroke="oklch(var(--primary))"
                fill="oklch(var(--primary) / 0.3)"
              />
              <Area
                type="monotone"
                dataKey="interest"
                name={t("tools.mortgage.interest")}
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
