// Solar self-consumption in the electricity tariff comparator: the form section (district, kWp,
// losses, an optional surplus sale price), the hook that loads the district's PVGIS table and nets
// it against the consumption, and the results summary. The page logic is in
// lib/calculators/electricitySolar.ts. The visitor's location, when they share it, only picks the
// nearest district capital in the browser: it is never sent or stored.
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import { k } from "./ElectricityTariffResults";
import type { HourlyCycle, LoadReading, PeriodKwh } from "@/lib/calculators/electricityPeriods";
import type { ComparisonSort } from "@/lib/calculators/electricityTariffComparison";
import {
  loadSolarDistrict,
  nearestDistrict,
  SOLAR_DEFAULTS,
  SOLAR_DISTRICTS,
  SOLAR_LIMITS,
  SOLAR_PRODUCTION_SOURCE,
  solarConsumption,
  solarErrors,
  solarShares,
  yearlyBalance,
  type SolarBillSaving,
  type SolarConsumption,
} from "@/lib/calculators/electricitySolar";
import { formatIsoDate } from "@/lib/calculators/electricityTariffComparator";
import { supplierName } from "@/lib/calculators/electricitySuppliers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { useTranslations } from "@/lib/reactTranslations";

export interface SolarSettings {
  on: boolean;
  district: string;
  kwp: number;
  lossPercent: number;
  /** Euro per kWh; NaN when not entered. */
  surplusPrice: number;
}

export const INITIAL_SOLAR: SolarSettings = {
  on: false,
  district: SOLAR_DEFAULTS.district,
  kwp: SOLAR_DEFAULTS.kwp,
  lossPercent: SOLAR_DEFAULTS.lossPercent,
  surplusPrice: Number.NaN,
};

/** Loads a district's typical year. A prop so tests can pass a fixture; the page loads the JSON chunk. */
export type SolarLoader = (slug: string) => Promise<ArrayLike<number>>;

type Production = { state: "off" } | { state: "loading" } | { state: "error" } | { state: "ready"; slug: string; typicalYear: ArrayLike<number> };

const surplusPriceOf = (settings: SolarSettings) => (Number.isFinite(settings.surplusPrice) ? settings.surplusPrice : null);

export function solarInputErrors(settings: SolarSettings) {
  return solarErrors({ kwp: settings.kwp, lossPercent: settings.lossPercent, surplusPrice: surplusPriceOf(settings) });
}

export interface SolarState {
  production: Production;
  /** The grid consumption and the balance, when solar is on, its inputs are valid and its table loaded. */
  result: SolarConsumption | null;
}

/** The previous value while the new one has the same content (a small, JSON-able object). */
function useSameValue<T>(value: T): T {
  const last = useRef<{ key: string; value: T } | null>(null);
  const key = JSON.stringify(value) ?? "";
  if (last.current?.key !== key) last.current = { key, value };
  return last.current.value;
}

/**
 * The district's table, loaded when solar is on, and the consumption netted against it. `readings`
 * are the uploaded diagram's quarter-hours, or null when the consumption was typed in.
 */
