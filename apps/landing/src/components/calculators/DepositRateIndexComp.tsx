import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  DEPOSIT_BENCHMARK_LIMITS,
  DEPOSIT_BUCKETS,
  DEPOSIT_RATES,
  DEPOSIT_RATES_EXAMPLE,
  DEPOSIT_RATES_SOURCE,
  DEPOSIT_TAX_RATE,
  computeDepositBenchmark,
  latestRates,
  latestYearSummary,
  monthToDate,
  portugalInflation,
  rateOf,
  yearSummaries,
  type DepositBenchmarkField,
  type DepositBenchmarkInput,
  type DepositBenchmarkResult,
  type DepositBucket,
} from "@/lib/calculators/depositRates";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatMonthYear, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.depositRateIndex.${key}`;

export default function DepositRateIndexComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <DepositRateIndex />
    </ReactTranslationsProvider>
  );
}

function DepositRateIndex() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<DepositBenchmarkInput>({ ...DEPOSIT_RATES_EXAMPLE });
  const [edited, setEdited] = useState(false);
  const usageSent = useRef(false);

  const calculation = useMemo(() => computeDepositBenchmark(input), [input]);
  const result = calculation.ok ? calculation.result : null;
  const errors = calculation.ok ? {} : calculation.errors;

  useEffect(() => {
    if (!edited || !result || usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the amount, the term, the inflation or the result.
    pushGtmEvent({ event: "tool_used", tool: "deposit_rate_index", page_type: getPageType() });
  }, [edited, result]);

  const update = (field: keyof DepositBenchmarkInput, value: number) => {
    setEdited(true);
    setInput((current) => ({ ...current, [field]: value }));
  };
  const eur = (value: number, decimals = 2) => formatMoney(locale, value, { currency: "EUR", decimals });
  const errorFor = (field: DepositBenchmarkField) => {
    const error = errors[field];
    if (!error) return undefined;
    return t(k(`errors.${field}.${error}`), {
      max: field === "amount" ? eur(DEPOSIT_BENCHMARK_LIMITS.maxAmount, 0) : String(DEPOSIT_BENCHMARK_LIMITS.maxTermMonths),
      min: String(DEPOSIT_BENCHMARK_LIMITS.minInflation),
      top: String(DEPOSIT_BENCHMARK_LIMITS.maxInflation),
    });
  };

  return (
    <>
      <Snapshot />
      <h2 className="mt-12 text-2xl font-semibold tracking-tight text-foreground">{t(k("calculator.title"))}</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t(k("calculator.intro"))}</p>
      <div className="mt-6">
        <CalculatorLayout>
          <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
            <CalculatorInput
              id="deposit-amount"
              label={t(k("fields.amount"))}
              value={input.amount}
              onChange={(value) => update("amount", value)}
              min={0}
              max={DEPOSIT_BENCHMARK_LIMITS.maxAmount}
              step={500}
              prefix="€"
              error={errorFor("amount")}
            />
            <CalculatorInput
              id="deposit-term"
              label={t(k("fields.term"))}
              value={input.termMonths}
              onChange={(value) => update("termMonths", value)}
              min={DEPOSIT_BENCHMARK_LIMITS.minTermMonths}
              max={DEPOSIT_BENCHMARK_LIMITS.maxTermMonths}
              suffix={t(k("fields.termSuffix"))}
              helpText={t(k("help.term"))}
              error={errorFor("termMonths")}
            />
            <CalculatorInput
              id="deposit-inflation"
              label={t(k("fields.inflation"))}
              value={input.inflation}
              onChange={(value) => update("inflation", value)}
              min={DEPOSIT_BENCHMARK_LIMITS.minInflation}
              max={DEPOSIT_BENCHMARK_LIMITS.maxInflation}
              step={0.1}
              suffix="%"
              helpText={t(k("help.inflation"), { year: String(latestYearSummary().year) })}
              error={errorFor("inflation")}
            />
          </div>
          <div className="min-w-0 space-y-5 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
            {result ? (
              <Results result={result} eur={eur} />
            ) : (
              <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
            )}
          </div>
        </CalculatorLayout>
      </div>
      <History />
      <p className="mt-6 max-w-3xl text-xs text-muted-foreground">
        {t(k("sourceNote"), {
          month: formatMonthYear(locale, monthToDate(DEPOSIT_RATES_SOURCE.lastMonth)),
          retrieved: DEPOSIT_RATES_SOURCE.retrievedOn,
        })}
      </p>
    </>
  );
}

function bucketLabel(t: (key: string) => string, bucket: DepositBucket) {
  return t(k(`buckets.${bucket}`));
}

function Snapshot() {
  const { t, locale } = useTranslations();
  const latest = useMemo(() => latestRates(), []);
  const year = useMemo(() => latestYearSummary(), []);
  const percent = (value: number | null, sign: "auto" | "always" = "auto") =>
    value === null ? t(k("snapshot.noData")) : formatPercent(locale, value, { decimals: 2, sign });
  const month = formatMonthYear(locale, monthToDate(latest.month));

  return (
    <section aria-labelledby="deposit-snapshot-title" className="space-y-6">
      <div>
        <h2 id="deposit-snapshot-title" className="text-2xl font-semibold tracking-tight text-foreground">
          {t(k("snapshot.title"), { month })}
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t(k("snapshot.intro"))}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-border bg-background p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">{t(k("snapshot.portugal"))}</p>
          <p className="mt-1 font-mono text-3xl font-bold text-primary">{percent(latest.pt.all)}</p>
        </div>
        <div className="rounded-card border border-border bg-background p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">{t(k("snapshot.euroArea"))}</p>
          <p className="mt-1 font-mono text-3xl font-bold text-foreground">{percent(latest.ea.all)}</p>
        </div>
      </div>
      <p className="max-w-3xl text-xs text-muted-foreground">
        {t(k("snapshot.asOf"), { month, retrieved: DEPOSIT_RATES_SOURCE.retrievedOn })}
        {latest.provisional ? ` ${t(k("snapshot.provisional"))}` : ""}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[28rem] text-sm">
          <caption className="sr-only">{t(k("snapshot.caption"))}</caption>
          <thead className="bg-paper-2 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("snapshot.maturity"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("snapshot.portugalShort"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("snapshot.euroAreaShort"))}</th>
            </tr>
          </thead>
          <tbody>
            {DEPOSIT_BUCKETS.map((bucket) => (
              <tr key={bucket} className="border-t border-border-2">
                <th scope="row" className="px-3 py-2 text-left font-normal text-foreground">
                  {bucketLabel(t, bucket)}
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{percent(latest.pt[bucket])}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{percent(latest.ea[bucket])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-card border border-border bg-background p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-foreground">{t(k("real.title"), { year: String(year.year) })}</h3>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t(k("real.nominal"))}</dt>
            <dd className="font-mono text-foreground">{percent(year.pt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t(k("real.inflation"))}</dt>
            <dd className="font-mono text-foreground">{percent(year.inflation)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t(k("real.gross"))}</dt>
            <dd className="font-mono text-foreground">{percent(year.realGross, "always")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t(k("real.net"), { tax: String(DEPOSIT_TAX_RATE) })}</dt>
            <dd className="font-mono font-semibold text-primary">{percent(year.realNet, "always")}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">
          {t(k(year.realNet >= 0 ? "real.positive" : "real.negative"), { year: String(year.year) })}
        </p>
      </div>
      <p className="max-w-3xl rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("notBestOffer"))}</p>
    </section>
  );
}

function Results({ result, eur }: { result: DepositBenchmarkResult; eur: (value: number, decimals?: number) => string }) {
  const { t, locale } = useTranslations();
  const percent = (value: number, sign: "auto" | "always" = "auto") =>
    formatPercent(locale, value, { decimals: 2, sign });
  const { deposit } = result;

  return (
    <>
      <CalculatorResult
        items={[
          {
            label: t(k("result.net"), { tax: String(DEPOSIT_TAX_RATE) }),
            value: eur(deposit.netInterest),
            highlight: true,
          },
          { label: t(k("result.gross")), value: eur(deposit.grossInterest) },
          { label: t(k("result.tax"), { tax: String(DEPOSIT_TAX_RATE) }), value: eur(deposit.tax) },
          { label: t(k("result.inflationCost")), value: eur(result.inflationCost) },
          { label: t(k("result.realGain")), value: eur(result.realGain) },
          { label: t(k("result.realYield")), value: percent(result.realNetYieldPct, "always") },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        {t(k("result.assumptions"), {
          rate: percent(result.ratePct),
          bucket: t(k(`buckets.${result.bucket}`)),
          month: formatMonthYear(locale, monthToDate(result.month)),
          months: String(deposit.termMonths),
        })}
      </p>
      {result.fellBack && (
        <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("result.fallback"))}</p>
      )}
      <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
        {t(k(result.realGain >= 0 ? "result.beats" : "result.loses"))}
      </p>
      <p className="text-xs text-muted-foreground">{t(k("result.note"))}</p>
    </>
  );
}

function History() {
  const { t, locale } = useTranslations();
  const [bucket, setBucket] = useState<DepositBucket>("all");
  const percent = (value: number | null, sign: "auto" | "always" = "auto") =>
    value === null ? t(k("snapshot.noData")) : formatPercent(locale, value, { decimals: 2, sign });
  const data = useMemo(
    () =>
      DEPOSIT_RATES.map((row) => ({
        month: row[0],
        pt: rateOf(row, "pt", bucket),
        ea: rateOf(row, "ea", bucket),
        inflation: portugalInflation(Number(row[0].slice(0, 4))),
      })),
    [bucket],
  );
  const years = useMemo(() => yearSummaries().slice().reverse(), []);

  return (
    <section className="mt-12 space-y-6" aria-labelledby="deposit-history-title">
      <h2 id="deposit-history-title" className="text-2xl font-semibold tracking-tight text-foreground">
        {t(k("history.title"))}
      </h2>
      <div className="max-w-xs space-y-1.5">
        <label htmlFor="deposit-bucket" className="block text-sm font-medium text-foreground">
          {t(k("history.bucket"))}
        </label>
        <select
          id="deposit-bucket"
          value={bucket}
          onChange={(event) => setBucket(event.currentTarget.value as DepositBucket)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {DEPOSIT_BUCKETS.map((option) => (
            <option key={option} value={option}>
              {bucketLabel(t, option)}
            </option>
          ))}
        </select>
      </div>
      <div className="h-72 w-full min-w-0" role="img" aria-label={t(k("history.chartLabel"))}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
            <XAxis dataKey="month" interval={23} tickFormatter={(value: string) => value.slice(0, 4)} tick={{ fontSize: 12 }} />
            <YAxis
              tickFormatter={(value: number) => formatPercent(locale, value, { decimals: 0 })}
              tick={{ fontSize: 12 }}
              width={48}
            />
            <Tooltip
              // @ts-expect-error Recharts tooltip types are very broken
              formatter={(value: number | null, name: string) => [percent(value), name]}
              labelFormatter={(label) => formatMonthYear(locale, monthToDate(String(label)))}
            />
            <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
            <Line type="monotone" dataKey="pt" name={t(k("history.portugal"))} stroke="oklch(var(--chart-2))" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="ea" name={t(k("history.euroArea"))} stroke="oklch(var(--chart-1))" strokeWidth={2} dot={false} connectNulls />
            <Line type="stepAfter" dataKey="inflation" name={t(k("history.inflation"))} stroke="oklch(var(--chart-3))" strokeWidth={2} strokeDasharray="4 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">{t(k("history.chartNote"))}</p>
      <div className="max-h-96 overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="sr-only">{t(k("history.caption"))}</caption>
          <thead className="sticky top-0 bg-paper-2 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("history.year"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("history.portugal"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("history.euroArea"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("history.inflation"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("history.realNet"), { tax: String(DEPOSIT_TAX_RATE) })}</th>
            </tr>
          </thead>
          <tbody>
            {years.map((row) => (
              <tr key={row.year} className="border-t border-border-2">
                <th scope="row" className="px-3 py-2 text-left font-mono font-normal text-foreground">{row.year}</th>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{percent(row.pt)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{percent(row.ea)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-muted-foreground">{percent(row.inflation)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{percent(row.realNet, "always")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
