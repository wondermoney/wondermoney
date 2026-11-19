export const SOURCE: { name: string; url: string; licenceUrl: string };
export const FIRST_MONTH: string;
export const MATURITIES: readonly string[];
export const AREAS: readonly string[];

export interface EcbRecord {
  REF_AREA: string;
  MATURITY_NOT_IRATE: string;
  TIME_PERIOD: string;
  OBS_VALUE: string;
  OBS_STATUS?: string;
}
export interface BuiltMonth {
  month: string;
  values: Array<number | null>;
}
export interface BuiltRates {
  months: BuiltMonth[];
  provisional: string[];
}

export function seriesUrl(): string[];
export function parseCsv(text: string): Array<Record<string, string>>;
export function buildRows(records: readonly EcbRecord[]): BuiltRates;
export function renderModule(built: BuiltRates, retrievedOn: string): string;
