export const SOURCES: Record<"damodaran" | "shiller", { name: string; url: string }>;
export const CHECK_TOLERANCE: number;

export interface YearEndRow {
  year: number;
  level: number;
  dividends?: number;
  published?: number;
}
export interface MonthlyCpiRow {
  date: number;
  cpi: number;
}
export interface YearReturn {
  year: number;
  price: number;
  total: number;
}
export interface AnnualRecord extends YearReturn {
  inflation: number;
}

export function deriveYearEndReturns(rows: readonly YearEndRow[]): YearReturn[];
export function deriveInflation(rows: readonly MonthlyCpiRow[]): Map<number, number>;
export function mergeYears(returns: readonly YearReturn[], inflation: Map<number, number>): AnnualRecord[];
export function renderModule(
  records: readonly AnnualRecord[],
  dates: { damodaranDownloadedOn: string; shillerDownloadedOn: string },
): string;
