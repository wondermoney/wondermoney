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
  SP500_HISTORY_EXAMPLE,
  SP500_HISTORY_LIMITS,
  SP500_HISTORY_SOURCE,
  computeSp500History,
  type Sp500HistoryField,
  type Sp500HistoryInput,
  type Sp500HistoryResult,
} from "@/lib/calculators/sp500History";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { Select } from "@/components/ui/select";

const k = (key: string) => `tools.sp500History.${key}`;
const YEARS = Array.from(
  { length: SP500_HISTORY_LIMITS.lastYear - SP500_HISTORY_LIMITS.firstYear + 1 },
  (_, index) => SP500_HISTORY_LIMITS.firstYear + index,
);

export default function Sp500HistoryCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <Sp500HistoryCalculator />
    </ReactTranslationsProvider>
  );
}

function Sp500HistoryCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<Sp500HistoryInput>(SP500_HISTORY_EXAMPLE);
  const [edited, setEdited] = useState(false);
  const usageSent = useRef(false);

  const calculation = useMemo(() => computeSp500History(input), [input]);
  const result = calculation.ok ? calculation.result : null;
  const errors = calculation.ok ? {} : calculation.errors;

  useEffect(() => {
    if (!edited || !result || usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the years, the amounts, the toggles or the result.
    pushGtmEvent({ event: "tool_used", tool: "sp500_history", page_type: getPageType() });
  }, [edited, result]);

  const update = <K extends keyof Sp500HistoryInput>(field: K, value: Sp500HistoryInput[K]) => {
    setEdited(true);
    setInput((current) => ({ ...current, [field]: value }));
  };
  const usd = (value: number, decimals = 0) => formatMoney(locale, value, { currency: "USD", decimals });
  const errorFor = (field: Sp500HistoryField) => {
    const error = errors[field];
    if (!error) return undefined;
    return t(k(`errors.${error}`), {
      min: field === "startYear" || field === "endYear" ? String(SP500_HISTORY_LIMITS.firstYear) : usd(0),
      max:
        field === "startYear" || field === "endYear"
          ? String(SP500_HISTORY_LIMITS.lastYear)
          : usd(SP500_HISTORY_LIMITS.maxAmount),
      start: String(input.startYear),
    });
  };

  const yearSelect = (field: "startYear" | "endYear") => {
    const error = errorFor(field);
    return (
      <div className="space-y-1.5">
        <label htmlFor={`sp500-${field}`} className="block text-sm font-medium text-foreground">
          {t(k(`fields.${field}`))}
        </label>
        <Select
          id={`sp500-${field}`}
          value={input[field]}
          onChange={(event) => update(field, Number(event.currentTarget.value))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `sp500-${field}-error` : undefined}
        >
          {YEARS.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </Select>
        {error && (
          <p id={`sp500-${field}-error`} role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
      </div>
    );
  };

  const toggle = (field: "reinvestDividends" | "inflationAdjusted", label: string, help: string) => (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <input
          type="checkbox"
          checked={input[field]}
          onChange={(event) => update(field, event.currentTarget.checked)}
          aria-describedby={`sp500-${field}-help`}
          className="size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {label}
      </label>
      <p id={`sp500-${field}-help`} className="pl-6 text-xs text-muted-foreground">
        {help}
      </p>
    </div>
  );

  return (
    <>
      <CalculatorLayout>
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <div className="grid grid-cols-2 gap-4">
            {yearSelect("startYear")}
            {yearSelect("endYear")}
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            {t(k("help.years"), {
              first: String(SP500_HISTORY_LIMITS.firstYear),
              last: String(SP500_HISTORY_LIMITS.lastYear),
            })}
          </p>
          <CalculatorInput
            id="sp500-initial"
            label={t(k("fields.initial"))}
            value={input.initial}
            onChange={(value) => update("initial", value)}
            min={0}
            max={SP500_HISTORY_LIMITS.maxAmount}
            step={1000}
            prefix="$"
            helpText={t(k("help.initial"))}
            error={errorFor("initial")}
          />
          <CalculatorInput
            id="sp500-contribution"
            label={t(k("fields.annualContribution"))}
            value={input.annualContribution}
            onChange={(value) => update("annualContribution", value)}
            min={0}
            max={SP500_HISTORY_LIMITS.maxAmount}
            step={500}
            prefix="$"
            helpText={t(k("help.contribution"))}
            error={errorFor("annualContribution")}
          />
          {toggle("reinvestDividends", t(k("fields.reinvest")), t(k("help.reinvest")))}
          {toggle(
            "inflationAdjusted",
            t(k("fields.real")),
            t(k("help.real"), { year: String(input.startYear) }),
          )}
        </div>

        <div className="min-w-0 space-y-5 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <Results result={result} input={input} usd={usd} />
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
          <p className="text-xs text-muted-foreground">{t(k("currencyNote"))}</p>
        </div>
      </CalculatorLayout>

      {result && (
        <section className="mt-10 space-y-6" aria-labelledby="sp500-table-title">
          <h2 id="sp500-table-title" className="text-2xl font-semibold tracking-tight text-foreground">
            {t(k("table.title"))}
          </h2>
          <ValueChart result={result} usd={usd} />
          <YearTable result={result} usd={usd} />
          <p className="text-xs text-muted-foreground">
            {t(k("sourceNote"), {
              date: SP500_HISTORY_SOURCE.returns.downloadedOn,
              shillerDate: SP500_HISTORY_SOURCE.inflation.downloadedOn,
            })}
          </p>
        </section>
      )}
    </>
  );
}

type Usd = (value: number, decimals?: number) => string;

function Results({ result, input, usd }: { result: Sp500HistoryResult; input: Sp500HistoryInput; usd: Usd }) {
  const { t, locale } = useTranslations();
  const percent = (value: number) => formatPercent(locale, value, { decimals: 1, sign: "always" });
  const basis = t(k(input.reinvestDividends ? "result.basisTotal" : "result.basisPrice"));
  const terms = t(k(input.inflationAdjusted ? "result.termsReal" : "result.termsNominal"), {
    year: String(input.startYear),
  });

  return (
    <>
      <CalculatorResult
        items={[
          {
            label: t(k(input.inflationAdjusted ? "result.finalReal" : "result.finalNominal"), {
              year: String(input.startYear),
            }),
            value: usd(result.finalValue),
            highlight: true,
          },
          { label: t(k("result.contributed")), value: usd(result.contributed) },
          { label: t(k("result.gain")), value: usd(result.gain) },
          { label: t(k("result.cagr")), value: percent(result.cagrPct) },
        ]}
      />
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t(k("result.best"))}</dt>
          <dd className="font-mono text-foreground">
            {result.best.year}: {percent(result.best.returnPct)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t(k("result.worst"))}</dt>
          <dd className="font-mono text-foreground">
            {result.worst.year}: {percent(result.worst.returnPct)}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        {t(k("result.assumptions"), {
          basis,
          terms,
          years: String(result.years.length),
          start: String(input.startYear),
          end: String(input.endYear),
        })}
      </p>
      {result.years.length === 1 && (
        <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("result.singleYear"))}</p>
      )}
      <p className="text-xs text-muted-foreground">{t(k("result.pastPerformance"))}</p>
    </>
  );
}

