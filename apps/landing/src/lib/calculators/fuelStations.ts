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
/** [station id, euro per litre, DGEG's update time]. */
type RawPrice = readonly [number, number, string];
type RawList = { count: number; median: number; top: ReadonlyArray<RawPrice> };
/**
 * One snapshot file: the stations it lists, per area ("" for the whole district) a list per fuel,
 * and in a district file every located station's price per fuel, cheapest first (`all`).
 */
export type StationAreaData = {
  stations: Readonly<Record<string, RawStation>>;
  areas: Readonly<Record<string, Partial<Record<FuelType, RawList>>>>;
  all?: Readonly<Partial<Record<FuelType, ReadonlyArray<RawPrice>>>>;
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
  /** Directions: a map search for the station's coordinates, or its label and address. */
  mapUrl: string;
  /** Coordinates, or null when DGEG's are missing or outside mainland Portugal. */
  lat: number | null;
  lon: number | null;
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

/**
 * The line under a station's label: its brand and municipality when the label is DGEG's name, else
 * the municipality, or nothing when the label (brand and locality) already ends with it.
 */
export function stationPlace(station: Pick<CheapStation, "name" | "brand" | "label" | "municipality">): string {
  if (station.name && station.brand) return `${station.brand} · ${station.municipality}`;
  return station.label.endsWith(station.municipality) ? "" : station.municipality;
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
  const stations = list.top.flatMap((price) => toCheapStation(data, price) ?? []);
  if (stations.length === 0) return null;
  return { count: list.count, median: list.median, stations };
}

function toCheapStation(data: StationAreaData, [id, price, updated]: RawPrice): CheapStation | null {
  const raw = data.stations[String(id)];
  if (!raw) return null;
  const [name, brand, street, locality, postcode, municipality, lat, lon] = raw;
  const label = stationLabel(name, brand, locality);
  const address = [street, locality, postcode].filter(Boolean).join(", ");
  return { id, name, label, brand, address, municipality, price, updated, mapUrl: stationMapUrl({ label, address, lat, lon }), lat, lon };
}

export type GeoPoint = { lat: number; lon: number };
/** [south, west, north, east], as the snapshot writes a district's box. */
export type GeoBounds = readonly [number, number, number, number];

/** The radii the near-me search offers, in kilometres. */
export const NEAR_RADII_KM = [5, 10, 25] as const;
export type NearRadius = (typeof NEAR_RADII_KM)[number];
/** How many stations the near-me list shows. */
export const NEAR_LIMIT = 10;

const EARTH_RADIUS_KM = 6371.0088;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle (haversine) distance between two points, in kilometres. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance from a point to the nearest point of a box: zero inside it. */
export function distanceToBoundsKm(point: GeoPoint, [south, west, north, east]: GeoBounds): number {
  const nearest = { lat: Math.min(north, Math.max(south, point.lat)), lon: Math.min(east, Math.max(west, point.lon)) };
  return distanceKm(point, nearest);
}

/** The districts with a station that can be within `radiusKm` of the point: the files to load. */
export function districtsNear(point: GeoPoint, radiusKm: number): string[] {
  return FUEL_STATION_DISTRICTS.filter((district) => distanceToBoundsKm(point, district.bounds) <= radiusKm).map(
    (district) => district.slug,
  );
}

export type NearStation = CheapStation & { distanceKm: number };
export type NearStationList = { count: number; median: number; stations: NearStation[] };

/**
 * The cheapest stations for a fuel within `radiusKm` of the point, from the loaded district files,
 * each with its distance; a tie in price goes to the nearer station. `count` and `median` cover
 * every station in reach. Computed in the browser: the point never leaves it.
 */
export function stationsNear(
  files: readonly StationAreaData[],
  point: GeoPoint,
  radiusKm: number,
  fuel: FuelType,
  limit: number = NEAR_LIMIT,
): NearStationList | null {
  const seen = new Set<number>();
  const inReach: NearStation[] = [];
  for (const data of files) {
    for (const price of data.all?.[fuel] ?? []) {
      if (seen.has(price[0])) continue;
      const raw = data.stations[String(price[0])];
      const lat = raw?.[6];
      const lon = raw?.[7];
      if (lat == null || lon == null) continue;
      const distance = distanceKm(point, { lat, lon });
      if (distance > radiusKm) continue;
      const station = toCheapStation(data, price);
      if (!station) continue;
      seen.add(price[0]);
      inReach.push({ ...station, distanceKm: distance });
    }
  }
  if (inReach.length === 0) return null;
  inReach.sort((a, b) => a.price - b.price || a.distanceKm - b.distanceKm || a.id - b.id);
  const prices = inReach.map((station) => station.price);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  return { count: inReach.length, median: Math.round(median * 1000) / 1000, stations: inReach.slice(0, limit) };
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
