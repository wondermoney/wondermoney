import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  HOLDER_STATUSES,
  MEAL_ALLOWANCE_EXEMPT_PER_DAY_CENTS,
  NET_SALARY_EXAMPLE,
  PAYROLL_LIMITS,
  PAYROLL_REGIONS,
  computeNetSalary,
  type AllowanceSchedule,
  type HolderStatus,
  type MealAllowanceKind,
  type PayrollRegion,
} from "@/lib/calculators/payroll";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.netSalary.${key}`;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function NetSalaryCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <NetSalaryCalculator />
    </ReactTranslationsProvider>
  );
}

function SelectField<T extends string>({
  id, label, value, options, onChange, help,
}: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  help?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as T)}
        className={selectClass}
        aria-describedby={help ? `${id}-help` : undefined}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {help && <p id={`${id}-help`} className="text-sm text-muted-foreground">{help}</p>}
    </div>
  );
}

function NetSalaryCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState(NET_SALARY_EXAMPLE);
  const used = useRef(false);
  const calculation = computeNetSalary(input);
  const valid = calculation.ok;
  const errors = calculation.ok ? {} : calculation.errors;
  const result = calculation.ok ? calculation.result : null;

  useEffect(() => {
    if (input === NET_SALARY_EXAMPLE || !valid || used.current) return;
    used.current = true;
    // Metadata only: never the salary, the situation or the result.
    pushGtmEvent({ event: "tool_used", tool: "net_salary", page_type: getPageType() });
  }, [input, valid]);

  const money = (cents: number) => formatMoney(locale, cents / 100, { decimals: 2 });
  const update = <K extends keyof typeof input>(key: K, value: (typeof input)[K]) =>
    setInput((current) => ({ ...current, [key]: value }));
  const err = (field: keyof typeof errors, params?: Record<string, string>) =>
    errors[field] ? t(k(`errors.${errors[field]}`), params) : undefined;

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        <CalculatorInput
          id="netSalary-gross"
          label={t(k("fields.grossMonthly"))}
          value={input.grossMonthly}
          onChange={(value) => update("grossMonthly", value)}
          min={0}
          max={PAYROLL_LIMITS.grossMonthly}
          prefix="€"
          helpText={t(k("help.gross"))}
          error={err("grossMonthly", { max: formatMoney(locale, PAYROLL_LIMITS.grossMonthly, { decimals: 0 }) })}
        />
        <SelectField<PayrollRegion>
          id="netSalary-region"
          label={t(k("fields.region"))}
          value={input.region}
          options={PAYROLL_REGIONS.map((value) => ({ value, label: t(k(`regions.${value}`)) }))}
          onChange={(value) => update("region", value)}
        />
        <SelectField<HolderStatus>
          id="netSalary-status"
          label={t(k("fields.status"))}
          value={input.status}
          options={HOLDER_STATUSES.map((value) => ({ value, label: t(k(`statuses.${value}`)) }))}
          onChange={(value) => update("status", value)}
          help={t(k("help.status"))}
        />
        <CalculatorInput
          id="netSalary-dependants"
          label={t(k("fields.dependants"))}
          value={input.dependants}
          onChange={(value) => update("dependants", value)}
          min={0}
          max={PAYROLL_LIMITS.dependants}
          error={err("dependants", { max: String(PAYROLL_LIMITS.dependants) })}
        />
        <SelectField<AllowanceSchedule>
          id="netSalary-allowances"
          label={t(k("fields.allowances"))}
          value={input.allowances}
          options={(["fourteen", "twelfths"] as const).map((value) => ({ value, label: t(k(`allowanceOptions.${value}`)) }))}
          onChange={(value) => update("allowances", value)}
          help={t(k("help.allowances"))}
        />
        <fieldset className="rounded-md bg-muted p-4">
          <legend className="float-left w-full text-sm font-semibold text-foreground">{t(k("fields.mealGroup"))}</legend>
          <div className="clear-left space-y-4 pt-3">
            <CalculatorInput
              id="netSalary-mealDaily"
              label={t(k("fields.mealDaily"))}
              value={input.mealDaily}
              onChange={(value) => update("mealDaily", value)}
              min={0}
              max={PAYROLL_LIMITS.mealDaily}
              step={0.05}
              prefix="€"
              helpText={t(k("help.meal"), {
                cash: formatMoney(locale, MEAL_ALLOWANCE_EXEMPT_PER_DAY_CENTS.cash / 100, { decimals: 2 }),
                card: formatMoney(locale, MEAL_ALLOWANCE_EXEMPT_PER_DAY_CENTS.card / 100, { decimals: 3 }),
              })}
              error={err("mealDaily", { max: formatMoney(locale, PAYROLL_LIMITS.mealDaily, { decimals: 0 }) })}
            />
            <CalculatorInput
              id="netSalary-mealDays"
              label={t(k("fields.mealDays"))}
              value={input.mealDays}
              onChange={(value) => update("mealDays", value)}
              min={0}
              max={PAYROLL_LIMITS.mealDays}
              error={err("mealDays", { max: String(PAYROLL_LIMITS.mealDays) })}
            />
            <SelectField<MealAllowanceKind>
              id="netSalary-mealKind"
              label={t(k("fields.mealKind"))}
              value={input.mealKind}
              options={(["cash", "card"] as const).map((value) => ({ value, label: t(k(`mealKinds.${value}`)) }))}
              onChange={(value) => update("mealKind", value)}
            />
          </div>
        </fieldset>
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        <div aria-live="polite">
          {result ? (
            <CalculatorResult
              items={[
                { label: t(k("result.netMonthly")), value: money(result.monthly.netCents), highlight: true },
                { label: t(k("result.withholding")), value: `−${money(result.monthly.withholdingCents)}` },
                { label: t(k("result.socialSecurity")), value: `−${money(result.monthly.socialSecurityCents)}` },
                ...(result.allowancePayment
                  ? [{ label: t(k("result.allowanceNet")), value: money(result.allowancePayment.netCents) }]
                  : []),
                { label: t(k("result.annualNet")), value: money(result.annual.netCents) },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
        {result && (
          <>
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t(k("result.notFinalTax"))}</p>
          </>
        )}
      </div>
    </CalculatorLayout>
  );
}
