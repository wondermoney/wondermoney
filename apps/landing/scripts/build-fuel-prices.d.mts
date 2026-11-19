export const SOURCE: { name: string; url: string };
export const API_URL: string;
export const FUELS: ReadonlyArray<{ column: "diesel" | "gasoline95" | "lpg"; id: number; label: string }>;
export const WEEKS: number;
export const MAX_AGE_DAYS: number;
export const PRICE_RANGE: { min: number; max: number };

export interface DgegRow {
  Data: string;
  TipoCombustivel: string;
  PrecoMedio: string;
}
export interface FuelPriceRecord {
  date: string;
  diesel: number;
  gasoline95: number;
  lpg: number;
}

export function parsePrice(text: string): number;
export function deriveRows(
  apiRows: readonly DgegRow[],
  options?: { fetchedOn?: string; weeks?: number },
): FuelPriceRecord[];
export function renderModule(rows: readonly FuelPriceRecord[], dates: { fetchedOn: string }): string;
export function fetchRows(today: string): Promise<DgegRow[]>;
