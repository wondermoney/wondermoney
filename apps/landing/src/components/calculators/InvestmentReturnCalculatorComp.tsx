import { useState, useMemo } from "react";
import { useTranslations } from "@/lib/reactTranslations";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import type { Lang } from "@/lib/i18nLocale";
import { formatPercent, toIntlLocale } from "@/lib/numberFormat";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function InvestmentReturnCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <InvestmentReturnCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function InvestmentReturnCalculatorContent() {
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

  const [initialInvestment, setInitialInvestment] = useState(10000);
  const [currentValue, setCurrentValue] = useState(15000);
  const [years, setYears] = useState(5);

  const { totalReturn, totalReturnPct, annualizedReturn } = useMemo(() => {
    const returnAmount = currentValue - initialInvestment;
    const returnPct =
      initialInvestment > 0 ? (returnAmount / initialInvestment) * 100 : 0;

    // CAGR formula: (endValue / startValue)^(1/years) - 1
    let cagr = 0;
    if (initialInvestment > 0 && years > 0 && currentValue > 0) {
      cagr =
        (Math.pow(currentValue / initialInvestment, 1 / years) - 1) * 100;
    }

    return {
      totalReturn: returnAmount,
      totalReturnPct: Math.round(returnPct * 10) / 10,
      annualizedReturn: Math.round(cagr * 100) / 100,
    };
  }, [initialInvestment, currentValue, years]);

  return (
    <CalculatorLayout>
      {/* Inputs */}
      <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
        <CalculatorInput
          id="initialInvestment"
          label={t("tools.investmentReturn.initialInvestment")}
          value={initialInvestment}
          onChange={setInitialInvestment}
          min={1}
          max={10000000}
          step={500}
          prefix={"\u20AC"}
        />
        <CalculatorInput
          id="currentValue"
          label={t("tools.investmentReturn.currentValue")}
          value={currentValue}
          onChange={setCurrentValue}
          min={0}
          max={100000000}
          step={500}
          prefix={"\u20AC"}
        />
        <CalculatorInput
          id="years"
          label={t("tools.investmentReturn.investmentPeriod")}
          value={years}
          onChange={setYears}
          min={1}
          max={100}
          step={1}
          suffix={t("tools.investmentReturn.years")}
          helpText={t("tools.investmentReturn.periodHelp")}
        />
      </div>

      {/* Results */}
      <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm sticky top-20 lg:top-24">
        <CalculatorResult
          items={[
            {
              label: t("tools.investmentReturn.totalReturn"),
              value: eurFormatter.format(totalReturn),
            },
            {
              label: t("tools.investmentReturn.totalReturnPct"),
              value: formatPercent(locale, totalReturnPct),
            },
            {
              label: t("tools.investmentReturn.annualizedReturn"),
              value: formatPercent(locale, annualizedReturn, { decimals: 2 }),
              highlight: true,
            },
          ]}
        />
      </div>
    </CalculatorLayout>
  );
}
