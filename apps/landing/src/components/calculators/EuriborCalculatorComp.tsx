import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/shared/charts";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  EURIBOR_EXAMPLE,
  EURIBOR_LIMITS,
  EURIBOR_SOURCE,
  EURIBOR_TENORS,
  computeEuriborImpact,
  getEuriborSeries,
  getLatestEuribor,
  type EuriborField,
  type EuriborInput,
  type EuriborTenor,
} from "@/lib/calculators/euribor";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent, toIntlLocale } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { Select } from "@/components/ui/select";

const k = (key: string) => `tools.euribor.${key}`;
const LATEST = getLatestEuribor();
const FIRST_YEAR = Number(EURIBOR_SOURCE.firstMonth.slice(0, 4));
const LAST_YEAR = Number(EURIBOR_SOURCE.lastMonth.slice(0, 4));
const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR }, (_, index) => FIRST_YEAR + index);
const TENOR_KEY = { 3: "m3", 6: "m6", 12: "m12" } as const;

export function formatMonth(locale: Lang, month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, number - 1, 1)));
}

export default function EuriborCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <EuriborContent />
    </ReactTranslationsProvider>
  );
}

function EuriborContent() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<EuriborInput>(EURIBOR_EXAMPLE);
  const [edited, setEdited] = useState(false);
  const [fromYear, setFromYear] = useState(FIRST_YEAR);
  const usageSent = useRef(false);

  const calculation = useMemo(() => computeEuriborImpact(input), [input]);
  const result = calculation.ok ? calculation.result : null;
  const errors = calculation.ok ? {} : calculation.errors;
  const series = useMemo(() => getEuriborSeries(fromYear), [fromYear]);

  useEffect(() => {
    if (!edited || !result || usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the balance, the spread, the change or the payments.
    pushGtmEvent({ event: "tool_used", tool: "euribor", page_type: getPageType() });
  }, [edited, result]);

  const update = <K extends keyof EuriborInput>(field: K, value: EuriborInput[K]) => {
    setEdited(true);
    setInput((current) => ({ ...current, [field]: value }));
  };

  const euros = (value: number, decimals = 0) => formatMoney(locale, value, { decimals });
  const rate = (value: number) => formatPercent(locale, value, { decimals: 2 });
  const points = (value: number) =>
    value === 0
      ? formatNumber(locale, 0, 2)
      : `${value > 0 ? "+" : "−"}${formatNumber(locale, Math.abs(value), 2)}`;

  const limits: Record<EuriborField, { min?: string; max?: string }> = {
    balance: { min: euros(EURIBOR_LIMITS.minBalance), max: euros(EURIBOR_LIMITS.maxBalance) },
    termYears: { max: formatNumber(locale, EURIBOR_LIMITS.maxTermYears) },
    termMonths: {},
    spread: { max: rate(EURIBOR_LIMITS.maxSpread) },
    change: { min: points(-EURIBOR_LIMITS.maxChange), max: points(EURIBOR_LIMITS.maxChange) },
  };
  const errorFor = (field: EuriborField) => {
    const error = errors[field];
    return error ? t(k(`errors.${field}.${error}`), limits[field]) : undefined;
  };
  const month = formatMonth(locale, LATEST.month);

  return (
    <>
      <section aria-labelledby="euribor-current-title" className="mb-10 space-y-4">
        <p className="inline-block rounded-lg bg-paper-2 px-4 py-2 text-sm font-medium text-foreground">
          {t(k("asOf"), { month, fetched: EURIBOR_SOURCE.fetchedOn })}
        </p>
        <h2 id="euribor-current-title" className="text-2xl font-semibold tracking-tight text-foreground">
          {t(k("current.title"))}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {LATEST.rates.map((entry) => (
            <div key={entry.tenor} className="rounded-card border border-border bg-background p-5 shadow-sm">
              <p className="text-sm text-muted-foreground">{t(k(`tenor.${entry.tenor}`))}</p>
              <p className="mt-1 font-mono text-3xl font-semibold tracking-tight text-foreground">{rate(entry.rate)}</p>
              <p className="mt-1 text-sm text-foreground">
                {t(k("current.change"), {
                  change: points(entry.change),
                  previous: formatMonth(locale, LATEST.previousMonth),
                })}
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(k("current.note"), { month })}</p>
      </section>

      <h2 className="mb-4 text-2xl font-semibold tracking-tight text-foreground">{t(k("calc.title"))}</h2>
      <CalculatorLayout>
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <CalculatorInput
            id="euribor-balance"
            label={t(k("fields.balance"))}
            value={input.balance}
            onChange={(value) => update("balance", value)}
            min={0}
            step={1000}
            prefix="€"
            error={errorFor("balance")}
          />
          <div className="grid grid-cols-2 gap-4">
            <CalculatorInput
              id="euribor-termYears"
              label={t(k("fields.termYears"))}
              value={input.termYears}
              onChange={(value) => update("termYears", value)}
              min={0}
              max={EURIBOR_LIMITS.maxTermYears}
              error={errorFor("termYears")}
            />
            <CalculatorInput
              id="euribor-termMonths"
              label={t(k("fields.termMonths"))}
              value={input.termMonths}
              onChange={(value) => update("termMonths", value)}
              min={0}
              max={11}
              error={errorFor("termMonths")}
            />
          </div>
          <CalculatorInput
            id="euribor-spread"
            label={t(k("fields.spread"))}
            value={input.spread}
            onChange={(value) => update("spread", value)}
            min={0}
            max={EURIBOR_LIMITS.maxSpread}
            step={0.05}
            suffix="%"
            helpText={t(k("help.spread"))}
            error={errorFor("spread")}
          />
          <div className="space-y-1.5">
            <label htmlFor="euribor-tenor" className="block text-sm font-medium text-foreground">
              {t(k("fields.tenor"))}
            </label>
            <Select
              id="euribor-tenor"
              value={input.tenor}
              onChange={(event) => update("tenor", Number(event.currentTarget.value) as EuriborTenor)}
            >
              {EURIBOR_TENORS.map((tenor) => (
                <option key={tenor} value={tenor}>
                  {t(k(`tenor.${tenor}`))}
                </option>
              ))}
            </Select>
          </div>
          <CalculatorInput
            id="euribor-change"
            label={t(k("fields.change"))}
            value={input.change}
            onChange={(value) => update("change", value)}
            min={-EURIBOR_LIMITS.maxChange}
            max={EURIBOR_LIMITS.maxChange}
            step={0.25}
            helpText={t(k("help.change"))}
            error={errorFor("change")}
          />
        </div>

        <div className="min-w-0 space-y-5 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <>
              <CalculatorResult
                items={[
                  {
                    label: t(k("result.revised")),
                    value: euros(result.revision.revised.monthlyPayment, 2),
                    highlight: true,
                  },
                  { label: t(k("result.current")), value: euros(result.revision.current.monthlyPayment, 2) },
                  {
                    label: t(k("result.monthlyChange")),
                    value: formatMoney(locale, result.revision.monthlyChange, {
                      decimals: 2,
                      sign: result.revision.monthlyChange === 0 ? "auto" : "always",
                    }),
                  },
                  {
                    label: t(k("result.nextYear"), { payments: String(result.revision.nextYear.payments) }),
                    value: formatMoney(locale, result.revision.nextYear.change, {
                      decimals: 2,
                      sign: result.revision.nextYear.change === 0 ? "auto" : "always",
                    }),
                  },
                ]}
              />
              <p className="text-sm text-muted-foreground">
                {t(k("result.assumptions"), {
                  tenor: t(k(`tenor.${input.tenor}`)),
                  index: rate(result.indexRate),
                  newIndex: rate(result.newIndexRate),
                  month,
                })}
              </p>
              {result.revision.revised.floored && (
                <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("result.floored"))}</p>
              )}
              {result.revision.termRounded && (
                <p className="text-sm text-muted-foreground">{t(k("result.termRounded"))}</p>
              )}
              {input.change === 0 && (
                <p className="text-sm text-muted-foreground">{t(k("result.noChange"))}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
          <p className="text-xs text-muted-foreground">{t(k("result.caveat"))}</p>
        </div>
      </CalculatorLayout>

      <section className="mt-10 space-y-4" aria-labelledby="euribor-history-title">
        <h2 id="euribor-history-title" className="text-2xl font-semibold tracking-tight text-foreground">
          {t(k("history.title"))}
        </h2>
        <div className="max-w-xs space-y-1.5">
          <label htmlFor="euribor-from" className="block text-sm font-medium text-foreground">
            {t(k("history.from"))}
          </label>
          <Select
            id="euribor-from"
            value={fromYear}
            onChange={(event) => setFromYear(Number(event.currentTarget.value))}
          >
            {YEARS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
        </div>
        <div className="h-72 w-full min-w-0" role="img" aria-label={t(k("history.label"))}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
              <XAxis
                dataKey="month"
                tickFormatter={(value: string) => value.slice(0, 4)}
                minTickGap={40}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                tickFormatter={(value: number) => `${formatNumber(locale, value, 1)}%`}
                tick={{ fontSize: 12 }}
                width={52}
              />
              <Tooltip
                // @ts-expect-error Recharts tooltip types are very broken
                formatter={(value: number, name: string) => [rate(value), name]}
                labelFormatter={(label) => formatMonth(locale, String(label))}
              />
              <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
              {EURIBOR_TENORS.map((tenor, position) => (
                <Line
                  key={tenor}
                  type="monotone"
                  dataKey={TENOR_KEY[tenor]}
                  name={t(k(`tenor.${tenor}`))}
                  stroke={`oklch(var(--chart-${position + 1}))`}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(k("sourceNote"), { month, fetched: EURIBOR_SOURCE.fetchedOn })}
        </p>
      </section>
    </>
  );
}
