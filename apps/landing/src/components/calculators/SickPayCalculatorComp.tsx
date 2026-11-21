import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  MIN_DAILY_CENTS,
  SICK_PAY_EXAMPLE,
  SICK_PAY_LIMITS,
  computeSickPay,
  type SickPayInput,
} from "@/lib/calculators/sickPay";
import type { AllowanceSchedule } from "@/lib/calculators/payroll";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { Select } from "@/components/ui/select";

const k = (key: string) => `tools.sickPay.${key}`;
const CHECKLIST = ["certificate", "guarantee", "professionalIndex", "waiting"] as const;

export default function SickPayCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <SickPayCalculator />
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
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as T)}
        aria-describedby={help ? `${id}-help` : undefined}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
      {help && <p id={`${id}-help`} className="text-sm text-muted-foreground">{help}</p>}
    </div>
  );
}

function SickPayCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<SickPayInput>(SICK_PAY_EXAMPLE);
  const used = useRef(false);
  const calculation = computeSickPay(input);
  const valid = calculation.ok;
  const errors = calculation.ok ? {} : calculation.errors;
  const result = calculation.ok ? calculation.result : null;

  useEffect(() => {
    if (input === SICK_PAY_EXAMPLE || !valid || used.current) return;
    used.current = true;
    // Metadata only: never the pay, the days or the result.
    pushGtmEvent({ event: "tool_used", tool: "sick_pay", page_type: getPageType() });
  }, [input, valid]);

  const money = (cents: number) => formatMoney(locale, cents / 100, { decimals: 2 });
  const update = <K extends keyof SickPayInput>(key: K, value: SickPayInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }));
  const err = (field: keyof typeof errors, params?: Record<string, string>) =>
    errors[field] ? t(k(`errors.${errors[field]}`), params) : undefined;
  const l = SICK_PAY_LIMITS;

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        <CalculatorInput
          id="sick-gross"
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
          id="sick-allowances"
          label={t(k("fields.allowances"))}
          value={input.allowances}
          options={(["fourteen", "twelfths"] as const).map((value) => ({ value, label: t(k(`allowanceOptions.${value}`)) }))}
          onChange={(value) => update("allowances", value)}
          help={t(k("help.allowances"))}
        />
        <CalculatorInput
          id="sick-days"
          label={t(k("fields.sickDays"))}
          value={input.sickDays}
          onChange={(value) => update("sickDays", value)}
          min={1}
          max={l.sickDays}
          helpText={t(k("help.sickDays"))}
          error={err("sickDays", { min: "1", max: String(l.sickDays) })}
        />
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={input.hospitalisation}
              onChange={(event) => update("hospitalisation", event.currentTarget.checked)}
              aria-describedby="sick-hospital-help"
              className="size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {t(k("fields.hospitalisation"))}
          </label>
          <p id="sick-hospital-help" className="text-sm text-muted-foreground">{t(k("help.hospitalisation"))}</p>
        </div>
        <CalculatorInput
          id="sick-dependants"
          label={t(k("fields.dependants"))}
          value={input.dependants}
          onChange={(value) => update("dependants", value)}
          min={0}
          max={l.dependants}
          helpText={t(k("help.dependants"))}
          error={err("dependants", { min: "0", max: String(l.dependants) })}
        />
        <SelectField<"no" | "yes">
          id="sick-disability-bonus"
          label={t(k("fields.disabilityBonus"))}
          value={input.disabilityBonus ? "yes" : "no"}
          options={(["no", "yes"] as const).map((value) => ({ value, label: t(k(`disabilityBonusOptions.${value}`)) }))}
          onChange={(value) => update("disabilityBonus", value === "yes")}
          help={t(k("help.disabilityBonus"))}
        />
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        <div id="sick-result" aria-live="polite">
          {result ? (
            <CalculatorResult
              items={[
                { label: t(k("result.total")), value: money(result.totalCents), highlight: true },
                { label: t(k("result.reference")), value: money(result.referenceDailyCents) },
                { label: t(k("result.paidDays")), value: String(result.paidDays) },
                {
                  label: t(k("result.waiting")),
                  value: result.waitingDays > 0
                    ? t(k("result.waitingValue"), { days: String(result.waitingDays), amount: money(result.waitingNetPayCents) })
                    : t(k("result.waitingNone")),
                },
                { label: t(k("result.netPay")), value: money(result.netMonthlyCents) },
                { label: t(k("result.firstGap")), value: `−${money(result.firstMonthGapCents)}` },
                { label: t(k("result.averageGap")), value: `−${money(result.averageMonthlyGapCents)}` },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
        {result && (
          <>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t(k("result.bandsTitle"))}</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                {result.bands.map((band) => (
                  <li key={band.fromDay}>
                    <span className="font-medium text-foreground">
                      {t(k("result.bandLabel"), { from: String(band.fromDay), to: String(band.toDay), percent: String(band.percent) })}
                    </span>
                    {": "}
                    {t(k("result.bandValue"), {
                      paid: String(band.paidDays), daily: money(band.dailyCents), amount: money(band.amountCents),
                    })}
                  </li>
                ))}
              </ul>
            </div>
            {result.paidDays === 0 && (
              <p role="status" className="rounded-md bg-muted p-3 text-sm text-foreground">{t(k("result.allWaiting"))}</p>
            )}
            <div className="space-y-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <p>
                {t(k(`result.limit.${result.limit}`), { min: money(MIN_DAILY_CENTS) })}
                {result.increaseApplied ? ` ${t(k("result.increaseApplied"))}` : ""}
              </p>
              {result.waitingDays > 0 && <p>{t(k("result.waitingNote"))}</p>}
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
