export const GOLD_SOURCE: { name: string; url: string };
export const FX_SOURCE: { name: string; url: string };
export const NBP_URL: string;
export const ECB_URL: string;
export const USER_AGENT: string;
export const DAYS: number;
export const MAX_AGE_DAYS: number;
export const RANGES: Record<"plnPerGram" | "plnPerEuro" | "eurPerGram", { min: number; max: number }>;
export const MAX_DAILY_MOVE: number;
export const TROY_OUNCE_GRAMS: number;
export const OUT_FILE: string;

export interface GoldRecord {
  date: string;
  plnPerGram: number;
  plnPerEuro: number;
  eurPerGram: number;
}

export function parseNbp(json: unknown): Map<string, number>;
export function parseEcbCsv(text: string): Map<string, number>;
export function deriveRows(
  prices: Map<string, number>,
  rates: Map<string, number>,
  options?: { fetchedOn?: string; days?: number },
): GoldRecord[];
export function renderModule(rows: readonly GoldRecord[], dates: { fetchedOn: string }): string;
export function fetchSources(options: {
  fetchImpl?: typeof fetch;
  fetchedOn: string;
}): Promise<{ prices: Map<string, number>; rates: Map<string, number> }>;
export function refresh(options?: { fetchImpl?: typeof fetch; fetchedOn?: string; out?: string }): Promise<GoldRecord[]>;