function ValueChart({ result, usd }: { result: Sp500HistoryResult; usd: Usd }) {
  const { t, locale } = useTranslations();
  let contributed = 0;
  const data = result.years.map((row) => {
    contributed += row.contribution;
    return { year: row.year, value: row.endValue, contributed };
  });

  return (
    <div className="h-64 w-full min-w-0" role="img" aria-label={t(k("chart.label"))}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
          <XAxis dataKey="year" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 12 }} />
          <YAxis
            tickFormatter={(value: number) => formatMoney(locale, value, { currency: "USD", compact: true })}
            tick={{ fontSize: 12 }}
            width={72}
          />
          <Tooltip
            // @ts-expect-error Recharts tooltip types are very broken
            formatter={(value: number, name: string) => [usd(value), name]}
          />
          <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
          <Line
            type="monotone"
            dataKey="value"
            name={t(k("chart.value"))}
            stroke="oklch(var(--chart-1))"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="stepAfter"
            dataKey="contributed"
            name={t(k("chart.contributed"))}
            stroke="oklch(var(--chart-2))"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function YearTable({ result, usd }: { result: Sp500HistoryResult; usd: Usd }) {
  const { t, locale } = useTranslations();
  const percent = (value: number) => formatPercent(locale, value, { decimals: 1, sign: "always" });

  return (
    <div className="max-h-96 overflow-auto rounded-lg border border-border">
      <table className="w-full min-w-[32rem] text-sm">
        <caption className="sr-only">{t(k("table.caption"))}</caption>
        <thead className="sticky top-0 bg-paper-2 text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("table.year"))}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("table.return"))}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("table.inflation"))}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("table.contribution"))}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("table.value"))}</th>
          </tr>
        </thead>
        <tbody>
          {result.years.map((row) => (
            <tr key={row.year} className="border-t border-border-2">
              <th scope="row" className="px-3 py-2 text-left font-mono font-normal text-foreground">
                {row.year}
              </th>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">
                {percent(row.returnPct)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-muted-foreground">
                {percent(row.inflationPct)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">
                {usd(row.contribution)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">
                {usd(row.endValue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
