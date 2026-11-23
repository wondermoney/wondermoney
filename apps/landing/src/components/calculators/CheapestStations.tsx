import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Clock, LoaderCircle, LocateFixed, Map as MapIcon, MapPin, Navigation, X } from "lucide-react";
import { FUEL_TYPES, type FuelType } from "@/lib/calculators/fuelCost";
import {
  FUEL_STATIONS_SOURCE,
  FUEL_STATION_DISTRICTS,
  NATIONAL_STATIONS,
  NEAR_RADII_KM,
  TANK_LITRES,
  cheapestStations,
  districtsNear,
  loadDistrict,
  municipalitiesOf,
  savingAgainstMedian,
  stationPlace,
  stationsNear,
  type CheapStation,
  type CheapStationList,
  type GeoPoint,
  type NearRadius,
  type NearStation,
  type StationAreaData,
} from "@/lib/calculators/fuelStations";
import { snapshotAgeDays } from "@/lib/calculators/snapshotAge";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import { formatMoney, formatNumber } from "@/lib/numberFormat";
import { useTranslations } from "@/lib/reactTranslations";
import { toLocalizedPath } from "@/lib/routes";
import { Select } from "@/components/ui/select";
import { FUEL_COLOR_CLASSES } from "./fuelColors";

// MapLibre and its tiles load only when the visitor opens the map.
const StationsMap = lazy(() => import("./StationsMap"));

const k = (key: string) => `tools.fuelPrices.stations.${key}`;
/** A snapshot older than this when the visitor looks at it means the daily refresh stopped. */
const STALE_AFTER_DAYS = 2;
/** The near-me search loads the districts the widest radius reaches, so a narrower one needs no new file. */
const WIDEST_RADIUS = Math.max(...NEAR_RADII_KM);
const GEOLOCATION_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 };

type Files<T> = { status: "idle" } | { status: "loading" } | { status: "ready"; data: T } | { status: "error" };
type NearFailure = "denied" | "timeout" | "unsupported" | "locationError";
type Near =
  | { status: "off" }
  | { status: "locating" }
  | { status: "failed"; reason: NearFailure }
  | { status: "on"; point: GeoPoint };

const controlClass =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const idleControl = "border-input bg-background text-foreground hover:bg-paper-2";

/**
 * The cheapest stations by fuel, near the visitor or by district and municipality, from the
 * snapshot committed with the site. District files are this site's own, loaded on demand. The
 * near-me search asks the browser for the position only when the visitor taps it, measures the
 * distances in the page and sends the position nowhere: not in analytics, not in a URL.
 */
