import { useState, useMemo } from "react";
import { useTranslations } from "@/lib/reactTranslations";
import {
  BarChart,
  Bar,
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

export default function NetWorthCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <NetWorthCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function NetWorthCalculatorContent() {
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

  // Assets
  const [cashSavings, setCashSavings] = useState(15000);
  const [investments, setInvestments] = useState(25000);
  const [realEstate, setRealEstate] = useState(0);
  const [vehicles, setVehicles] = useState(8000);
  const [otherAssets, setOtherAssets] = useState(0);

  // Liabilities
  const [mortgage, setMortgage] = useState(0);
  const [studentLoans, setStudentLoans] = useState(5000);
  const [creditCardDebt, setCreditCardDebt] = useState(1000);
  const [otherDebt, setOtherDebt] = useState(0);

  const { totalAssets, totalLiabilities, netWorth, chartData } = useMemo(() => {
    const assets =
      cashSavings + investments + realEstate + vehicles + otherAssets;
    const liabilities = mortgage + studentLoans + creditCardDebt + otherDebt;
    const net = assets - liabilities;

    const data = [
      {
        name: t("tools.netWorth.assetsLabel"),
        value: assets,
      },
      {
        name: t("tools.netWorth.liabilitiesLabel"),
        value: liabilities,
      },
    ];

    return {
      totalAssets: assets,
      totalLiabilities: liabilities,
      netWorth: net,
      chartData: data,
    };
  }, [
    cashSavings,
    investments,
    realEstate,
    vehicles,
    otherAssets,
    mortgage,
    studentLoans,
    creditCardDebt,
    otherDebt,
    t,
  ]);

  return (
    <CalculatorLayout>
      {/* Inputs */}
      <div className="space-y-6">
        {/* Assets */}
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-foreground">
            {t("tools.netWorth.assets")}
          </h3>
          <CalculatorInput
            id="cashSavings"
            label={t("tools.netWorth.cashSavings")}
            value={cashSavings}
            onChange={setCashSavings}
            min={0}
            max={10000000}
            step={500}
            prefix={"\u20AC"}
          />
          <CalculatorInput
            id="investments"
            label={t("tools.netWorth.investments")}
            value={investments}
            onChange={setInvestments}
            min={0}
            max={10000000}
            step={500}
            prefix={"\u20AC"}
          />
          <CalculatorInput
            id="realEstate"
            label={t("tools.netWorth.realEstate")}
            value={realEstate}
            onChange={setRealEstate}
            min={0}
            max={10000000}
            step={5000}
            prefix={"\u20AC"}
          />
          <CalculatorInput
            id="vehicles"
            label={t("tools.netWorth.vehicles")}
            value={vehicles}
            onChange={setVehicles}
            min={0}
            max={1000000}
            step={500}
            prefix={"\u20AC"}
          />
          <CalculatorInput
            id="otherAssets"
            label={t("tools.netWorth.otherAssets")}
            value={otherAssets}
            onChange={setOtherAssets}
            min={0}
            max={10000000}
            step={500}
            prefix={"\u20AC"}
          />
        </div>

        {/* Liabilities */}
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-foreground">
            {t("tools.netWorth.liabilities")}
          </h3>
          <CalculatorInput
            id="mortgage"
            label={t("tools.netWorth.mortgage")}
            value={mortgage}
            onChange={setMortgage}
            min={0}
            max={10000000}
            step={5000}
            prefix={"\u20AC"}
          />
          <CalculatorInput
            id="studentLoans"
            label={t("tools.netWorth.studentLoans")}
            value={studentLoans}
            onChange={setStudentLoans}
            min={0}
            max={1000000}
            step={500}
            prefix={"\u20AC"}
          />
          <CalculatorInput
            id="creditCardDebt"
            label={t("tools.netWorth.creditCardDebt")}
            value={creditCardDebt}
            onChange={setCreditCardDebt}
            min={0}
            max={500000}
            step={100}
            prefix={"\u20AC"}
          />
          <CalculatorInput
            id="otherDebt"
            label={t("tools.netWorth.otherDebt")}
            value={otherDebt}
            onChange={setOtherDebt}
            min={0}
            max={5000000}
            step={500}
            prefix={"\u20AC"}
          />
        </div>
      </div>

      {/* Results */}
      <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm sticky top-20 lg:top-24">
        <CalculatorResult
          items={[
            {
              label: t("tools.netWorth.totalAssets"),
              value: eurFormatter.format(totalAssets),
            },
            {
              label: t("tools.netWorth.totalLiabilities"),
              value: eurFormatter.format(totalLiabilities),
            },
            {
              label: t("tools.netWorth.netWorth"),
              value: eurFormatter.format(netWorth),
              highlight: true,
            },
          ]}
        />

        {/* Chart */}
        <div className="h-72 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="oklch(var(--border))"
              />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis
                tickFormatter={(v: number) => `\u20AC${Math.round(v / 1000)}k`}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                // @ts-expect-error Recharts tooltip types are very broken
                formatter={(value: number) => [eurFormatter.format(value)]}
              />
              <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
              <Bar
                dataKey="value"
                name={t("tools.netWorth.netWorth")}
                fill="oklch(var(--primary))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </CalculatorLayout>
  );
}
