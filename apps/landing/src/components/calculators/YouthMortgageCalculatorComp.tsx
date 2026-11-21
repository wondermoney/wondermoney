import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  YOUTH_GUARANTEE,
  YOUTH_MORTGAGE_EXAMPLE,
  YOUTH_MORTGAGE_LIMITS,
  checkGuaranteeConditions,
  computeYouthMortgage,
  type YouthMortgageField,
} from "@/lib/calculators/youthMortgage";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { cn } from "@/lib/utils";

const k = (key: string) => `tools.youthMortgage.${key}`;

export default function YouthMortgageCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <YouthMortgageCalculator />
    </ReactTranslationsProvider>
  );
}

function YouthMortgageCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState(YOUTH_MORTGAGE_EXAMPLE);
  const [age, setAge] = useState(NaN);
  const [income, setIncome] = useState(NaN);
  const [ownPermanentHome, setOwnPermanentHome] = useState(true);
  const [ownsOtherProperty, setOwnsOtherProperty] = useState(false);
  const used = useRef(false);
  const calculation = computeYouthMortgage(input);
  const result = calculation.ok ? calculation.result : null;
  const money = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });

  useEffect(() => {
    if (input === YOUTH_MORTGAGE_EXAMPLE || !result || used.current) return;
    used.current = true;
    pushGtmEvent({ event: "tool_used", tool: "youth_mortgage", page_type: getPageType() });
  }, [input, result]);

  const field = (id: YouthMortgageField, opts: { prefix?: string; suffix?: string; max: number; step?: number }) => {
    const error = calculation.ok ? undefined : calculation.errors[id];
    return (
      <CalculatorInput
        id={`youthMortgage-${id}`}
        label={t(k(`fields.${id}`))}
        helpText={t(k(`help.${id}`))}
        value={input[id]}
        onChange={(value) => setInput((current) => ({ ...current, [id]: value }))}
        min={0}
        max={opts.max}
        step={opts.step ?? 1}
        prefix={opts.prefix}
        suffix={opts.suffix}
        error={error ? t(k(`errors.${error}`), { max: formatMoney(locale, opts.max, { decimals: 0 }) }) : undefined}
      />
    );
  };

  const check = checkGuaranteeConditions({
    age, income, ownPermanentHome, ownsOtherProperty, price: input.price,
  });
  const values = {
    minAge: String(YOUTH_GUARANTEE.minAge),
    maxAge: String(YOUTH_GUARANTEE.maxAge),
    maxPrice: money(YOUTH_GUARANTEE.maxPrice, 0),
    maxIncome: money(YOUTH_GUARANTEE.maxIncome, 0),
    percent: String(YOUTH_GUARANTEE.guaranteePercent),
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="youthMortgage-check-title" className="rounded-card border border-border bg-background p-6">
        <h2 id="youthMortgage-check-title" className="text-lg font-semibold">{t(k("checkTitle"))}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(k("checkIntro"))}</p>
        <p
          id="youthMortgage-deadline"
          role="note"
          className="mt-4 rounded-lg bg-warning/10 px-4 py-3 text-sm text-foreground"
        >
          {t(k("deadlineNotice"))}
        </p>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <CalculatorInput
              id="youthMortgage-age"
              label={t(k("fields.age"))}
              value={age}
              onChange={setAge}
              min={0}
              max={120}
              step={1}
            />
            <CalculatorInput
              id="youthMortgage-income"
              label={t(k("fields.income"))}
              helpText={t(k("help.income"))}
              value={income}
              onChange={setIncome}
              min={0}
              max={YOUTH_MORTGAGE_LIMITS.price}
              step={1}
              prefix="€"
            />
            <Check id="youthMortgage-ownHome" checked={ownPermanentHome} onChange={setOwnPermanentHome} label={t(k("fields.ownHome"))} />
            <Check id="youthMortgage-otherProperty" checked={ownsOtherProperty} onChange={setOwnsOtherProperty} label={t(k("fields.otherProperty"))} />
          </div>
          <div aria-live="polite">
            <ul className="space-y-2 text-sm">
              {check.conditions.map((condition) => (
                <li key={condition.id} className="flex items-start gap-2" data-status={condition.status}>
                  <span
                    className={cn(
                      "mt-0.5 inline-flex shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold",
                      condition.status === "met" && "bg-primary/10 text-primary",
                      condition.status === "notMet" && "bg-destructive/10 text-destructive",
                      condition.status === "unknown" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {t(k(`status.${condition.status}`))}
                  </span>
                  <span>{t(k(`conditions.${condition.id}`), values)}</span>
                </li>
              ))}
            </ul>
            <p id="youthMortgage-check-summary" className="mt-4 text-sm font-medium text-foreground">
              {t(k("checkSummary"), { met: String(check.met), total: String(check.total) })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(k("checkNote"), { date: YOUTH_GUARANTEE.reviewedOn, percent: values.percent })}
            </p>
          </div>
        </div>
      </section>

      <CalculatorLayout>
        <div className="space-y-4 rounded-card border border-border bg-background p-6">
          <h2 className="text-lg font-semibold">{t(k("estimateTitle"))}</h2>
          {field("price", { prefix: "€", max: YOUTH_MORTGAGE_LIMITS.price })}
          {field("deposit", { prefix: "€", max: YOUTH_MORTGAGE_LIMITS.deposit })}
          {field("annualRate", { suffix: "%", max: YOUTH_MORTGAGE_LIMITS.annualRate, step: 0.05 })}
          {field("termYears", { suffix: t(k("years")), max: YOUTH_MORTGAGE_LIMITS.maxTermYears })}
        </div>
        <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
          {!result && <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>}
          {result && (
            <>
              <CalculatorResult
                items={[
                  { label: t(k("result.monthly")), value: money(result.monthlyPayment), highlight: true, id: "youthMortgage-monthly" },
                  { label: t(k("result.loan")), value: money(result.loan) },
                  { label: t(k("result.ltv")), value: formatPercent(locale, result.ltv, { decimals: 1 }) },
                  { label: t(k("result.interest")), value: money(result.totalInterest) },
                  { label: t(k("result.taxesWithout")), value: money(result.taxesWithout) },
                  { label: t(k("result.taxesWith")), value: money(result.taxesWithYoung) },
                  { label: t(k("result.cashWithout")), value: money(result.cashWithout) },
                  { label: t(k("result.cashWith")), value: money(result.cashWithYoung) },
                ]}
              />
              {result.loan === 0 && <p className="text-sm text-muted-foreground">{t(k("result.noLoan"))}</p>}
              <p className="text-xs text-muted-foreground">{t(k("result.exemptionNote"), values)}</p>
              <p className="text-xs text-muted-foreground">{t(k("result.bankNote"))}</p>
            </>
          )}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {result ? `${t(k("result.monthly"))}: ${money(result.monthlyPayment)}` : ""}
          </p>
        </div>
      </CalculatorLayout>
    </div>
  );
}

function Check({
  id, checked, onChange, label,
}: { id: string; checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex items-start gap-3 text-sm font-medium text-foreground">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4" />
      <span>{label}</span>
    </label>
  );
}
