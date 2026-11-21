import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "@/components/shared/charts";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import CheapestStations from "./CheapestStations";
import {
  FUEL_COST_LIMITS,
  FUEL_PRICES_SOURCE,
  FUEL_TYPES,
  computeFuelCost,
  fuelCostExample,
  fuelPriceSeries,
  fuelPriceSummaries,
  latestFuelPrice,
  type DistancePeriod,
  type FuelCostField,
  type FuelCostInput,
  type FuelCostResult,
  type FuelType,
} from "@/lib/calculators/fuelCost";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatMonthYear, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { toLocalizedPath } from "@/lib/routes";
import { Select } from "@/components/ui/select";

const k = (key: string) => `tools.fuelPrices.${key}`;
const SERIES = fuelPriceSeries();
const SUMMARIES = fuelPriceSummaries();
const COLORS: Record<FuelType, string> = {
  diesel: "oklch(var(--chart-2))",
  gasoline95: "oklch(var(--chart-1))",
  lpg: "oklch(var(--chart-3))",
};

export default function FuelPricesComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <FuelPrices />
    </ReactTranslationsProvider>
  );
}

function FuelPrices() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<FuelCostInput>(() => fuelCostExample());
  const [priceEdited, setPriceEdited] = useState(false);
  const [edited, setEdited] = useState(false);
  const usageSent = useRef(false);

  const calculation = useMemo(() => computeFuelCost(input), [input]);
  const result = calculation.ok ? calculation.result : null;
  const errors = calculation.ok ? {} : calculation.errors;
  const latest = latestFuelPrice(input.fuel);

  useEffect(() => {
    if (!edited || !result || usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the distance, the consumption, the fuel, the price or the result.
    pushGtmEvent({ event: "tool_used", tool: "fuel_prices", page_type: getPageType() });
  }, [edited, result]);

  const update = <K extends keyof FuelCostInput>(field: K, value: FuelCostInput[K]) => {
    setEdited(true);
    setInput((current) => ({ ...current, [field]: value }));
  };
  const changeFuel = (fuel: FuelType) => {
    setEdited(true);
    // A price the visitor has not typed follows the fuel; a typed one stays.
    setInput((current) => ({ ...current, fuel, price: priceEdited ? current.price : latestFuelPrice(fuel) }));
  };
  const euro = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });
  const maxLabel = (field: FuelCostField) =>
    field === "distance"
      ? `${formatNumber(locale, FUEL_COST_LIMITS.distance)} km`
      : field === "consumption"
        ? `${formatNumber(locale, FUEL_COST_LIMITS.consumption)} L/100 km`
        : field === "price"
          ? `${euro(FUEL_COST_LIMITS.price)}/L`
          : formatNumber(locale, FUEL_COST_LIMITS.tripsPerMonth);
  const errorFor = (field: FuelCostField) => {
    const error = (errors as Partial<Record<FuelCostField, string>>)[field];
    return error ? t(k(`errors.${error}`), { max: maxLabel(field) }) : undefined;
  };
  const fuelName = (fuel: FuelType) => t(k(`fuels.${fuel}`));
  const priceDiffers = Number.isFinite(input.price) ? Math.abs(input.price - latest) > 0.0005 : true;

  return (
    <>
      <LatestPrices />
      <CheapestStations />
      <CalculatorLayout>
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <div className="space-y-1.5">
            <label htmlFor="fuel-type" className="block text-sm font-medium text-foreground">
              {t(k("fields.fuel"))}
            </label>
            <Select
              id="fuel-type"
              value={input.fuel}
              onChange={(event) => changeFuel(event.currentTarget.value as FuelType)}
            >
              {FUEL_TYPES.map((fuel) => (
                <option key={fuel} value={fuel}>
                  {fuelName(fuel)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="fuel-period" className="block text-sm font-medium text-foreground">
              {t(k("fields.period"))}
            </label>
            <Select
              id="fuel-period"
              value={input.period}
              onChange={(event) => update("period", event.currentTarget.value as DistancePeriod)}
            >
              <option value="month">{t(k("fields.periodMonth"))}</option>
              <option value="week">{t(k("fields.periodWeek"))}</option>
              <option value="trip">{t(k("fields.periodTrip"))}</option>
            </Select>
          </div>
          <CalculatorInput
            id="fuel-distance"
            label={t(k("fields.distance"))}
            value={input.distance}
            onChange={(value) => update("distance", value)}
            min={0}
            max={FUEL_COST_LIMITS.distance}
            step={10}
            suffix="km"
            helpText={t(k("help.distance"))}
            error={errorFor("distance")}
          />
          {input.period === "trip" && (
            <CalculatorInput
              id="fuel-trips"
              label={t(k("fields.trips"))}
              value={input.tripsPerMonth}
              onChange={(value) => update("tripsPerMonth", value)}
              min={0}
              max={FUEL_COST_LIMITS.tripsPerMonth}
              step={1}
              helpText={t(k("help.trips"))}
              error={errorFor("tripsPerMonth")}
            />
          )}
          <CalculatorInput
            id="fuel-consumption"
            label={t(k("fields.consumption"))}
            value={input.consumption}
            onChange={(value) => update("consumption", value)}
            min={0}
            max={FUEL_COST_LIMITS.consumption}
            step={0.1}
            suffix="L/100 km"
            helpText={t(k("help.consumption"))}
            error={errorFor("consumption")}
          />
          <div className="space-y-2">
            <CalculatorInput
              id="fuel-price"
              label={t(k("fields.price"))}
              value={input.price}
              onChange={(value) => {
                setPriceEdited(true);
                update("price", value);
              }}
              min={0}
              max={FUEL_COST_LIMITS.price}
              step={0.01}
              suffix="€/L"
              helpText={t(k("help.price"), { price: euro(latest, 3), date: FUEL_PRICES_SOURCE.asOf })}
              error={errorFor("price")}
            />
            {priceDiffers && (
              <button
                type="button"
                onClick={() => {
                  setPriceEdited(false);
                  update("price", latest);
                }}
                className="text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t(k("fields.resetPrice"), { price: euro(latest, 3) })}
              </button>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-5 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <Cost result={result} input={input} euro={euro} />
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
          <p className="text-xs text-muted-foreground">{t(k("notes.assumptions"))}</p>
        </div>
      </CalculatorLayout>

      <History />
    </>
  );
}

function LatestPrices() {
  const { t, locale } = useTranslations();
  const euro = (value: number, decimals = 3) => formatMoney(locale, value, { decimals });

  return (
    <section className="mb-10 space-y-4" aria-labelledby="fuel-latest-title">
      <h2 id="fuel-latest-title" className="text-2xl font-semibold tracking-tight text-foreground">
        {t(k("latest.title"))}
      </h2>
      <p className="font-medium text-foreground">
        {t(k("latest.asOf"), { date: FUEL_PRICES_SOURCE.asOf, previous: SUMMARIES[0].previousDate })}
      </p>
      <ul className="grid gap-4 sm:grid-cols-3">
        {SUMMARIES.map((summary) => {
          const flat = Math.abs(summary.change) < 0.0005;
          return (
            <li key={summary.fuel} className="rounded-card border border-border bg-background p-5">
              <p className="text-sm text-muted-foreground">{t(k(`fuels.${summary.fuel}`))}</p>
              <p className="font-mono text-2xl font-bold text-foreground">{euro(summary.price)}/L</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {flat
                  ? t(k("latest.flat"))
                  : t(k("latest.change"), {
                      amount: formatMoney(locale, summary.change, { decimals: 3, sign: "always" }),
                      percent: formatPercent(locale, summary.changePercent, { decimals: 1, sign: "always" }),
                    })}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t(k("latest.note"))}</p>
    </section>
  );
}

type Euro = (value: number, decimals?: number) => string;

function Cost({ result, input, euro }: { result: FuelCostResult; input: FuelCostInput; euro: Euro }) {
  const { t, locale } = useTranslations();
  const litres = (value: number) => `${formatNumber(locale, value, 1)} L`;

  return (
    <>
      <CalculatorResult
        items={[
          { label: t(k("result.monthly")), value: euro(result.monthly), highlight: true },
          ...(input.period !== "month" ? [{ label: t(k(`result.${input.period}`)), value: euro(result.cost) }] : []),
          { label: t(k("result.litres")), value: litres(result.monthlyLitres) },
          { label: t(k("result.yearly")), value: euro(result.yearly, 0) },
          { label: t(k("result.per100")), value: euro(result.per100Km) },
        ]}
      />
      {result.monthly === 0 && (
        <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("result.nothing"))}</p>
      )}
      <div className="space-y-2 rounded-lg bg-paper-2 px-4 py-3">
        <p className="text-sm text-foreground">
          {t(k("result.budget"), { amount: euro(result.monthly) })}
        </p>
        <a
          href={toLocalizedPath("featureBudgeting", locale)}
          onClick={() => pushGtmEvent({ event: "cta_click", cta_position: "tool_result", page_type: getPageType() })}
          className="text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80"
        >
          {t(k("nextStepCta"))}
        </a>
      </div>
    </>
  );
}

function History() {
  const { t, locale } = useTranslations();
  const per = (value: number) => `${formatMoney(locale, value, { decimals: 3 })}/L`;
  const monthLabel = (date: string) => formatMonthYear(locale, new Date(`${date}T00:00:00Z`));
  const recent = SERIES.slice(-8).reverse();

  return (
    <section className="mt-10 space-y-6" aria-labelledby="fuel-history-title">
      <h2 id="fuel-history-title" className="text-2xl font-semibold tracking-tight text-foreground">
        {t(k("history.title"))}
      </h2>
      <p className="max-w-3xl leading-7 text-ink-2">{t(k("history.intro"))}</p>
      <div className="h-72 w-full min-w-0" role="img" aria-label={t(k("history.chartLabel"))}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={SERIES} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
            <XAxis dataKey="date" tickFormatter={monthLabel} tick={{ fontSize: 12 }} minTickGap={48} />
            <YAxis
              domain={[0, "auto"]}
              tickFormatter={(value: number) => formatMoney(locale, value, { decimals: 2 })}
              tick={{ fontSize: 12 }}
              width={56}
            />
            <Tooltip
              // @ts-expect-error Recharts tooltip types are very broken
              formatter={(value: number, name: string) => [per(value), name]}
            />
            <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
            {FUEL_TYPES.map((fuel) => (
              <Line
                key={fuel}
                type="monotone"
                dataKey={fuel}
                name={t(k(`fuels.${fuel}`))}
                stroke={COLORS[fuel]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[26rem] text-sm">
          <caption className="sr-only">{t(k("history.tableCaption"))}</caption>
          <thead className="bg-paper-2 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("history.date"))}</th>
              {FUEL_TYPES.map((fuel) => (
                <th key={fuel} scope="col" className="px-3 py-2 text-right font-medium">{t(k(`fuels.${fuel}`))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map((row) => (
              <tr key={row.date} className="border-t border-border-2">
                <th scope="row" className="px-3 py-2 text-left font-mono font-normal text-foreground">{row.date}</th>
                {FUEL_TYPES.map((fuel) => (
                  <td key={fuel} className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">
                    {per(row[fuel])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(k("history.asOf"), {
          date: FUEL_PRICES_SOURCE.asOf,
          fetched: FUEL_PRICES_SOURCE.fetchedOn,
          first: FUEL_PRICES_SOURCE.firstDate,
        })}
      </p>
    </section>
  );
}
