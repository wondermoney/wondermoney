import {
  FUEL_STATIONS_NATIONAL,
  FUEL_STATIONS_SOURCE,
  FUEL_STATION_DISTRICTS,
} from "./data/fuelStations/index";
import type { FuelType } from "./fuelCost";

export { FUEL_STATIONS_SOURCE, FUEL_STATION_DISTRICTS };

/**
 * [name, brand, street, locality, postcode, municipality, latitude, longitude]: DGEG's fields,
 * copied as they are. Committed snapshots leave the name and the street out (null); only the
 * production build's own snapshot has them.
 */
type RawStation = readonly [
  string | null,
  string,
  string | null,
  string,
  string,
  string,
  number | null,
  number | null,
];
type RawList = { count: number; median: number; top: ReadonlyArray<readonly [number, number, string]> };
/** One snapshot file: the stations it lists and, per area ("" for the whole district), a list per fuel. */
export type StationAreaData = {
  stations: Readonly<Record<string, RawStation>>;
  areas: Readonly<Record<string, Partial<Record<FuelType, RawList>>>>;
};

export type CheapStation = {
  id: number;
  /** DGEG's station name, or null in a snapshot without names. */
  name: string | null;
  /** What the page calls the station: its name, or its brand and locality without one. */
  label: string;
  brand: string;
  /** Street (when known), locality and postcode. */
  address: string;
  municipality: string;
  /** Euro per litre. */
  price: number;
  /** DGEG's last update of this price, "2026-11-20 10:55", Lisbon time. */
  updated: string;
  mapUrl: string;
};
export type CheapStationList = {
  /** Stations with a price for this fuel in the area. */
  count: number;
  /** Their median price, euro per litre. */
  median: number;
  stations: CheapStation[];
};

/** A tank, for the saving the page shows. */
export const TANK_LITRES = 50;

const districtFiles = import.meta.glob<StationAreaData>("./data/fuelStations/*.json", { import: "default" });

export const NATIONAL_STATIONS: StationAreaData = FUEL_STATIONS_NATIONAL as unknown as StationAreaData;

export function isDistrictSlug(slug: string): boolean {
  return FUEL_STATION_DISTRICTS.some((district) => district.slug === slug);
}

/** Loads one district's lists; the page fetches the file from its own site, never from DGEG. */
export async function loadDistrict(slug: string): Promise<StationAreaData> {
  const load = districtFiles[`./data/fuelStations/${slug}.json`];
  if (!isDistrictSlug(slug) || !load) throw new Error(`No station data for ${slug}`);
  return load();
}

export function municipalitiesOf(slug: string): readonly string[] {
  return FUEL_STATION_DISTRICTS.find((district) => district.slug === slug)?.municipalities ?? [];
}

/** "GALP · Colmeias": the station's label when the snapshot has no name. */
export function stationLabel(name: string | null, brand: string, locality: string): string {
  return name ?? ([brand, locality].filter(Boolean).join(" · ") || locality);
}

/** A map search for the station: its coordinates, or its label and address without them. */
export function stationMapUrl(station: { label: string; address: string; lat: number | null; lon: number | null }): string {
  const query = station.lat !== null && station.lon !== null ? `${station.lat},${station.lon}` : `${station.label}, ${station.address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** The cheapest stations of one area for one fuel, or null when the area has none. */
export function cheapestStations(data: StationAreaData, area: string, fuel: FuelType): CheapStationList | null {
  const list = data.areas[area]?.[fuel];
  if (!list || list.top.length === 0) return null;
  const stations = list.top.flatMap(([id, price, updated]) => {
    const raw = data.stations[String(id)];
    if (!raw) return [];
    const [name, brand, street, locality, postcode, municipality, lat, lon] = raw;
    const label = stationLabel(name, brand, locality);
    const address = [street, locality, postcode].filter(Boolean).join(", ");
    return [{ id, name, label, brand, address, municipality, price, updated, mapUrl: stationMapUrl({ label, address, lat, lon }) }];
  });
  if (stations.length === 0) return null;
  return { count: list.count, median: list.median, stations };
}

export type StationSaving = {
  /** Median minus the cheapest price, euro per litre; zero when the cheapest is the median. */
  perLitre: number;
  /** The same on a full tank, to the cent. */
  perTank: number;
};

export function savingAgainstMedian(list: CheapStationList, litres: number = TANK_LITRES): StationSaving {
  const perLitre = Math.max(0, Math.round((list.median - list.stations[0].price) * 1000) / 1000);
  return { perLitre, perTank: Math.round(perLitre * litres * 100) / 100 };
}
