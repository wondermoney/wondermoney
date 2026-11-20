// Solar self-consumption in the electricity tariff comparator: the form section (district or
// coordinates, tilt, orientation, kWp, losses, an optional surplus sale price), the hook that loads
// the production and nets it against the consumption, and the results summary. The page logic is
// in lib/calculators/electricitySolar.ts.
//
// Production: facing south at the optimal tilt of a district capital, the district's committed
// PVGIS table; anything else, the site's /api/solar-production route, which asks PVGIS. When the
// route fails, the nearest district's table stands in and the panel says so.
//
// Privacy: in "district" mode the visitor's location, when they share it, only picks the nearest
// district capital in the browser and is never sent. In "coordinates" mode the coordinates are
// rounded to 0.05° in the browser and sent to the route, and from there to PVGIS; the panel says
// so next to the fields.
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import { k } from "./ElectricityTariffResults";
import type { HourlyCycle, LoadReading, PeriodKwh } from "@/lib/calculators/electricityPeriods";
import type { ComparisonSort } from "@/lib/calculators/electricityTariffComparison";
import {
  fetchSolarProduction,
  loadSolarDistrict,
  nearestDistrict,
  SOLAR_DEFAULTS,
  SOLAR_DISTRICTS,
  SOLAR_LIMITS,
  SOLAR_ORIENTATIONS,
  SOLAR_PRODUCTION_SOURCE,
  SolarProductionError,
  solarConsumption,
  solarErrors,
  solarShares,
  solarSite,
  solarSiteErrors,
  yearlyBalance,
  type SolarBillSaving,
  type SolarConsumption,
  type SolarDistrict,
  type SolarOrientation,
  type SolarSiteInput,
} from "@/lib/calculators/electricitySolar";
import { SOLAR_QUERY_LIMITS, type SolarProductionQuery, type SolarProductionResponse } from "@/lib/calculators/solarProductionQuery";
import { formatIsoDate } from "@/lib/calculators/electricityTariffComparator";
import { supplierName } from "@/lib/calculators/electricitySuppliers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { useTranslations } from "@/lib/reactTranslations";

export interface SolarSettings {
  on: boolean;
  location: "district" | "coordinates";
  district: string;
  /** Decimal degrees; NaN when not entered. */
  lat: number;
  lon: number;
  /** Degrees; NaN for PVGIS's optimal tilt at the (nearest) district capital. */
  tilt: number;
  orientation: SolarOrientation | "custom";
  /** The azimuth entered for a "custom" orientation; NaN when not entered. */
  customAspect: number;
  kwp: number;
  lossPercent: number;
  /** Euro per kWh; NaN when not entered. */
  surplusPrice: number;
}

export const INITIAL_SOLAR: SolarSettings = {
  on: false,
  location: "district",
  district: SOLAR_DEFAULTS.district,
  lat: Number.NaN,
  lon: Number.NaN,
  tilt: Number.NaN,
  orientation: "S",
  customAspect: Number.NaN,
  kwp: SOLAR_DEFAULTS.kwp,
  lossPercent: SOLAR_DEFAULTS.lossPercent,
  surplusPrice: Number.NaN,
};

/** Loads a district's typical year. A prop so tests can pass a fixture; the page loads the JSON chunk. */
export type SolarLoader = (slug: string) => Promise<ArrayLike<number>>;
/** Loads a typical year from the /api/solar-production route. A prop so tests can pass a double. */
export type SolarProductionLoader = (
  query: SolarProductionQuery,
  options: { signal: AbortSignal },
) => Promise<{ typicalYear: ArrayLike<number>; response: SolarProductionResponse }>;

/** Where the production in use comes from. */
export type SolarSource =
  | {
      kind: "table";
      district: SolarDistrict;
      /** Set when the table stands in for a route request that failed: why. */
      fallback: null | "failed" | "unavailable";
    }
  | { kind: "pvgis"; response: SolarProductionResponse; district: SolarDistrict | null };

