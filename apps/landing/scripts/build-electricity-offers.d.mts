import type { ElectricityOffer } from "../src/lib/calculators/electricityOfferTypes";

export const SOURCE: { name: string; url: string };
export const SETTINGS_URL: string;
export const CONDITIONS_FILE: string;
export const PRICES_FILE: string;
export const POWERS_KVA: readonly number[];
export const PRICE_LIMITS: { energyPerKwh: number; powerPerDay: number };
export const MIN_OFFERS: number;
export const MULTI_OPTION_FILTERS: Record<"FiltroContratacao" | "Filtrofaturacao" | "FiltroPagamento" | "FiltroAtendimento", string[]>;
export const YES_NO_FILTERS: readonly string[];
export const CONDITIONS_COLUMNS: readonly string[];
export const PRICES_COLUMNS: readonly string[];

export interface ExportSource {
  exportFile: string;
  exportedOn: string;
  fetchedOn: string;
}

export function readZip(buffer: Uint8Array): Map<string, { data: Buffer; modifiedOn: string }>;
export function parseCsv(text: string, label?: string): { header: string[]; rows: Record<string, string>[] };
export function parseNumber(text: string | undefined, what?: string): number | undefined;
export function parseDate(text: string | undefined, what?: string): string | null;
export function decodeOptions(column: string, code: string): string[];
export function decodeYesNo(column: string, code: string): boolean;
export function normalizeLink(text: string | undefined): string | undefined;
export function deriveOffers(
  csv: { conditions: string; prices: string },
  options: { date: string; minOffers?: number },
): ElectricityOffer[];
export function exportDate(fileName: string, files: Map<string, { modifiedOn: string }>): string;
export function readExport(
  zip: Uint8Array,
  options: { exportFile: string; date: string; minOffers?: number },
): { offers: ElectricityOffer[]; source: ExportSource };
export function renderModule(offers: readonly ElectricityOffer[], source: ExportSource): string;
export function exportUrl(settings: unknown): URL;
