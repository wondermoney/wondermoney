import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  HOUSEHOLDS,
  IAS_2026_CENTS,
  UNEMPLOYMENT_EXAMPLE,
  UNEMPLOYMENT_LIMITS,
  computeUnemploymentBenefit,
  type Household,
  type UnemploymentBenefitInput,
} from "@/lib/calculators/unemploymentBenefit";
import type { AllowanceSchedule } from "@/lib/calculators/payroll";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.unemploymentBenefit.${key}`;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHECKLIST = ["involuntary", "contributions", "registration", "ready", "deadline"] as const;

export default function UnemploymentBenefitCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <UnemploymentBenefitCalculator />
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

function UnemploymentBenefitCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<UnemploymentBenefitInput>(UNEMPLOYMENT_EXAMPLE);
  const used = useRef(false);
  const calculation = computeUnemploymentBenefit(input);
  const valid = calculation.ok;
  const errors = calculation.ok ? {} : calculation.errors;
  const result = calculation.ok ? calculation.result : null;

  useEffect(() => {
    if (input === UNEMPLOYMENT_EXAMPLE || !valid || used.current) return;
    used.current = true;
    // Metadata only: never the pay, the age, the household or the result.
    pushGtmEvent({ event: "tool_used", tool: "unemployment_benefit", page_type: getPageType() });
  }, [input, valid]);

  const money = (cents: number) => formatMoney(locale, cents / 100, { decimals: 2 });
  const update = <K extends keyof UnemploymentBenefitInput>(key: K, value: UnemploymentBenefitInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }));
  const err = (field: keyof typeof errors, params?: Record<string, string>) =>
    errors[field] ? t(k(`errors.${errors[field]}`), params) : undefined;
  const l = UNEMPLOYMENT_LIMITS;

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        <CalculatorInput
          id="unemployment-gross"
          label={t(k("fields.grossMonthly"))}
          value={input.grossMonthly}
          onChange={(value) => update("grossMonthly", value)}
          min={0}
          max={l.grossMonthly}
          prefix="€"
          helpText={t(k("help.gross"))}
          error={err("grossMonthly", { min: formatMoney(locale, 0.01, { decimals: 2 }), max: formatMoney(locale, l.grossMonthly, { decimals: 0 }) })}
        />
        <SelectField<AllowanceSchedule>
          id="unemployment-allowances"
          label={t(k("fields.allowances"))}
          value={input.allowances}
          options={(["fourteen", "twelfths"] as const).map((value) => ({ value, label: t(k(`allowanceOptions.${value}`)) }))}
          onChange={(value) => update("allowances", value)}
          help={t(k("help.allowances"))}
        />
        <CalculatorInput
          id="unemployment-age"
          label={t(k("fields.age"))}
          value={input.age}
          onChange={(value) => update("age", value)}
          min={l.ageMin}
          max={l.ageMax}
          helpText={t(k("help.age"))}
          error={err("age", { min: String(l.ageMin), max: String(l.ageMax) })}
        />
        <CalculatorInput
          id="unemployment-months"
          label={t(k("fields.contributionMonths"))}
          value={input.contributionMonths}
          onChange={(value) => update("contributionMonths", value)}
          min={l.monthsMin}
          max={l.monthsMax}
          helpText={t(k("help.months"))}
          error={err("contributionMonths", { min: String(l.monthsMin), max: String(l.monthsMax) })}
        />
        <CalculatorInput
          id="unemployment-years20"
          label={t(k("fields.years20"))}
          value={input.years20}
          onChange={(value) => update("years20", value)}
          min={0}
          max={l.years20Max}
          helpText={t(k("help.years20"))}
          error={err("years20", { min: "0", max: String(l.years20Max) })}
        />
        <SelectField<Household>
          id="unemployment-household"
          label={t(k("fields.household"))}
          value={input.household}
          options={HOUSEHOLDS.map((value) => ({ value, label: t(k(`households.${value}`)) }))}
          onChange={(value) => update("household", value)}
          help={t(k("help.household"))}
        />
        <CalculatorInput
          id="unemployment-dependants"
          label={t(k("fields.dependants"))}
          value={input.dependants}
          onChange={(value) => update("dependants", value)}
          min={0}
          max={l.dependants}
          error={err("dependants", { min: "0", max: String(l.dependants) })}
        />
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        <div id="unemployment-result" aria-live="polite">
          {result ? (
            <CalculatorResult
              items={[
                { label: t(k("result.monthly")), value: money(result.monthlyCents), highlight: true },
                { label: t(k("result.daily")), value: money(result.dailyCents) },
                {
                  label: t(k("result.duration")),
                  value: t(k("result.durationValue"), {
                    days: String(result.duration.totalDays),
                    months: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(result.duration.totalDays / 30),
                  }),
                },
                {
                  label: t(k("result.durationParts")),
                  value: t(k("result.durationPartsValue"), {
                    base: String(result.duration.baseDays), extra: String(result.duration.extraDays),
                  }),
                },
                { label: t(k("result.total")), value: money(result.totalCents) },
                { label: t(k("result.netBefore")), value: money(result.netReferenceMonthlyCents) },
                { label: t(k("result.drop")), value: `−${money(result.monthlyDropCents)}` },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
        {result && (
          <>
            <div className="space-y-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <p>
                {t(k(`result.limit.${result.limit}`), {
                  ias: money(IAS_2026_CENTS),
                  max: money(Math.round(IAS_2026_CENTS * 2.5)),
                })}
                {result.childrenIncrease ? ` ${t(k("result.increaseApplied"))}` : ""}
              </p>
              <p>{t(k("result.estimate"))}</p>
            </div>
          </>
        )}
        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">{t(k("checklist.title"))}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            {CHECKLIST.map((key) => <li key={key}>{t(k(`checklist.${key}`))}</li>)}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">{t(k("checklist.note"))}</p>
        </div>
      </div>
    </CalculatorLayout>
  );
}