export default function CheapestStations() {
  const { t, locale } = useTranslations();
  const [fuel, setFuel] = useState<FuelType>("diesel");
  const [districtSlug, setDistrictSlug] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [district, setDistrict] = useState<Files<StationAreaData>>({ status: "idle" });
  const [near, setNear] = useState<Near>({ status: "off" });
  const [radius, setRadius] = useState<NearRadius>(10);
  const [nearFiles, setNearFiles] = useState<Files<StationAreaData[]>>({ status: "idle" });
  const [showMap, setShowMap] = useState(false);
  const [ageDays, setAgeDays] = useState(0);
  const usageSent = useRef(false);
  const locateRequest = useRef(0);

  // Measured on the visitor's clock after hydration, so the prerendered page never shows it.
  useEffect(() => setAgeDays(snapshotAgeDays(FUEL_STATIONS_SOURCE.fetchedAt)), []);

  useEffect(() => {
    if (!districtSlug) {
      setDistrict({ status: "idle" });
      return;
    }
    let current = true;
    setDistrict({ status: "loading" });
    loadDistrict(districtSlug)
      .then((data) => current && setDistrict({ status: "ready", data }))
      .catch(() => current && setDistrict({ status: "error" }));
    return () => {
      current = false;
    };
  }, [districtSlug]);

  const point = near.status === "on" ? near.point : null;
  useEffect(() => {
    if (!point) {
      setNearFiles({ status: "idle" });
      return;
    }
    let current = true;
    setNearFiles({ status: "loading" });
    Promise.all(districtsNear(point, WIDEST_RADIUS).map(loadDistrict))
      .then((data) => current && setNearFiles({ status: "ready", data }))
      .catch(() => current && setNearFiles({ status: "error" }));
    return () => {
      current = false;
    };
  }, [point]);

  const used = () => {
    if (usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the fuel, the area, the radius or the position.
    pushGtmEvent({ event: "tool_used", tool: "fuel_stations", page_type: getPageType() });
  };

  const locate = () => {
    used();
    const request = ++locateRequest.current;
    const settle = (next: Near) => request === locateRequest.current && setNear(next);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      settle({ status: "failed", reason: "unsupported" });
      return;
    }
    setNear({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => settle({ status: "on", point: { lat: position.coords.latitude, lon: position.coords.longitude } }),
      (error) =>
        settle({
          status: "failed",
          reason: error.code === error.PERMISSION_DENIED ? "denied" : error.code === error.TIMEOUT ? "timeout" : "locationError",
        }),
      GEOLOCATION_OPTIONS,
    );
  };
  const clearNear = () => {
    locateRequest.current++;
    setNear({ status: "off" });
  };

  const districtName = FUEL_STATION_DISTRICTS.find((item) => item.slug === districtSlug)?.name ?? "";
  const areaName = municipality || districtName || t(k("mainland"));
  const nearOn = near.status === "on";
  const pickerData = districtSlug ? (district.status === "ready" ? district.data : null) : NATIONAL_STATIONS;
  const nearList = nearOn && nearFiles.status === "ready" && point ? stationsNear(nearFiles.data, point, radius, fuel) : null;
  const list: CheapStationList | null = nearOn ? nearList : pickerData ? cheapestStations(pickerData, municipality, fuel) : null;
  const loaded = nearOn ? nearFiles.status === "ready" : Boolean(pickerData);
  const saving = list ? savingAgainstMedian(list) : null;
  const euro = (value: number, decimals = 3) => formatMoney(locale, value, { decimals });
  const fuelName = t(`tools.fuelPrices.fuels.${fuel}`);
  const fetchedAt = FUEL_STATIONS_SOURCE.fetchedAt;
  const linkClass =
    "text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <section className="mb-10 space-y-5" aria-labelledby="fuel-stations-title">
      <div className="space-y-2">
        <h2 id="fuel-stations-title" className="text-2xl font-semibold tracking-tight text-foreground">
          {t(k("title"))}
        </h2>
        <p className="max-w-3xl leading-7 text-ink-2">{t(k("intro"))}</p>
        <p className="font-medium text-foreground">
          {t(k("asOf"), { date: fetchedAt.slice(0, 10), time: fetchedAt.slice(11, 16) })}
        </p>
        {ageDays > STALE_AFTER_DAYS && (
          <p role="status" className="rounded-lg border border-warning-text/30 px-4 py-3 text-sm text-foreground">
            {t(k("stale"), { days: formatNumber(locale, ageDays), date: fetchedAt.slice(0, 10) })}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <div role="group" aria-label={t(k("fuel"))} className="flex flex-wrap gap-2">
          {FUEL_TYPES.map((item) => {
            const colors = FUEL_COLOR_CLASSES[item];
            const selected = item === fuel;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={selected}
                title={t(`tools.fuelPrices.fuels.${item}`)}
                onClick={() => {
                  used();
                  setFuel(item);
                }}
                className={`${controlClass} gap-1.5 px-2.5 ${selected ? `${colors.fill} border-transparent text-white` : idleControl}`}
              >
                <span aria-hidden="true" className={`size-2 rounded-full ${selected ? "bg-white" : colors.fill}`} />
                {t(`tools.fuelPrices.fuelsShort.${item}`)}
              </button>
            );
          })}
        </div>

        <div className="flex items-start gap-2">
          <button
            type="button"
            aria-pressed={nearOn}
            aria-label={t(k("nearMe"))}
            title={t(k("nearMe"))}
            onClick={locate}
            disabled={near.status === "locating"}
            className={`${controlClass} w-10 ${nearOn ? "border-primary bg-primary/10 text-primary" : idleControl}`}
          >
            {near.status === "locating" ? (
              <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
            ) : (
              <LocateFixed aria-hidden="true" className="size-4" />
            )}
          </button>
          {nearOn ? (
            <>
              <div role="group" aria-label={t(k("radius"))} className="flex min-w-0 flex-1 gap-2 sm:flex-none">
                {NEAR_RADII_KM.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={radius === value}
                    onClick={() => setRadius(value)}
                    className={`${controlClass} flex-1 px-3 font-mono sm:flex-none ${
                      radius === value ? "border-primary bg-primary/10 text-primary" : idleControl
                    }`}
                  >
                    {formatNumber(locale, value)} km
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label={t(k("nearClear"))}
                title={t(k("nearClear"))}
                onClick={clearNear}
                className={`${controlClass} w-10 ${idleControl}`}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </>
          ) : (
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="stations-district" className="sr-only">
                  {t(k("district"))}
                </label>
                <Select
                  id="stations-district"
                  value={districtSlug}
                  onChange={(event) => {
                    used();
                    setDistrictSlug(event.currentTarget.value);
                    setMunicipality("");
                  }}
                >
                  <option value="">{t(k("mainland"))}</option>
                  {FUEL_STATION_DISTRICTS.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="min-w-0">
                <label htmlFor="stations-municipality" className="sr-only">
                  {t(k("municipality"))}
                </label>
                <Select
                  id="stations-municipality"
                  value={municipality}
                  disabled={!districtSlug}
                  onChange={(event) => {
                    used();
                    setMunicipality(event.currentTarget.value);
                  }}
                >
                  <option value="">{districtSlug ? t(k("allMunicipalities"), { district: districtName }) : t(k("pickDistrict"))}</option>
                  {municipalitiesOf(districtSlug).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div aria-live="polite" className="space-y-4">
          {near.status === "locating" && <p className="text-sm text-muted-foreground">{t(k("locating"))}</p>}
          {near.status === "failed" && (
            <p role="status" className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
              {t(k(near.reason))}
            </p>
          )}
          {nearOn && nearFiles.status === "loading" && <p className="text-sm text-muted-foreground">{t(k("nearLoading"))}</p>}
          {!nearOn && district.status === "loading" && (
            <p className="text-sm text-muted-foreground">{t(k("loading"), { district: districtName })}</p>
          )}
          {((nearOn && nearFiles.status === "error") || (!nearOn && district.status === "error")) && (
            <p className="text-sm text-destructive-text">{t(k("loadError"))}</p>
          )}
          {loaded && !list && (
            <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
              {nearOn ? t(k("nearNone"), { fuel: fuelName, radius: formatNumber(locale, radius) }) : t(k("none"), { area: areaName, fuel: fuelName })}
            </p>
          )}
          {list && (
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-foreground">
                {nearOn
                  ? t(k("nearSummary"), {
                      count: formatNumber(locale, list.count),
                      fuel: fuelName,
                      radius: formatNumber(locale, radius),
                      median: `${euro(list.median)}/L`,
                    })
                  : t(k("summary"), {
                      count: formatNumber(locale, list.count),
                      fuel: fuelName,
                      area: areaName,
                      median: `${euro(list.median)}/L`,
                    })}
              </p>
              <button
                type="button"
                aria-pressed={showMap}
                onClick={() => setShowMap((value) => !value)}
                className={`${controlClass} px-3 ${showMap ? "border-primary bg-primary/10 text-primary" : idleControl}`}
              >
                <MapIcon aria-hidden="true" className="size-4" />
                {t(k("mapShow"))}
              </button>
            </div>
          )}
        </div>
        {list && saving && (
          <>
            {showMap && (
              <Suspense
                fallback={
                  <div className="grid h-80 place-items-center rounded-card border border-border bg-paper-2 text-sm text-muted-foreground sm:h-96">
                    {t(k("mapLoading"))}
                  </div>
                }
              >
                <StationsMap stations={list.stations} fuel={fuel} origin={point} />
              </Suspense>
            )}
            <ol className="divide-y divide-border-2 rounded-card border border-border bg-background">
              {list.stations.map((station, index) => (
                <StationRow key={station.id} station={station} index={index} fuel={fuel} euro={euro} />
              ))}
            </ol>
            <div className="space-y-2 rounded-lg bg-paper-2 px-4 py-3">
              <p className="text-sm text-foreground">
                {saving.perLitre > 0
                  ? t(k("saving"), {
                      perLitre: `${euro(saving.perLitre)}/L`,
                      perTank: euro(saving.perTank, 2),
                      litres: TANK_LITRES,
                    })
                  : t(k("noSaving"))}
              </p>
              <a
                href={toLocalizedPath("featureGoals", locale)}
                onClick={() => pushGtmEvent({ event: "cta_click", cta_position: "tool_result", page_type: getPageType() })}
                className={linkClass}
              >
                {t(k("nextStepCta"))}
              </a>
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground">{t(k("note"))}</p>
      </div>
    </section>
  );
}

function StationRow({
  station,
  index,
  fuel,
  euro,
}: {
  station: CheapStation | NearStation;
  index: number;
  fuel: FuelType;
  euro: (value: number, decimals?: number) => string;
}) {
  const { t, locale } = useTranslations();
  const colors = FUEL_COLOR_CLASSES[fuel];
  const cheapest = index === 0;
  const place = stationPlace(station);
  const distance = "distanceKm" in station ? `${formatNumber(locale, station.distanceKm, station.distanceKm < 10 ? 1 : 0)} km` : null;

  return (
    <li className="flex items-center gap-3 p-3 sm:p-4">
      <p className={`min-w-[6.25rem] shrink-0 rounded-md px-2 py-1.5 text-center ${cheapest ? `${colors.fill} text-white` : colors.tint}`}>
        <span className={`block text-xs font-medium leading-4 ${cheapest ? "" : colors.text}`}>
          {t(`tools.fuelPrices.fuelsShort.${fuel}`)}
        </span>
        <span className={`block whitespace-nowrap font-mono text-base font-semibold leading-6 ${cheapest ? "" : "text-foreground"}`}>
          {euro(station.price)}/L
        </span>
      </p>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium text-foreground [overflow-wrap:anywhere]">
          <span className="sr-only">{index + 1}. </span>
          {station.label}
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          {distance && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-foreground">
              <MapPin aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <span className="sr-only">{t(k("distanceLabel"))}: </span>
              {distance}
            </span>
          )}
          {place && <span>{place}</span>}
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Clock aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t(k("updated"), { date: station.updated })}</span>
            <span aria-hidden="true" className="font-mono text-xs">
              {station.updated}
            </span>
          </span>
        </p>
        {station.name && <p className="text-sm text-ink-2">{station.address}</p>}
      </div>
      <a
        href={station.mapUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${t(k("map"))}: ${station.label}`}
        title={t(k("map"))}
        className={`${controlClass} w-10 ${idleControl}`}
      >
        <Navigation aria-hidden="true" className="size-4" />
      </a>
    </li>
  );
}
