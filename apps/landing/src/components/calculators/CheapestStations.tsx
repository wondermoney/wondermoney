import { useEffect, useRef, useState } from "react";
import { FUEL_TYPES, type FuelType } from "@/lib/calculators/fuelCost";
import {
  FUEL_STATIONS_SOURCE,
  FUEL_STATION_DISTRICTS,
  NATIONAL_STATIONS,
  TANK_LITRES,
  cheapestStations,
  loadDistrict,
  municipalitiesOf,
  savingAgainstMedian,
  type StationAreaData,
} from "@/lib/calculators/fuelStations";
import { snapshotAgeDays } from "@/lib/calculators/snapshotAge";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import { formatMoney, formatNumber } from "@/lib/numberFormat";
import { useTranslations } from "@/lib/reactTranslations";
import { toLocalizedPath } from "@/lib/routes";
import { Select } from "@/components/ui/select";

const k = (key: string) => `tools.fuelPrices.stations.${key}`;
/** A snapshot older than this when the visitor looks at it means the daily refresh stopped. */
const STALE_AFTER_DAYS = 2;

type District = { status: "idle" } | { status: "loading" } | { status: "ready"; data: StationAreaData } | { status: "error" };

/**
 * The cheapest stations by fuel, district and municipality, from the snapshot committed with the
 * site. A district's list is a file of this site, loaded when the visitor picks the district; the
 * page sends nothing about the visitor anywhere.
 */
export default function CheapestStations() {
  const { t, locale } = useTranslations();
  const [fuel, setFuel] = useState<FuelType>("diesel");
  const [districtSlug, setDistrictSlug] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [district, setDistrict] = useState<District>({ status: "idle" });
  const [ageDays, setAgeDays] = useState(0);
  const usageSent = useRef(false);

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

  const used = () => {
    if (usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the fuel, the district or the municipality.
    pushGtmEvent({ event: "tool_used", tool: "fuel_stations", page_type: getPageType() });
  };

  const districtName = FUEL_STATION_DISTRICTS.find((item) => item.slug === districtSlug)?.name ?? "";
  const areaName = municipality || districtName || t(k("mainland"));
  const data = districtSlug ? (district.status === "ready" ? district.data : null) : NATIONAL_STATIONS;
  const list = data ? cheapestStations(data, municipality, fuel) : null;
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

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="stations-fuel" className="block text-sm font-medium text-foreground">
            {t(k("fuel"))}
          </label>
          <Select
            id="stations-fuel"
            value={fuel}
            onChange={(event) => {
              used();
              setFuel(event.currentTarget.value as FuelType);
            }}
          >
            {FUEL_TYPES.map((item) => (
              <option key={item} value={item}>
                {t(`tools.fuelPrices.fuels.${item}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="stations-district" className="block text-sm font-medium text-foreground">
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
        <div className="space-y-1.5">
          <label htmlFor="stations-municipality" className="block text-sm font-medium text-foreground">
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

      <div aria-live="polite" className="space-y-4">
        {district.status === "loading" && <p className="text-sm text-muted-foreground">{t(k("loading"), { district: districtName })}</p>}
        {district.status === "error" && <p className="text-sm text-destructive-text">{t(k("loadError"))}</p>}
        {data && !list && (
          <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("none"), { area: areaName, fuel: fuelName })}</p>
        )}
        {list && saving && (
          <>
            <p className="text-sm text-foreground">
              {t(k("summary"), {
                count: formatNumber(locale, list.count),
                fuel: fuelName,
                area: areaName,
                median: `${euro(list.median)}/L`,
              })}
            </p>
            <ol className="divide-y divide-border-2 rounded-card border border-border bg-background">
              {list.stations.map((station, index) => (
                <li key={station.id} className="space-y-1 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <p className="min-w-0 font-medium text-foreground">
                      <span className="mr-2 font-mono text-muted-foreground" aria-hidden="true">
                        {index + 1}
                      </span>
                      {station.label}
                    </p>
                    <p className={`shrink-0 font-mono text-xl font-semibold ${index === 0 ? "text-primary" : "text-foreground"}`}>
                      {euro(station.price)}/L
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {station.name && station.brand ? `${station.brand} · ${station.municipality}` : station.municipality}
                  </p>
                  <p className="text-sm text-ink-2">{station.address}</p>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <a href={station.mapUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                      {t(k("map"))}
                      <span className="sr-only">: {station.label}</span>
                    </a>
                    <p className="text-xs text-muted-foreground">{t(k("updated"), { date: station.updated })}</p>
                  </div>
                </li>
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
