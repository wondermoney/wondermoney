import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  CAR_LOAN_EXAMPLE,
  CAR_LOAN_LIMITS,
  computeCarLoan,
  isCashPurchase,
  type CarLoanField,
} from "@/lib/calculators/carLoan";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.carLoan.${key}`;
const purchaseFields = ["price", "deposit"] as const;
const financingFields = ["termMonths", "annualRate", "upfrontFees", "monthlyFees"] as const;
const runningFields = ["monthlyFuel", "annualInsurance", "annualTax", "annualMaintenance"] as const;
const maxShownApr = 1000;

export default function CarLoanCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <CarLoanCalculator />
    </ReactTranslationsProvider>
  );
}

function CarLoanCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState(CAR_LOAN_EXAMPLE);
  const used = useRef(false);
  const calculation = computeCarLoan(input);
  const valid = calculation.ok;
  const cash = isCashPurchase(input);

  useEffect(() => {
    if (input === CAR_LOAN_EXAMPLE || !valid || used.current) return;
    used.current = true;
    pushGtmEvent({ event: "tool_used", tool: "car_loan", page_type: getPageType() });
  }, [input, valid]);

  const money = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const field = (id: CarLoanField) => {
    const error = calculation.ok ? undefined : calculation.errors[id];
    const max = CAR_LOAN_LIMITS[id];
    const isMoney = id !== "annualRate" && id !== "termMonths";
    const formattedMax = isMoney
      ? formatMoney(locale, max, { decimals: 0 })
      : id === "annualRate"
        ? formatPercent(locale, max, { decimals: 0 })
        : formatNumber(locale, max);
    return (
      <CalculatorInput
        key={id}
        id={`carLoan-${id}`}
        label={t(k(`fields.${id}`))}
        value={input[id]}
        onChange={(value) => setInput((current) => ({ ...current, [id]: value }))}
        min={id === "termMonths" ? 1 : 0}
        max={max}
        step={id === "annualRate" ? 0.01 : 1}
        prefix={isMoney ? "€" : undefined}
        suffix={id === "annualRate" ? "%" : undefined}
        error={error ? t(k(`errors.${error}`), { max: formattedMax }) : undefined}
      />
    );
  };

  const result = calculation.ok ? calculation.result : null;
  const apr = result?.apr;
  const aprText = apr == null
    ? t(k("aprUnavailable"))
    : apr > maxShownApr
      ? t(k("aprOver"), { max: formatPercent(locale, maxShownApr, { decimals: 0 }) })
      : formatPercent(locale, apr, { decimals: 2 });

  return (
    <CalculatorLayout>
      <div className="space-y-6 rounded-card border border-border bg-background p-6">
        <fieldset className="space-y-4">
          <legend className="mb-3 text-lg font-semibold">{t(k("financingTitle"))}</legend>
          {purchaseFields.map(field)}
          {cash ? (
            <p className="text-sm text-muted-foreground">{t(k("cashNote"))}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t(k("financingNote"))}</p>
              {financingFields.map(field)}
            </>
          )}
        </fieldset>
        <fieldset className="space-y-4 border-t border-border pt-4">
          <legend className="pr-3 text-lg font-semibold">{t(k("runningTitle"))}</legend>
          <p className="text-sm text-muted-foreground">{t(k("runningNote"))}</p>
          {runningFields.map(field)}
        </fieldset>
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        <div aria-live="polite" aria-atomic="true">
          {result ? (
            <>
              <p className="text-sm text-muted-foreground">{t(k(cash ? "result.monthlyRunning" : "result.monthlyBudget"))}</p>
              <p id="carLoan-monthlyBudget" className="font-mono text-3xl font-bold text-primary">
                {money(result.monthlyBudget)}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
        {result && (
          <>
            <CalculatorResult
              items={[
                ...(cash ? [] : [
                  { label: t(k("result.monthlyPayment")), value: money(result.monthlyPayment) },
                  { label: t(k("result.monthlyRunning")), value: money(result.monthlyRunning) },
                ]),
                { label: t(k("result.monthlyFuel")), value: money(result.monthlyFuel) },
                { label: t(k("result.monthlyInsurance")), value: money(result.monthlyInsurance) },
                { label: t(k("result.monthlyTax")), value: money(result.monthlyTax) },
                { label: t(k("result.monthlyMaintenance")), value: money(result.monthlyMaintenance) },
              ]}
            />
            <CalculatorResult
              items={[
                { label: t(k("result.cashAtPurchase")), value: money(result.cashAtPurchase) },
                ...(cash ? [] : [
                  { label: t(k("result.financedAmount")), value: money(result.financedAmount) },
                  { label: t(k("result.financingCost")), value: money(result.financingCost) },
                  { label: t(k("result.purchaseWithFinancing")), value: money(result.purchaseWithFinancing) },
                  { label: t(k("result.apr")), value: aprText },
                ]),
              ]}
            />
          </>
        )}
      </div>
    </CalculatorLayout>
  );
}
