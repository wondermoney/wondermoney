import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  ALLOWANCE_EXAMPLE,
  ALLOWANCE_YEAR,
  HOLIDAY_ALLOWANCE_EXAMPLE,
  computeAllowance,
  type AllowanceKind,
  type AllowancePaymentMode,
} from "@/lib/calculators/allowance";
import {
  HOLDER_STATUSES,
  PAYROLL_LIMITS,
  PAYROLL_REGIONS,
  type HolderStatus,
  type PayrollRegion,
} from "@/lib/calculators/payroll";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

// Labels shared with the net salary page live under tools.netSalary; the rest under tools.allowance.
const a = (key: string) => `tools.allowance.${key}`;
const n = (key: string) => `tools.netSalary.${key}`;
const inputClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const TOOL_BY_KIND = { christmas: "christmas_allowance", holiday: "holiday_allowance" } as const;

export default function AllowanceCalculatorComp({ locale, kind }: { locale: Lang; kind: AllowanceKind }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <AllowanceCalculator kind={kind} />
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
        className={inputClass}
        aria-describedby={help ? `${id}-help` : undefined}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {help && <p id={`${id}-help`} className="text-sm text-muted-foreground">{help}</p>}
    </div>
  );
}

function AllowanceCalculator({ kind }: { kind: AllowanceKind }) {
  const { t, locale } = useTranslations();
  const example = kind === "christmas" ? ALLOWANCE_EXAMPLE : HOLIDAY_ALLOWANCE_EXAMPLE;
  const [input, setInput] = useState(example);
  const used = useRef(false);
  const calculation = computeAllowance(input);
  const valid = calculation.ok;
  const errors = calculation.ok ? {} : calculation.errors;
  const result = calculation.ok ? calculation.result : null;

  useEffect(() => {
    if (input === example || !valid || used.current) return;
    used.current = true;
    // Metadata only: never the salary, the situation, the dates or the result.
    pushGtmEvent({ event: "tool_used", tool: TOOL_BY_KIND[kind], page_type: getPageType() });
  }, [input, valid, example, kind]);

  const money = (cents: number) => formatMoney(locale, cents / 100, { decimals: 2 });
  const update = <K extends keyof typeof input>(key: K, value: (typeof input)[K]) =>
    setInput((current) => ({ ...current, [key]: value }));
  const err = (field: keyof typeof errors, params?: Record<string, string>) => {
    const code = errors[field];
    if (!code) return undefined;
    const ns = code === "invalidDate" || code === "afterYear" ? a("errors") : n("errors");
    return t(`${ns}.${code}`, params);
  };
  const startDateError = err("startDate", { year: String(ALLOWANCE_YEAR) });
  const percent = result ? `${(result.proportionBp / 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%` : "";

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        <CalculatorInput
          id={`${kind}Allowance-gross`}
          label={t(n("fields.grossMonthly"))}
          value={input.grossMonthly}
          onChange={(value) => update("grossMonthly", value)}
          min={0}
          max={PAYROLL_LIMITS.grossMonthly}
          prefix="€"
          helpText={t(a("help.gross"))}
          error={err("grossMonthly", { max: formatMoney(locale, PAYROLL_LIMITS.grossMonthly, { decimals: 0 }) })}
        />
        <SelectField<PayrollRegion>
          id={`${kind}Allowance-region`}
          label={t(n("fields.region"))}
          value={input.region}
          options={PAYROLL_REGIONS.map((value) => ({ value, label: t(n(`regions.${value}`)) }))}
          onChange={(value) => update("region", value)}
        />
        <SelectField<HolderStatus>
          id={`${kind}Allowance-status`}
          label={t(n("fields.status"))}
          value={input.status}
          options={HOLDER_STATUSES.map((value) => ({ value, label: t(n(`statuses.${value}`)) }))}
          onChange={(value) => update("status", value)}
          help={t(n("help.status"))}
        />
        <CalculatorInput
          id={`${kind}Allowance-dependants`}
          label={t(n("fields.dependants"))}
          value={input.dependants}
          onChange={(value) => update("dependants", value)}
          min={0}
          max={PAYROLL_LIMITS.dependants}
          error={err("dependants", { max: String(PAYROLL_LIMITS.dependants) })}
        />
        <SelectField<AllowancePaymentMode>
          id={`${kind}Allowance-mode`}
          label={t(a("fields.mode"))}
          value={input.mode}
          options={(["lumpSum", "twelfths"] as const).map((value) => ({ value, label: t(a(`modes.${value}`)) }))}
          onChange={(value) => update("mode", value)}
          help={t(a("help.mode"))}
        />
        <div className="space-y-1.5">
          <label htmlFor={`${kind}Allowance-start`} className="block text-sm font-medium text-foreground">
            {t(a("fields.startDate"))}
          </label>
          <input
            id={`${kind}Allowance-start`}
            type="date"
            value={input.startDate}
            onChange={(event) => update("startDate", event.currentTarget.value)}
            className={inputClass}
            aria-invalid={startDateError ? true : undefined}
            aria-describedby={`${kind}Allowance-start-help`}
          />
          <p id={`${kind}Allowance-start-help`} className={startDateError ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {startDateError ?? t(a(`help.startDate.${kind}`), { year: String(ALLOWANCE_YEAR) })}
          </p>
        </div>
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        <div aria-live="polite">
          {result ? (
            <CalculatorResult
              items={[
                {
                  label: t(a(result.twelfth ? "result.netTwelfth" : "result.netAllowance")),
                  value: money(result.twelfth ? result.twelfth.netCents : result.total.netCents),
                  highlight: true,
                },
                { label: t(a("result.gross")), value: money(result.total.grossCents) },
                { label: t(a("result.withholding")), value: `−${money(result.total.withholdingCents)}` },
                { label: t(a("result.socialSecurity")), value: `−${money(result.total.socialSecurityCents)}` },
                ...(result.twelfth
                  ? [
                      { label: t(a("result.net")), value: money(result.total.netCents) },
                      { label: t(a("result.twelfthGross")), value: money(result.twelfth.grossCents) },
                      { label: t(a("result.twelfthCount")), value: String(result.twelfth.payments) },
                    ]
                  : []),
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t(a("errors.summary"))}</p>
          )}
        </div>
        {result && (
          <>
            <p className="text-sm text-muted-foreground">
              {kind === "holiday" && result.holidayDays !== null
                ? t(a("result.holidayDays"), { days: String(result.holidayDays), percent })
                : t(a("result.proportion"), { percent })}
            </p>
            {result.total.grossCents === 0 && (
              <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t(a("result.noAllowanceYet"))}</p>
            )}
            {result.twelfth && result.twelfth.withholdingCents === 0 && result.total.grossCents > 0 && (
              <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t(a("result.noWithholdingOnTwelfth"))}</p>
            )}
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t(n("result.notFinalTax"))}</p>
          </>
        )}
      </div>
    </CalculatorLayout>
  );
}
