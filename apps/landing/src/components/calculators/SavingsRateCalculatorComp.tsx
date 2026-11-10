import { useState, useMemo } from "react";
import { useTranslations } from "@/lib/reactTranslations";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import { computeSavingsRate } from "@/lib/calculators/savingsRate";
import type { Lang } from "@/lib/i18nLocale";
import { formatPercent, toIntlLocale } from "@/lib/numberFormat";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

function getSavingsRateColor(rate: number): string {
  if (rate >= 50) return "bg-success";
  if (rate >= 20) return "bg-success";
  if (rate >= 10) return "bg-chart-2";
  if (rate > 0) return "bg-chart-4";
  return "bg-destructive";
}

function getSavingsRateLabel(rate: number, t: (key: string) => string): string {
  if (rate >= 50) return t("tools.savingsRate.labelExcellent");
  if (rate >= 20) return t("tools.savingsRate.labelGreat");
  if (rate >= 10) return t("tools.savingsRate.labelGood");
  if (rate > 0) return t("tools.savingsRate.labelLow");
  return t("tools.savingsRate.labelNone");
}

export default function SavingsRateCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <SavingsRateCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function SavingsRateCalculatorContent() {
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

  const [monthlyIncome, setMonthlyIncome] = useState(2500);
  const [monthlyExpenses, setMonthlyExpenses] = useState(1800);
  const [monthlyDeductions, setMonthlyDeductions] = useState(0);
  const [includeDuodecimos, setIncludeDuodecimos] = useState(false);
  const [duodecimosAnnualAmount, setDuodecimosAnnualAmount] = useState(0);

  const { monthlySavings, savingsRate, annualSavings } = useMemo(() => {
    return computeSavingsRate({
      monthlyIncome,
      monthlyExpenses,
      monthlyDeductions,
      includeDuodecimos,
      duodecimosAnnualAmount,
    });
  }, [
    monthlyIncome,
    monthlyExpenses,
    monthlyDeductions,
    includeDuodecimos,
    duodecimosAnnualAmount,
  ]);

  const clampedRate = Math.max(0, Math.min(100, savingsRate));

  return (
    <CalculatorLayout>
      {/* Inputs */}
      <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
        <CalculatorInput
          id="monthlyIncome"
          label={t("tools.savingsRate.monthlyIncome")}
          value={monthlyIncome}
          onChange={setMonthlyIncome}
          min={0}
          max={100000}
          step={100}
          prefix={"\u20AC"}
          helpText={t("tools.savingsRate.incomeHelp")}
        />
        <CalculatorInput
          id="monthlyExpenses"
          label={t("tools.savingsRate.monthlyExpenses")}
          value={monthlyExpenses}
          onChange={setMonthlyExpenses}
          min={0}
          max={100000}
          step={50}
          prefix={"\u20AC"}
          helpText={t("tools.savingsRate.expensesHelp")}
        />
        <CalculatorInput
          id="monthlyDeductions"
          label={t("tools.savingsRate.monthlyDeductions")}
          value={monthlyDeductions}
          onChange={setMonthlyDeductions}
          min={0}
          max={100000}
          step={50}
          prefix={"\u20AC"}
          helpText={t("tools.savingsRate.deductionsHelp")}
        />
        <div className="space-y-1.5">
          <label
            htmlFor="includeDuodecimos"
            className="flex items-center gap-2 text-sm font-medium text-foreground"
          >
            <input
              id="includeDuodecimos"
              type="checkbox"
              checked={includeDuodecimos}
              onChange={(e) => setIncludeDuodecimos(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
            />
            {t("tools.savingsRate.includeDuodecimos")}
          </label>
          <p className="text-xs text-muted-foreground">
            {t("tools.savingsRate.duodecimosHelp")}
          </p>
        </div>
        {includeDuodecimos && (
          <CalculatorInput
            id="duodecimosAnnualAmount"
            label={t("tools.savingsRate.duodecimosAnnualAmount")}
            value={duodecimosAnnualAmount}
            onChange={setDuodecimosAnnualAmount}
            min={0}
            max={100000}
            step={100}
            prefix={"\u20AC"}
          />
        )}
      </div>

      {/* Results */}
      <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm sticky top-20 lg:top-24">
        <CalculatorResult
          items={[
            {
              label: t("tools.savingsRate.monthlySavings"),
              value: eurFormatter.format(monthlySavings),
            },
            {
              label: t("tools.savingsRate.annualSavings"),
              value: eurFormatter.format(annualSavings),
            },
            {
              label: t("tools.savingsRate.savingsRate"),
              value: formatPercent(locale, savingsRate),
              highlight: true,
            },
          ]}
        />

        {/* Savings Rate Bar */}
        <div className="space-y-3">
          <div className="relative h-6 w-full overflow-hidden rounded-full bg-paper-2">
            <div
              className={`h-full w-full origin-left rounded-full transition-transform duration-500 motion-reduce:transition-none ${getSavingsRateColor(savingsRate)}`}
              style={{ transform: `scaleX(${clampedRate / 100})` }}
            />
            {/* Benchmark markers */}
            <div
              className="absolute top-0 h-full w-0.5 bg-muted-foreground"
              style={{ left: "20%" }}
              title="20% — Recommended minimum"
            />
            <div
              className="absolute top-0 h-full w-0.5 bg-muted-foreground"
              style={{ left: "50%" }}
              title="50% — FIRE target"
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>20%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
          <p className="text-sm font-medium text-foreground">
            {getSavingsRateLabel(savingsRate, t)}
          </p>
        </div>
      </div>
    </CalculatorLayout>
  );
}
