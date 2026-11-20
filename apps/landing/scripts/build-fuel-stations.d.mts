export const SOURCE: { name: string; url: string };
export const API_URL: string;
export const USER_AGENT: string;
export const FUELS: ReadonlyArray<{ key: "diesel" | "gasoline95" | "lpg"; id: number; label: string }>;
export const DISTRICTS: ReadonlyArray<{ slug: string; name: string }>;
export const TOP: { national: number; district: number; municipality: number };
export const PAGE_SIZE: number;
export const MIN_ROWS: { diesel: number; gasoline95: number; lpg: number };
export const MIN_MUNICIPALITIES: number;
export const PRICE_RANGE: { min: number; max: number };
export const MEDIAN_BAND: { below: number; above: number };
export const MAX_DROPPED_SHARE: number;
export const MAX_FEED_AGE_DAYS: number;
export const MAX_PRICE_AGE_DAYS: number;
export const DATA_DIR: string;

export interface DgegStationRow {
  Id: number;
  Nome: string;
  TipoPosto?: string;
  Municipio: string;
  Preco: string;
  Marca: string;
  Combustivel: string;
  DataAtualizacao: string;
  Distrito: string;
  Morada: string;
  Localidade: string;
  CodPostal: string;
  Latitude: number;
  Longitude: number;
  Quantidade?: number;
}
/** [name, brand, street, locality, postcode, municipality, latitude, longitude]; name and street are null when redacted. */
export type SnapshotStation = [string | null, string, string | null, string, string, string, number | null, number | null];
export interface SnapshotList {
  count: number;
  median: number;
  /** [station id, euro per litre, DGEG's update time] */
  top: Array<[number, number, string]>;
}
export interface SnapshotArea {
  stations: Record<string, SnapshotStation>;
  areas: Record<string, Partial<Record<"diesel" | "gasoline95" | "lpg", SnapshotList>>>;
}
export interface FuelStationSnapshot {
  fetchedAt: string;
  newestUpdate: string;
  counts: Record<"diesel" | "gasoline95" | "lpg", number>;
  dropped: number;
  redacted: boolean;
  national: SnapshotArea;
  districts: Array<{ slug: string; name: string; municipalities: string[]; data: SnapshotArea }>;
}

export function parsePrice(text: string): number;
export function deriveSnapshot(
  apiRows: readonly DgegStationRow[],
  options: { fetchedAt: string; redact?: boolean },
): FuelStationSnapshot;
export function renderIndex(snapshot: FuelStationSnapshot): string;
export function renderDistrict(data: SnapshotArea): string;
export function fetchRows(options?: { fetchImpl?: typeof fetch }): Promise<DgegStationRow[]>;
export function writeSnapshot(snapshot: FuelStationSnapshot, dir?: string): void;
export function refresh(options?: {
  fetchImpl?: typeof fetch;
  fetchedAt?: string;
  dir?: string;
  redact?: boolean;
}): Promise<FuelStationSnapshot>;
