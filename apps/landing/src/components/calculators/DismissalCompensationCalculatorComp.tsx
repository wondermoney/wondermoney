import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  DISMISSAL_EXAMPLE,
  DISMISSAL_LIMITS,
  RMMG_2026_CENTS,
  SUPPORTED_END_YEAR,
  computeDismissalCompensation,
  splitPayout,
  type ContractType,
  type DismissalCompensationInput,
  type DismissalField,
  type FixedTermKind,
} from "@/lib/calculators/dismissalCompensation";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.dismissalCompensation.${key}`;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const dateClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive";
const PAYOUT_MONTHS = [6, 12] as const;
const CONTRACT_TYPES: readonly ContractType[] = ["permanent", "fixedTerm"];
const FIXED_TERM_KINDS: readonly FixedTermKind[] = ["certain", "uncertain"];

export default function DismissalCompensationCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <DismissalCompensationCalculator />
    </ReactTranslationsProvider>
  );
}

function DateField({
  id, label, value, onChange, help, error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  help: string;
  error?: string;
}) {
  const describedBy = [error ? `${id}-error` : null, `${id}-help`].filter(Boolean).join(" ");
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">{label}</label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={dateClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
      <p id={`${id}-help`} className="text-sm text-muted-foreground">{help}</p>
    </div>
  );
}

const localToday = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

function DismissalCompensationCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<DismissalCompensationInput>(DISMISSAL_EXAMPLE);
  const used = useRef(false);
  const calculation = computeDismissalCompensation(input, localToday());
  const valid = calculation.ok;
  const errors: Partial<Record<DismissalField, string>> = calculation.ok ? {} : calculation.errors;
  const result = calculation.ok ? calculation.result : null;

  useEffect(() => {
    if (input === DISMISSAL_EXAMPLE || !valid || used.current) return;
    used.current = true;
    // Metadata only: never the pay, the dates or the result.
    pushGtmEvent({ event: "tool_used", tool: "dismissal_compensation", page_type: getPageType() });
  }, [input, valid]);

  const money = (cents: number) => formatMoney(locale, cents / 100, { decimals: 2 });
  const update = <K extends keyof DismissalCompensationInput>(key: K, value: DismissalCompensationInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }));
  const err = (field: DismissalField) =>
    errors[field]
      ? t(k(`errors.${errors[field]}`), {
          min: formatMoney(locale, field === "baseMonthly" ? 0.01 : 0, { decimals: 2 }),
          max: formatMoney(locale, DISMISSAL_LIMITS.monthly, { decimals: 0 }),
          year: String(SUPPORTED_END_YEAR),
        })
      : undefined;
  const years = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  const longDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const overLimit = result?.durationLimit?.exceeded ? result.durationLimit : null;

  const fixedTerm = input.contractType === "fixedTerm";

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        <div className="space-y-1.5">
          <label htmlFor="dismissal-contract-type" className="block text-sm font-medium text-foreground">
            {t(k("fields.contractType"))}
          </label>
          <select
            id="dismissal-contract-type"
            value={input.contractType}
            onChange={(event) => update("contractType", event.currentTarget.value as ContractType)}
            className={selectClass}
            aria-describedby="dismissal-contract-type-help"
          >
            {CONTRACT_TYPES.map((type) => (
              <option key={type} value={type}>{t(k(`contractTypes.${type}`))}</option>
            ))}
          </select>
          <p id="dismissal-contract-type-help" className="text-sm text-muted-foreground">{t(k("help.contractType"))}</p>
        </div>
        {fixedTerm && (
          <div className="space-y-1.5">
            <label htmlFor="dismissal-term-kind" className="block text-sm font-medium text-foreground">
              {t(k("fields.fixedTermKind"))}
            </label>
            <select
              id="dismissal-term-kind"
              value={input.fixedTermKind}
              onChange={(event) => update("fixedTermKind", event.currentTarget.value as FixedTermKind)}
              className={selectClass}
              aria-describedby="dismissal-term-kind-help"
            >
              {FIXED_TERM_KINDS.map((kind) => (
                <option key={kind} value={kind}>{t(k(`fixedTermKinds.${kind}`))}</option>
              ))}
            </select>
            <p id="dismissal-term-kind-help" className="text-sm text-muted-foreground">{t(k("help.fixedTermKind"))}</p>
          </div>
        )}
        <CalculatorInput
          id="dismissal-base"
          label={t(k("fields.baseMonthly"))}
          value={input.baseMonthly}
          onChange={(value) => update("baseMonthly", value)}
          min={0}
          max={DISMISSAL_LIMITS.monthly}
          prefix="€"
          helpText={t(k("help.baseMonthly"))}
          error={err("baseMonthly")}
        />
        <CalculatorInput
          id="dismissal-seniority-pay"
          label={t(k("fields.seniorityPay"))}
          value={input.seniorityPay}
          onChange={(value) => update("seniorityPay", value)}
          min={0}
          max={DISMISSAL_LIMITS.monthly}
          prefix="€"
          helpText={t(k("help.seniorityPay"))}
          error={err("seniorityPay")}
        />
        <DateField
          id="dismissal-start"
          label={t(k("fields.startDate"))}
          value={input.startDate}
          onChange={(value) => update("startDate", value)}
          help={t(k(fixedTerm ? "help.startDateFixedTerm" : "help.startDate"))}
          error={err("startDate")}
        />
        <DateField
          id="dismissal-end"
          label={t(k("fields.endDate"))}
          value={input.endDate}
          onChange={(value) => update("endDate", value)}
          help={t(k("help.endDate"), { year: String(SUPPORTED_END_YEAR) })}
          error={err("endDate")}
        />
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          {fixedTerm ? t(k("scopeFixedTerm"), { year: String(SUPPORTED_END_YEAR) }) : t(k("scope"))}
        </p>
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        <div aria-live="polite" aria-atomic="true">
          {result ? (
            <>
              <p className="text-sm text-muted-foreground">{t(k("result.compensation"))}</p>
              <p id="dismissal-compensation" className="font-mono text-3xl font-bold text-primary">
                {money(result.compensationCents)}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
        {overLimit && (
          // Non-blocking: the expiry figure above stays, and the button moves the same dates to the dismissal option.
          <div role="note" aria-labelledby="dismissal-duration-warning" className="space-y-2 rounded-lg border border-warning-text/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
            <p id="dismissal-duration-warning" className="font-semibold">{t(k("durationWarning.title"))}</p>
            <p>{t(k(`durationWarning.${overLimit.rules}.${overLimit.kind}`), { date: longDate(overLimit.lastDay) })}</p>
            <p>{t(k("durationWarning.consequence"))}</p>
            <button
              type="button"
              onClick={() => update("contractType", "permanent")}
              className="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t(k("durationWarning.action"))}
            </button>
          </div>
        )}
        {result && (
          <>
            <CalculatorResult
              items={[
                { label: t(k("result.seniority")), value: t(k("result.seniorityValue"), { years: years(result.seniorityYears) }) },
                { label: t(k("result.regime")), value: t(k(`result.regimes.${result.regime}`)) },
                { label: t(k("result.usedMonthly")), value: money(result.usedMonthlyCents) },
                { label: t(k("result.daily")), value: money(result.dailyCents) },
                { label: t(k("result.cap")), value: money(result.capCents) },
              ]}
            />
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t(k("result.breakdownTitle"))}</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                {result.lines.map((line) => (
                  <li key={line.key} className="flex justify-between gap-3">
                    <span>{t(k(`result.periods.${line.key}`), { years: years(line.years), days: String(line.daysPerYear) })}</span>
                    <span className="font-mono text-foreground">{money(line.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <ul className="space-y-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
              {!result.caps.monthlyBase && !result.caps.total && !result.caps.earlyPartExceedsCap && <li>{t(k("result.caps.none"))}</li>}
              {result.caps.monthlyBase && (
                <li>{t(k("result.caps.monthlyBase"), { limit: money(result.usedMonthlyCents), rmmg: money(RMMG_2026_CENTS) })}</li>
              )}
              {result.caps.total && <li>{t(k("result.caps.total"), { cap: money(result.capCents) })}</li>}
              {result.caps.earlyPartExceedsCap && <li>{t(k("result.caps.earlyPart"), { cap: money(result.capCents) })}</li>}
            </ul>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t(k("result.payoutTitle"))}</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                {PAYOUT_MONTHS.map((months) => (
                  <li key={months}>
                    {t(k("result.payoutValue"), {
                      months: String(months), amount: money(splitPayout(result.compensationCents, months)[0]),
                    })}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-muted-foreground">{t(k("result.payoutNote"))}</p>
            </div>
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t(k("result.estimate"))}</p>
          </>
        )}
      </div>
    </CalculatorLayout>
  );
}