export function useSolar(
  settings: SolarSettings,
  input: { consumption: PeriodKwh | null; readings: readonly LoadReading[] | null; contractedPower: number; cycle: HourlyCycle },
  loader: SolarLoader = loadSolarDistrict,
): SolarState {
  const [production, setProduction] = useState<Production>({ state: "off" });
  useEffect(() => {
    if (!settings.on) {
      setProduction({ state: "off" });
      return;
    }
    let cancelled = false;
    setProduction({ state: "loading" });
    loader(settings.district)
      .then((typicalYear) => {
        if (!cancelled) setProduction({ state: "ready", slug: settings.district, typicalYear });
      })
      .catch(() => {
        if (!cancelled) setProduction({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [settings.on, settings.district, loader]);

  const valid = Object.keys(solarInputErrors(settings)).length === 0;
  const { readings, contractedPower, cycle } = input;
  // The page rebuilds its consumption object on any form change; netting a year of quarter-hours
  // is only redone when the kWh themselves change.
  const consumption = useSameValue(input.consumption);
  const result = useMemo(() => {
    if (!settings.on || !valid || production.state !== "ready" || !consumption) return null;
    return solarConsumption({
      consumption,
      readings,
      contractedPower,
      cycle,
      system: { typicalYear: production.typicalYear, kwp: settings.kwp, lossPercent: settings.lossPercent },
    });
  }, [settings.on, settings.kwp, settings.lossPercent, valid, production, consumption, readings, contractedPower, cycle]);
  return { production, result };
}

const linkClass = "font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80";
const summaryClass =
  "flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden";
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Locating = "idle" | "locating" | "found" | "failed";

/** The form section. `production` is the loading state of the district's table. */
export function ElectricitySolarPanel({
  settings,
  onChange,
  production,
}: {
  settings: SolarSettings;
  onChange: (settings: SolarSettings) => void;
  production: Production;
}) {
  const { t, locale } = useTranslations();
  const [canLocate, setCanLocate] = useState(false);
  const [locating, setLocating] = useState<Locating>("idle");
  useEffect(() => setCanLocate(typeof navigator !== "undefined" && "geolocation" in navigator), []);

  const set = <K extends keyof SolarSettings>(field: K, value: SolarSettings[K]) => onChange({ ...settings, [field]: value });
  const errors = solarInputErrors(settings);
  const message = (field: "kwp" | "lossPercent" | "surplusPrice") =>
    errors[field] === "required" ? t(k("errors.required")) : errors[field] === "outOfRange" ? t(k(`solar.errors.${field}`)) : undefined;
  const district = SOLAR_DISTRICTS.find((each) => each.slug === settings.district) ?? SOLAR_DISTRICTS[0];

  const locate = () => {
    setLocating("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({ ...settings, district: nearestDistrict(position.coords.latitude, position.coords.longitude).slug });
        setLocating("found");
      },
      () => setLocating("failed"),
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 15_000 },
    );
  };

  return (
    <details className="group rounded-card border border-border bg-background" open={settings.on || undefined}>
      <summary className={summaryClass}>
        <span>{t(k("solar.title"))}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="space-y-4 border-t border-border px-6 py-5">
        <p className="text-sm text-ink-2">{t(k("solar.intro"))}</p>
        <label htmlFor="tariff-solar" className="flex items-start gap-2 text-sm text-foreground">
          <input
            id="tariff-solar"
            type="checkbox"
            checked={settings.on}
            onChange={(event) => set("on", event.currentTarget.checked)}
            aria-describedby="tariff-solar-help"
            className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span>{t(k("solar.toggle"))}</span>
        </label>
        <p id="tariff-solar-help" className="pl-6 text-xs text-muted-foreground">
          {t(k("solar.alreadyHave"))}
        </p>
        {settings.on && (
          <fieldset className="space-y-4">
            <legend className="sr-only">{t(k("solar.legend"))}</legend>
            <div className="space-y-1.5">
              <label htmlFor="tariff-solar-district" className="block text-sm font-medium text-foreground">
                {t(k("solar.district"))}
              </label>
              <select
                id="tariff-solar-district"
                value={settings.district}
                onChange={(event) => {
                  setLocating("idle");
                  set("district", event.currentTarget.value);
                }}
                aria-describedby="tariff-solar-district-help"
                className={selectClass}
              >
                {SOLAR_DISTRICTS.map((each) => (
                  <option key={each.slug} value={each.slug}>
                    {each.name}
                  </option>
                ))}
              </select>
              <p id="tariff-solar-district-help" className="text-xs text-muted-foreground">
                {t(k("solar.districtHelp"), { slope: formatNumber(locale, district.slope, 0) })}
              </p>
              {canLocate && (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={locate}
                    disabled={locating === "locating"}
                    className="text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80 disabled:opacity-60"
                  >
                    {t(k("solar.locate"))}
                  </button>
                  <p role="status" className="text-xs text-muted-foreground">
                    {locating === "locating"
                      ? t(k("solar.locating"))
                      : locating === "found"
                        ? t(k("solar.located"), { district: district.name })
                        : locating === "failed"
                          ? t(k("solar.locateFailed"))
                          : t(k("solar.locatePrivacy"))}
                  </p>
                </div>
              )}
            </div>
            <CalculatorInput
              id="tariff-solar-kwp"
              label={t(k("solar.kwp"))}
              value={settings.kwp}
              onChange={(value) => set("kwp", value)}
              min={0}
              max={SOLAR_LIMITS.maxKwp}
              step={0.1}
              suffix={t(k("solar.kwpUnit"))}
              helpText={t(k("solar.kwpHelp"))}
              error={message("kwp")}
            />
            <CalculatorInput
              id="tariff-solar-losses"
              label={t(k("solar.losses"))}
              value={settings.lossPercent}
              onChange={(value) => set("lossPercent", value)}
              min={0}
              max={SOLAR_LIMITS.maxLossPercent}
              step={1}
              suffix="%"
              helpText={t(k("solar.lossesHelp"))}
              error={message("lossPercent")}
            />
            <CalculatorInput
              id="tariff-solar-price"
              label={t(k("solar.surplusPrice"))}
              value={settings.surplusPrice}
              onChange={(value) => set("surplusPrice", value)}
              min={0}
              max={SOLAR_LIMITS.maxSurplusPrice}
              step={0.001}
              suffix="€/kWh"
              helpText={t(k("solar.surplusPriceHelp"))}
              error={message("surplusPrice")}
            />
            {production.state === "loading" && (
              <p role="status" className="text-sm text-foreground">
                {t(k("solar.loading"))}
              </p>
            )}
            {production.state === "error" && (
              <p role="alert" className="text-sm text-destructive-text">
                {t(k("solar.loadError"))}
              </p>
            )}
          </fieldset>
        )}
      </div>
    </details>
  );
}

/** The results summary: what the panels change, and where the production estimate comes from. */
export function ElectricitySolarSummary({
  result,
  saving,
  settings,
  sortBy,
}: {
  result: SolarConsumption;
  saving: SolarBillSaving | null;
  settings: SolarSettings;
  sortBy: ComparisonSort;
}) {
  const { t, locale } = useTranslations();
  const year = yearlyBalance(result.balance, result.kwh.days);
  const shares = solarShares(year);
  const kwh = (value: number) => `${formatNumber(locale, value, 0)} kWh`;
  const euro = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const percent = (value: number) => formatPercent(locale, value * 100, { decimals: 0 });
  const price = surplusPriceOf(settings);
  const district = SOLAR_DISTRICTS.find((each) => each.slug === settings.district) ?? SOLAR_DISTRICTS[0];
  const source = SOLAR_PRODUCTION_SOURCE;
  const offerName = saving ? (saving.best.offer.regulated ? t(k("regulatedSupplier")) : supplierName(saving.best.offer.supplier)) : "";

  const stats = [
    { key: "production", label: t(k("solar.summary.production")), value: kwh(year.production) },
    { key: "selfConsumed", label: t(k("solar.summary.selfConsumed")), value: percent(shares.selfConsumed), note: kwh(year.selfConsumed) },
    { key: "coverage", label: t(k("solar.summary.coverage")), value: percent(shares.coverage) },
    { key: "surplus", label: t(k("solar.summary.surplus")), value: kwh(year.surplus) },
  ];

  return (
    <section aria-labelledby="tariff-solar-title" className="space-y-4 rounded-card border border-border bg-background p-5">
      <div>
        <h2 id="tariff-solar-title" className="text-lg font-semibold text-foreground">
          {t(k("solar.summary.title"))}
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          {t(k("solar.summary.system"), {
            kwp: formatNumber(locale, settings.kwp, 1),
            district: district.name,
            slope: formatNumber(locale, district.slope, 0),
          })}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.key}>
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="font-mono text-lg font-semibold text-foreground">{stat.value}</dd>
            {stat.note && <dd className="font-mono text-xs text-muted-foreground">{stat.note}</dd>}
          </div>
        ))}
      </dl>
      {saving && (
        <p className="text-sm text-foreground">
          {t(k(sortBy === "firstYear" ? "solar.summary.savingFirstYear" : "solar.summary.savingLaterYears"), {
            amount: euro(saving.saving),
            supplier: offerName,
            offer: saving.best.offer.name,
            without: euro(saving.withoutSolar),
            with: euro(saving.withSolar),
          })}
        </p>
      )}
      {price !== null && (
        <p className="text-sm text-foreground">
          {t(k("solar.summary.surplusIncome"), { amount: euro(year.surplus * price), price: formatNumber(locale, price, 3) })}
        </p>
      )}
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>{t(k(result.fromDiagram ? "solar.summary.fromDiagram" : "solar.summary.fromProfile"))}</li>
        <li>{t(k("solar.summary.ranking"))}</li>
        <li>
          {t(k("solar.summary.source"), {
            version: source.version,
            database: source.radiationDb,
            from: String(source.yearMin),
            to: String(source.yearMax),
            date: formatIsoDate(locale, source.downloadedOn),
          })}{" "}
          <a href={source.url} rel="noopener" target="_blank" className={linkClass}>
            {t(k("solar.summary.sourceLink"))}
          </a>
        </li>
      </ul>
    </section>
  );
}
