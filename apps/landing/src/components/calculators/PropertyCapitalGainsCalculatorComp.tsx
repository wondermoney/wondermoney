import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  CAPITAL_GAINS_EXAMPLE,
  CAPITAL_GAINS_LIMITS,
  CAPITAL_GAINS_TABLES,
  computeCapitalGains,
  type CapitalGainsField,
  type CapitalGainsInput,
} from "@/lib/calculators/propertyCapitalGains";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.propertyCapitalGains.${key}`;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const CHECKLIST = ["domicile", "reinvest", "declare", "occupy", "register"] as const;

export default function PropertyCapitalGainsCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <PropertyCapitalGainsCalculator />
    </ReactTranslationsProvider>
  );
}

function PropertyCapitalGainsCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<CapitalGainsInput>(CAPITAL_GAINS_EXAMPLE);
  const used = useRef(false);
  const calculation = computeCapitalGains(input);
  const valid = calculation.ok;
  const errors = calculation.ok ? {} : calculation.errors;
  const result = calculation.ok ? calculation.result : null;

  useEffect(() => {
    if (input === CAPITAL_GAINS_EXAMPLE || !valid || used.current) return;
    used.current = true;
    // Metadata only: never the values, dates, income or result.
    pushGtmEvent({ event: "tool_used", tool: "property_capital_gains", page_type: getPageType() });
  }, [input, valid]);

  const money = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, month - 1, 1)));
  const err = (field: CapitalGainsField) => {
    const code = (errors as Partial<Record<CapitalGainsField, string>>)[field];
    return code
      ? t(k(`errors.${code}`), {
          max: String(CAPITAL_GAINS_LIMITS.amount.toLocaleString(locale)),
          year: String(CAPITAL_GAINS_TABLES.firstYear),
          saleYear: String(CAPITAL_GAINS_TABLES.saleYear),
        })
      : undefined;
  };
  const amountField = (field: Exclude<CapitalGainsField, "purchaseYear" | "purchaseMonth" | "saleMonth">, help?: boolean) => (
    <CalculatorInput
      id={`capitalGains-${field}`}
      label={t(k(`fields.${field}`))}
      value={input[field] ?? Number.NaN}
      onChange={(value) => setInput((current) => ({ ...current, [field]: value }))}
      min={0}
      max={CAPITAL_GAINS_LIMITS.amount}
      prefix="€"
      helpText={help ? t(k(`help.${field}`)) : undefined}
      error={err(field)}
    />
  );
  const monthSelect = (field: "purchaseMonth" | "saleMonth") => (
    <div className="space-y-1.5">
      <label htmlFor={`capitalGains-${field}`} className="block text-sm font-medium text-foreground">
        {t(k(`fields.${field}`), { saleYear: String(CAPITAL_GAINS_TABLES.saleYear) })}
      </label>
      <select
        id={`capitalGains-${field}`}
        value={input[field]}
        onChange={(event) => {
          const month = Number(event.currentTarget.value);
          setInput((current) => ({ ...current, [field]: month }));
        }}
        className={selectClass}
        aria-invalid={errors[field] ? true : undefined}
      >
        {MONTHS.map((month) => (
          <option key={month} value={month}>{monthName(month)}</option>
        ))}
      </select>
      {errors[field] && <p role="alert" className="text-sm text-destructive">{err(field)}</p>}
    </div>
  );

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        <fieldset className="space-y-4">
          <legend className="mb-3 text-lg font-semibold">{t(k("sections.property"))}</legend>
          {amountField("saleValue")}
          {amountField("taxValue", true)}
          {amountField("purchaseValue", true)}
          <div className="grid gap-4 sm:grid-cols-2">
            <CalculatorInput
              id="capitalGains-purchaseYear"
              label={t(k("fields.purchaseYear"))}
              value={input.purchaseYear}
              onChange={(value) => setInput((current) => ({ ...current, purchaseYear: value }))}
              min={CAPITAL_GAINS_TABLES.firstYear}
              max={CAPITAL_GAINS_TABLES.saleYear}
              error={err("purchaseYear")}
            />
            {monthSelect("purchaseMonth")}
          </div>
          {monthSelect("saleMonth")}
          <p className="text-xs text-muted-foreground">{t(k("help.dates"), { saleYear: String(CAPITAL_GAINS_TABLES.saleYear) })}</p>
        </fieldset>
        <div className="border-t border-border pt-5">
          <fieldset className="space-y-4">
            <legend className="mb-3 text-lg font-semibold">{t(k("sections.expenses"))}</legend>
            {amountField("purchaseExpenses", true)}
            {amountField("worksExpenses", true)}
            {amountField("saleExpenses", true)}
          </fieldset>
        </div>
        <div className="border-t border-border pt-5">
          <fieldset className="space-y-4">
            <legend className="mb-3 text-lg font-semibold">{t(k("sections.income"))}</legend>
            {amountField("otherIncome", true)}
            <label className="flex items-start gap-3 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                id="capitalGains-joint"
                checked={input.joint}
                onChange={(event) => setInput((current) => ({ ...current, joint: event.target.checked }))}
                className="mt-1 h-4 w-4"
              />
              <span>{t(k("fields.joint"))}</span>
            </label>
            <p className="text-xs text-muted-foreground">{t(k("help.joint"))}</p>
          </fieldset>
        </div>
        <div className="border-t border-border pt-5">
          <fieldset className="space-y-4">
            <legend className="mb-3 text-lg font-semibold">{t(k("sections.reinvestment"))}</legend>
            <label className="flex items-start gap-3 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                id="capitalGains-ownHome"
                checked={input.ownPermanentHome}
                onChange={(event) => setInput((current) => ({ ...current, ownPermanentHome: event.target.checked }))}
                className="mt-1 h-4 w-4"
              />
              <span>{t(k("fields.ownHome"))}</span>
            </label>
            {input.ownPermanentHome && (
              <>
                {amountField("reinvested", true)}
                {amountField("loanRepaid", true)}
              </>
            )}
          </fieldset>
        </div>
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        {!result && <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>}
        {result && (
          <>
            <CalculatorResult
              items={[
                { label: t(k("result.extraTax")), value: money(result.extraTax), highlight: true, id: "capitalGains-extraTax" },
                { label: t(k("result.cashAfter")), value: money(result.cashAfter) },
                ...(result.taxValueApplied
                  ? [{ label: t(k("result.realizationValue")), value: money(result.realizationValue) }]
                  : []),
                { label: t(k("result.gain")), value: money(result.gain) },
                {
                  label: t(k("result.adjustedPurchase")),
                  value: money(result.adjustedPurchase),
                },
                {
                  label: t(k("result.coefficient")),
                  value: result.coefficientApplied
                    ? `×${formatNumber(locale, result.coefficient, 2)}`
                    : t(k("result.coefficientNone"), { months: String(result.monthsHeld) }),
                },
                { label: t(k("result.expenses")), value: money(result.expenses) },
                ...(input.ownPermanentHome
                  ? [{ label: t(k("result.exemptPercent")), value: formatPercent(locale, result.exemptPercent, { decimals: 2 }) }]
                  : []),
                { label: t(k("result.taxableGain")), value: money(result.taxableGain) },
                { label: t(k("result.includedIncome")), value: money(result.includedIncome) },
              ]}
            />
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">{t(k("result.estimateNote"))}</p>
              {result.isLoss && <p className="text-foreground">{t(k("result.loss"))}</p>}
              {!result.isLoss && result.gain === 0 && <p className="text-foreground">{t(k("result.zero"))}</p>}
              {result.taxValueApplied && <p className="text-foreground">{t(k("result.taxValueApplied"))}</p>}
            </div>
            {input.ownPermanentHome && (
              <div className="space-y-2 text-sm">
                <p className="font-medium text-foreground">{t(k("checklist.title"))}</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {CHECKLIST.map((item) => (
                    <li key={item}>{t(k(`checklist.${item}`))}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{t(k("checklist.note"))}</p>
              </div>
            )}
          </>
        )}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {result ? `${t(k("result.extraTax"))}: ${money(result.extraTax)}` : ""}
        </p>
      </div>
    </CalculatorLayout>
  );
}