type Production =
  | { state: "off" }
  | { state: "loading"; live: boolean }
  | { state: "error" }
  | { state: "ready"; key: string; typicalYear: ArrayLike<number>; source: SolarSource };

/** Wait after the last change of a field before asking the route, so typing does not send each keystroke. */
export const SOLAR_ROUTE_DELAY_MS = 700;

const surplusPriceOf = (settings: SolarSettings) => (Number.isFinite(settings.surplusPrice) ? settings.surplusPrice : null);

export function solarSiteInput(settings: SolarSettings): SolarSiteInput {
  return {
    location: settings.location,
    district: settings.district,
    lat: settings.lat,
    lon: settings.lon,
    tilt: settings.tilt,
    aspect: settings.orientation === "custom" ? settings.customAspect : SOLAR_ORIENTATIONS[settings.orientation],
  };
}

export function solarInputErrors(settings: SolarSettings) {
  return {
    ...solarErrors({ kwp: settings.kwp, lossPercent: settings.lossPercent, surplusPrice: surplusPriceOf(settings) }),
    ...solarSiteErrors(solarSiteInput(settings)),
  };
}

export interface SolarState {
  production: Production;
  /** Where the production in use comes from, once loaded. */
  source: SolarSource | null;
  /** The grid consumption and the balance, when solar is on, its inputs are valid and its table loaded. */
  result: SolarConsumption | null;
  /** Asks the route again after it failed. */
  retry: () => void;
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
  remote: SolarProductionLoader = fetchSolarProduction,
): SolarState {
  const [production, setProduction] = useState<Production>({ state: "off" });
  const [attempt, setAttempt] = useState(0);
  const site = settings.on ? solarSite(solarSiteInput(settings)) : null;
  const siteKey = site ? JSON.stringify(site.kind === "table" ? site.district.slug : site.query) : null;
  const siteRef = useRef(site);
  siteRef.current = site;
  useEffect(() => {
    if (!settings.on) {
      setProduction({ state: "off" });
      return;
    }
    const current = siteRef.current;
    // An invalid field: the fields say so, and the result waits for it to be fixed.
    if (!current || !siteKey) return;
    let cancelled = false;
    const controller = new AbortController();
    const loadTable = (district: SolarDistrict, fallback: null | "failed" | "unavailable") =>
      loader(district.slug)
        .then((typicalYear) => {
          if (!cancelled) setProduction({ state: "ready", key: siteKey, typicalYear, source: { kind: "table", district, fallback } });
        })
        .catch(() => {
          if (!cancelled) setProduction({ state: "error" });
        });
    if (current.kind === "table") {
      setProduction({ state: "loading", live: false });
      void loadTable(current.district, null);
      return () => {
        cancelled = true;
      };
    }
    setProduction({ state: "loading", live: true });
    const timer = setTimeout(() => {
      remote(current.query, { signal: controller.signal })
        .then(({ typicalYear, response }) => {
          if (!cancelled) setProduction({ state: "ready", key: siteKey, typicalYear, source: { kind: "pvgis", response, district: current.district } });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          void loadTable(current.fallback, error instanceof SolarProductionError && error.code === "location_unavailable" ? "unavailable" : "failed");
        });
    }, SOLAR_ROUTE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [settings.on, siteKey, loader, remote, attempt]);

  const valid = Object.keys(solarInputErrors(settings)).length === 0;
  const { readings, contractedPower, cycle } = input;
  // The page rebuilds its consumption object on any form change; netting a year of quarter-hours
  // is only redone when the kWh themselves change.
  const consumption = useSameValue(input.consumption);
  const result = useMemo(() => {
    if (!settings.on || !valid || production.state !== "ready" || production.key !== siteKey || !consumption) return null;
    return solarConsumption({
      consumption,
      readings,
      contractedPower,
      cycle,
      system: { typicalYear: production.typicalYear, kwp: settings.kwp, lossPercent: settings.lossPercent },
    });
  }, [settings.on, settings.kwp, settings.lossPercent, valid, production, siteKey, consumption, readings, contractedPower, cycle]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { production, source: production.state === "ready" ? production.source : null, result, retry };
}

const linkClass = "font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80";
const summaryClass =
  "flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden";
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Locating = "idle" | "locating" | "found" | "failed";

const ORIENTATION_KEYS = [...(Object.keys(SOLAR_ORIENTATIONS) as SolarOrientation[]), "custom"] as const;
const radioClass = "size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** Coordinates as a map app gives them, to about 10 m. */
const coordinate = (value: number) => Math.round(value * 10_000) / 10_000;

/** The form section. `production` is the loading state of the production in use; `onRetry` asks the route again. */
export function ElectricitySolarPanel({
  settings,
  onChange,
  production,
  onRetry,
}: {
  settings: SolarSettings;
  onChange: (settings: SolarSettings) => void;
  production: Production;
  onRetry?: () => void;
}) {
  const { t, locale } = useTranslations();
  const [canLocate, setCanLocate] = useState(false);
  const [locating, setLocating] = useState<Locating>("idle");
  useEffect(() => setCanLocate(typeof navigator !== "undefined" && "geolocation" in navigator), []);

  const set = <K extends keyof SolarSettings>(field: K, value: SolarSettings[K]) => onChange({ ...settings, [field]: value });
  const errors = solarInputErrors(settings);
  const message = (field: "kwp" | "lossPercent" | "surplusPrice") =>
    errors[field] === "required" ? t(k("errors.required")) : errors[field] === "outOfRange" ? t(k(`solar.errors.${field}`)) : undefined;
  const coordinatesError = (field: "lat" | "lon") =>
    errors[field] === "required" ? t(k("errors.required")) : errors[field] === "outsideCoverage" ? t(k("solar.errors.coordinates")) : undefined;
  const district = SOLAR_DISTRICTS.find((each) => each.slug === settings.district) ?? SOLAR_DISTRICTS[0];
  const byCoordinates = settings.location === "coordinates";
  // The district whose optimal tilt an empty tilt field stands for.
  const tiltDistrict =
    byCoordinates && Number.isFinite(settings.lat) && Number.isFinite(settings.lon) ? nearestDistrict(settings.lat, settings.lon) : district;
  const fallback = production.state === "ready" && production.source.kind === "table" ? production.source : null;

  const locate = (exact: boolean) => {
    setLocating("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        onChange(
          exact
            ? { ...settings, lat: coordinate(latitude), lon: coordinate(longitude) }
            : { ...settings, district: nearestDistrict(latitude, longitude).slug },
        );
        setLocating("found");
      },
      () => setLocating("failed"),
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 15_000 },
    );
  };

  const setLocation = (location: SolarSettings["location"]) => {
    setLocating("idle");
    // Coordinates start from the chosen district capital's, for the visitor to change.
    onChange(
      location === "coordinates" && !(Number.isFinite(settings.lat) && Number.isFinite(settings.lon))
        ? { ...settings, location, lat: district.lat, lon: district.lon }
        : { ...settings, location },
    );
  };

  const locateStatus = (exact: boolean) =>
    locating === "locating"
      ? t(k("solar.locating"))
      : locating === "found"
        ? exact
          ? t(k("solar.locatedExact"))
          : t(k("solar.located"), { district: district.name })
        : locating === "failed"
          ? t(k(exact ? "solar.locateExactFailed" : "solar.locateFailed"))
          : null;

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
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">{t(k("solar.location"))}</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {(["district", "coordinates"] as const).map((location) => (
                  <label key={location} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="radio"
                      name="tariff-solar-location"
                      value={location}
                      checked={settings.location === location}
                      onChange={() => setLocation(location)}
                      className={radioClass}
                    />
                    <span>{t(k(location === "district" ? "solar.locationDistrict" : "solar.locationCoordinates"))}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {!byCoordinates ? (
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
                      onClick={() => locate(false)}
                      disabled={locating === "locating"}
                      className="text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80 disabled:opacity-60"
                    >
                      {t(k("solar.locate"))}
                    </button>
                    <p role="status" className="text-xs text-muted-foreground">
                      {locateStatus(false) ?? t(k("solar.locatePrivacy"))}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <CalculatorInput
                    id="tariff-solar-lat"
                    label={t(k("solar.latitude"))}
                    value={settings.lat}
                    onChange={(value) => set("lat", value)}
                    min={-90}
                    max={90}
                    step={0.0001}
                    suffix="°"
                    error={coordinatesError("lat")}
                  />
                  <CalculatorInput
                    id="tariff-solar-lon"
                    label={t(k("solar.longitude"))}
                    value={settings.lon}
                    onChange={(value) => set("lon", value)}
                    min={-180}
                    max={180}
                    step={0.0001}
                    suffix="°"
                    error={coordinatesError("lon")}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t(k("solar.coordinatesHelp"))}</p>
                {canLocate && (
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => locate(true)}
                      disabled={locating === "locating"}
                      className="text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80 disabled:opacity-60"
                    >
                      {t(k("solar.locateExact"))}
                    </button>
                    {locateStatus(true) && (
                      <p role="status" className="text-xs text-muted-foreground">
                        {locateStatus(true)}
                      </p>
                    )}
                  </div>
                )}
                <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-ink-2">{t(k("solar.coordinatesPrivacy"))}</p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <CalculatorInput
                id="tariff-solar-tilt"
                label={t(k("solar.tilt"))}
                value={settings.tilt}
                onChange={(value) => set("tilt", value)}
                min={SOLAR_QUERY_LIMITS.angle.min}
                max={SOLAR_QUERY_LIMITS.angle.max}
                step={1}
                suffix="°"
                helpText={t(k("solar.tiltHelp"), { district: tiltDistrict.name, slope: formatNumber(locale, tiltDistrict.slope, 0) })}
                error={errors.tilt ? t(k("solar.errors.tilt")) : undefined}
              />
              <div className="space-y-1.5">
                <label htmlFor="tariff-solar-orientation" className="block text-sm font-medium text-foreground">
                  {t(k("solar.orientation"))}
                </label>
                <select
                  id="tariff-solar-orientation"
                  value={settings.orientation}
                  onChange={(event) => {
                    const orientation = event.currentTarget.value as SolarSettings["orientation"];
                    // "Other" starts from the azimuth chosen until then.
                    onChange(
                      orientation === "custom" && settings.orientation !== "custom" && !Number.isFinite(settings.customAspect)
                        ? { ...settings, orientation, customAspect: SOLAR_ORIENTATIONS[settings.orientation] }
                        : { ...settings, orientation },
                    );
                  }}
                  className={selectClass}
                >
                  {ORIENTATION_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {t(k(`solar.orientations.${key}`))}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {settings.orientation === "custom" && (
              <CalculatorInput
                id="tariff-solar-azimuth"
                label={t(k("solar.azimuth"))}
                value={settings.customAspect}
                onChange={(value) => set("customAspect", value)}
                min={SOLAR_QUERY_LIMITS.aspect.min}
                max={SOLAR_QUERY_LIMITS.aspect.max}
                step={1}
                suffix="°"
                helpText={t(k("solar.azimuthHelp"))}
                error={errors.aspect === "required" ? t(k("errors.required")) : errors.aspect ? t(k("solar.errors.azimuth")) : undefined}
              />
            )}
            <p className="text-xs text-muted-foreground">{t(k("solar.liveHelp"))}</p>
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
                {t(k(production.live ? "solar.loadingLive" : "solar.loading"))}
              </p>
            )}
            {fallback?.fallback && (
              <div role="status" className="space-y-2 rounded-lg border border-warning-text/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
                <p>
                  {t(k(fallback.fallback === "unavailable" ? "solar.fallbackUnavailable" : "solar.fallbackFailed"), {
                    district: fallback.district.name,
                    slope: formatNumber(locale, fallback.district.slope, 0),
                  })}
                </p>
                {fallback.fallback === "failed" && onRetry && (
                  <button type="button" onClick={onRetry} className="text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80">
                    {t(k("solar.retry"))}
                  </button>
                )}
              </div>
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
  source,
  sortBy,
}: {
  result: SolarConsumption;
  saving: SolarBillSaving | null;
  settings: SolarSettings;
  /** Where the production comes from: what the system line and the source line describe. */
  source: SolarSource;
  sortBy: ComparisonSort;
}) {
  const { t, locale } = useTranslations();
  const year = yearlyBalance(result.balance, result.kwh.days);
  const shares = solarShares(year);
  const kwh = (value: number) => `${formatNumber(locale, value, 0)} kWh`;
  const euro = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const percent = (value: number) => formatPercent(locale, value * 100, { decimals: 0 });
  const price = surplusPriceOf(settings);
  const offerName = saving ? (saving.best.offer.regulated ? t(k("regulatedSupplier")) : supplierName(saving.best.offer.supplier)) : "";

  /** The system the production is for: the table's district, or what the route was asked. */
  function systemLine(from: SolarSource): string {
    const kwp = formatNumber(locale, settings.kwp, 1);
    if (from.kind === "table") {
      return t(k("solar.summary.system"), { kwp, district: from.district.name, slope: formatNumber(locale, from.district.slope, 0) });
    }
    const { params } = from.response;
    const place = from.district
      ? t(k("solar.summary.placeDistrict"), { district: from.district.name })
      : t(k("solar.summary.placeCoordinates"), { lat: formatNumber(locale, Math.abs(params.lat), 2), lon: formatNumber(locale, Math.abs(params.lon), 2) });
    const named = (Object.keys(SOLAR_ORIENTATIONS) as SolarOrientation[]).find((key) => SOLAR_ORIENTATIONS[key] === params.aspect);
    return named
      ? t(k("solar.summary.systemFacing"), { kwp, place, angle: formatNumber(locale, params.angle, 0), direction: t(k(`solar.directions.${named}`)) })
      : t(k("solar.summary.systemAzimuth"), { kwp, place, angle: formatNumber(locale, params.angle, 0), aspect: formatNumber(locale, params.aspect, 0) });
  }

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
        <p className="mt-1 text-sm text-ink-2">{systemLine(source)}</p>
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
        {source.kind === "table" && source.fallback && (
          <li>
            {t(k(source.fallback === "unavailable" ? "solar.fallbackUnavailable" : "solar.fallbackFailed"), {
              district: source.district.name,
              slope: formatNumber(locale, source.district.slope, 0),
            })}
          </li>
        )}
        <li>
          {source.kind === "table"
            ? t(k("solar.summary.source"), {
                version: SOLAR_PRODUCTION_SOURCE.version,
                database: SOLAR_PRODUCTION_SOURCE.radiationDb,
                from: String(SOLAR_PRODUCTION_SOURCE.yearMin),
                to: String(SOLAR_PRODUCTION_SOURCE.yearMax),
                date: formatIsoDate(locale, SOLAR_PRODUCTION_SOURCE.downloadedOn),
              })
            : t(k("solar.summary.sourceLive"), {
                version: source.response.source.version,
                database: source.response.source.radiationDb,
                from: String(source.response.source.yearMin),
                to: String(source.response.source.yearMax),
              })}{" "}
          <a href={SOLAR_PRODUCTION_SOURCE.url} rel="noopener" target="_blank" className={linkClass}>
            {t(k("solar.summary.sourceLink"))}
          </a>
        </li>
      </ul>
    </section>
  );
}
