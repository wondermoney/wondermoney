import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "@/components/shared/charts";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  BILL_DAYS,
  CONTRACTED_POWERS_KVA,
  ELECTRICITY_BILL_EXAMPLE,
  ELECTRICITY_BILL_LIMITS,
  ELECTRICITY_PRICES_SOURCE,
  ERSE_TARIFFS,
  computeElectricityBill,
  electricityIndexSeries,
  type ElectricityBillField,
  type ElectricityBillInput,
  type ElectricityBillResult,
} from "@/lib/calculators/electricityBill";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { Select } from "@/components/ui/select";

const k = (key: string) => `tools.electricityIndex.${key}`;
const SERIES = electricityIndexSeries();

export default function ElectricityIndexComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <ElectricityIndex />
    </ReactTranslationsProvider>
  );
}

function ElectricityIndex() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<ElectricityBillInput>(ELECTRICITY_BILL_EXAMPLE);
  const [edited, setEdited] = useState(false);
  const usageSent = useRef(false);

  const calculation = useMemo(() => computeElectricityBill(input), [input]);
  const result = calculation.ok ? calculation.result : null;
  const errors = calculation.ok ? {} : calculation.errors;

  useEffect(() => {
    if (!edited || !result || usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the power, the consumption, the option or the result.
    pushGtmEvent({ event: "tool_used", tool: "electricity_index", page_type: getPageType() });
  }, [edited, result]);

  const update = <K extends keyof ElectricityBillInput>(field: K, value: ElectricityBillInput[K]) => {
    setEdited(true);
    setInput((current) => ({ ...current, [field]: value }));
  };
  const euro = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });
  const errorFor = (field: ElectricityBillField) => {
    const error = errors[field];
    if (!error) return undefined;
    const max =
      input.period === "month" ? ELECTRICITY_BILL_LIMITS.maxMonthlyKwh : ELECTRICITY_BILL_LIMITS.maxAnnualKwh;
    return t(k(`errors.${error}`), { max: `${formatNumber(locale, max)} kWh` });
  };
  const powerError = errorFor("contractedPower");

  return (
    <>
      <CalculatorLayout>
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <div className="space-y-1.5">
            <label htmlFor="electricity-power" className="block text-sm font-medium text-foreground">
              {t(k("fields.power"))}
            </label>
            <Select
              id="electricity-power"
              value={input.contractedPower}
              onChange={(event) => update("contractedPower", Number(event.currentTarget.value))}
              aria-invalid={powerError ? true : undefined}
              aria-describedby="electricity-power-help"
            >
              {CONTRACTED_POWERS_KVA.map((power) => (
                <option key={power} value={power}>
                  {formatNumber(locale, power, 2)} kVA
                </option>
              ))}
            </Select>
            <p id="electricity-power-help" className="text-xs text-muted-foreground">
              {t(k("help.power"))}
            </p>
            {powerError && (
              <p role="alert" className="text-sm text-destructive-text">
                {powerError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="electricity-period" className="block text-sm font-medium text-foreground">
              {t(k("fields.period"))}
            </label>
            <Select
              id="electricity-period"
              value={input.period}
              onChange={(event) => update("period", event.currentTarget.value as ElectricityBillInput["period"])}
            >
              <option value="month">{t(k("fields.periodMonth"))}</option>
              <option value="year">{t(k("fields.periodYear"))}</option>
            </Select>
          </div>
          <CalculatorInput
            id="electricity-consumption"
            label={t(k("fields.consumption"))}
            value={input.consumption}
            onChange={(value) => update("consumption", value)}
            min={0}
            max={input.period === "month" ? ELECTRICITY_BILL_LIMITS.maxMonthlyKwh : ELECTRICITY_BILL_LIMITS.maxAnnualKwh}
            step={10}
            suffix="kWh"
            helpText={t(k("help.consumption"))}
            error={errorFor("consumption")}
          />

          <div className="space-y-1.5">
            <label htmlFor="electricity-option" className="block text-sm font-medium text-foreground">
              {t(k("fields.option"))}
            </label>
            <Select
              id="electricity-option"
              value={input.option}
              onChange={(event) => update("option", event.currentTarget.value as ElectricityBillInput["option"])}
            >
              <option value="simple">{t(k("fields.optionSimple"))}</option>
              <option value="biHourly">{t(k("fields.optionBi"))}</option>
            </Select>
          </div>
          {input.option === "biHourly" && (
            <CalculatorInput
              id="electricity-offpeak"
              label={t(k("fields.offPeak"))}
              value={input.offPeakPercent}
              onChange={(value) => update("offPeakPercent", value)}
              min={0}
              max={100}
              step={5}
              suffix="%"
              helpText={t(k("help.offPeak"))}
              error={errorFor("offPeakPercent")}
            />
          )}

          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={input.largeFamily}
                onChange={(event) => update("largeFamily", event.currentTarget.checked)}
                aria-describedby="electricity-family-help"
                className="size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {t(k("fields.largeFamily"))}
            </label>
            <p id="electricity-family-help" className="pl-6 text-xs text-muted-foreground">
              {t(k("help.largeFamily"))}
            </p>
          </div>
        </div>

        <div className="min-w-0 space-y-5 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <Bill result={result} input={input} euro={euro} />
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
          <div className="space-y-2 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
            <p>
              {t(k("notes.tariffs"), {
                date: ERSE_TARIFFS.effectiveFrom,
                checked: ERSE_TARIFFS.checkedOn,
              })}
            </p>
            <p>{t(k("notes.dgeg"))}</p>
            <p>
              {t(k("notes.freeMarket"))}{" "}
              <a
                href={ERSE_TARIFFS.sources.simulator.url}
                rel="noopener"
                target="_blank"
                className="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80"
              >
                {t(k("notes.simulatorLink"))}
              </a>
            </p>
          </div>
        </div>
      </CalculatorLayout>

      <IndexSection />
    </>
  );
}

type Euro = (value: number, decimals?: number) => string;

function Bill({ result, input, euro }: { result: ElectricityBillResult; input: ElectricityBillInput; euro: Euro }) {
  const { t, locale } = useTranslations();
  const kwh = (value: number) => `${formatNumber(locale, value, 0)} kWh`;
  const rate = (value: number) => formatPercent(locale, value * 100, { decimals: 0 });
  const { breakdown } = result;
  const powerValues = { kva: formatNumber(locale, input.contractedPower, 2), days: String(BILL_DAYS) };
  // Up to 3.45 kVA the power term pays two VAT rates: 6% on its network-access part, 23% on the rest.
  const powerRows =
    breakdown.powerNetwork.net > 0
      ? [
          { key: "powerNetwork", label: t(k("result.powerNetwork"), powerValues), line: breakdown.powerNetwork },
          { key: "power", label: t(k("result.powerRest"), powerValues), line: breakdown.power },
        ]
      : [{ key: "power", label: t(k("result.power"), powerValues), line: breakdown.power }];
  const rows = [
    ...powerRows,
    ...(breakdown.energyReduced.net > 0
      ? [{ key: "energyReduced", label: t(k("result.energyReduced"), { kwh: kwh(result.reducedKwh) }), line: breakdown.energyReduced }]
      : []),
    ...(breakdown.energyStandard.net > 0.000001
      ? [
          {
            key: "energyStandard",
            label: t(k("result.energyStandard"), { kwh: kwh(result.monthlyKwh - result.reducedKwh) }),
            line: breakdown.energyStandard,
          },
        ]
      : []),
    // No CAV below 400 kWh a year: the row stays, at zero, and says why.
    { key: "cav", label: t(k(breakdown.cav.net > 0 ? "result.cav" : "result.cavExempt")), line: breakdown.cav },
    { key: "iec", label: t(k("result.iec")), line: breakdown.iec },
  ];
  const alternative = result.alternative;
  const difference = alternative ? Math.abs(alternative.total - result.total) : 0;
  const optionName = (option: "simple" | "biHourly") => t(k(option === "simple" ? "fields.optionSimple" : "fields.optionBi"));

  return (
    <>
      <CalculatorResult
        items={[
          { label: t(k("result.total")), value: euro(result.total), highlight: true },
          { label: t(k("result.yearly")), value: euro(result.yearly, 0) },
          ...(result.effectivePerKwh !== null
            ? [{ label: t(k("result.effective")), value: `${formatMoney(locale, result.effectivePerKwh, { decimals: 3 })}/kWh` }]
            : []),
        ]}
      />
      {result.monthlyKwh === 0 && (
        <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("result.noConsumption"))}</p>
      )}
      {/* A plain table under the ledger: the panel is the card, so no second border around it.
          Its labels wrap, so it fits a phone without scrolling sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t(k("result.breakdown"))}</caption>
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 text-left font-medium">{t(k("result.item"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("result.beforeVat"))}</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">{t(k("result.vatRate"))}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border-2 first:border-t-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-foreground">{row.label}</th>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{euro(row.line.net)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right font-mono text-muted-foreground">{rate(row.line.vatRate)}</td>
              </tr>
            ))}
            <tr className="border-t border-border">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-foreground">{t(k("result.subtotal"))}</th>
              <td className="px-3 py-2 text-right font-mono text-foreground">{euro(result.subtotal)}</td>
              <td />
            </tr>
            <tr className="border-t border-border-2">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-foreground">{t(k("result.vat"))}</th>
              <td className="px-3 py-2 text-right font-mono text-foreground">{euro(result.vat)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {alternative && (
        <p className="text-sm text-muted-foreground">
          {difference < 0.005
            ? t(k("result.comparisonSame"), { other: optionName(alternative.option) })
            : t(k(alternative.total > result.total ? "result.comparisonDearer" : "result.comparisonCheaper"), {
                other: optionName(alternative.option),
                amount: euro(alternative.total),
                difference: euro(difference),
              })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t(k("result.breakEven"), { percent: formatNumber(locale, result.breakEvenOffPeakPercent, 0) })}
      </p>
    </>
  );
}

function IndexSection() {
  const { t, locale } = useTranslations();
  const latest = SERIES[SERIES.length - 1];
  const per = (value: number, decimals = 3) => `${formatMoney(locale, value, { decimals })}/kWh`;
  const percent = (value: number) => formatPercent(locale, value, { decimals: 0, sign: "always" });
  const gap = Math.abs(latest.gapPercent);
  const summaryKey = gap < 0.5 ? "index.equal" : latest.gapPercent < 0 ? "index.below" : "index.above";
  const recent = SERIES.slice(-8).reverse();

  return (
    <section className="mt-10 space-y-6" aria-labelledby="electricity-index-title">
      <h2 id="electricity-index-title" className="text-2xl font-semibold tracking-tight text-foreground">
        {t(k("index.title"))}
      </h2>
      <p className="max-w-3xl leading-7 text-ink-2">{t(k("index.intro"))}</p>
      <p className="font-medium text-foreground">
        {t(k(summaryKey), {
          period: latest.label,
          portugal: per(latest.portugal),
          eu: per(latest.eu),
          gap: formatPercent(locale, gap, { decimals: 0 }),
        })}
      </p>
      <div className="h-72 w-full min-w-0" role="img" aria-label={t(k("index.chartLabel"))}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={SERIES} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} minTickGap={32} />
            <YAxis
              domain={[0, "auto"]}
              tickFormatter={(value: number) => formatMoney(locale, value, { decimals: 2 })}
              tick={{ fontSize: 12 }}
              width={56}
            />
            <Tooltip
              // @ts-expect-error Recharts tooltip types are very broken
              formatter={(value: number, name: string) => [per(value, 4), name]}
            />
            <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
            <Line type="monotone" dataKey="portugal" name={t(k("index.portugal"))} stroke="oklch(var(--chart-2))" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="eu" name={t(k("index.eu"))} stroke="oklch(var(--chart-1))" strokeWidth={2} strokeDasharray="4 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[26rem] text-sm">
          <caption className="sr-only">{t(k("index.tableCaption"))}</caption>
          <thead className="bg-paper-2 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("index.period"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("index.portugal"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("index.eu"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("index.gap"))}</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((row) => (
              <tr key={row.period} className="border-t border-border-2">
                <th scope="row" className="px-3 py-2 text-left font-mono font-normal text-foreground">{row.label}</th>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{per(row.portugal)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{per(row.eu)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-muted-foreground">{percent(row.gapPercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(k("index.asOf"), {
          last: latest.label,
          updated: ELECTRICITY_PRICES_SOURCE.updatedOn,
          fetched: ELECTRICITY_PRICES_SOURCE.fetchedOn,
        })}
      </p>
    </section>
  );
}
