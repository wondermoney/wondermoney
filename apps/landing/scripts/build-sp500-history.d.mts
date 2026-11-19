export const SOURCE: { name: string; url: string };

export interface MonthlyRow {
  date: number;
  price: number;
  dividend?: number;
  cpi: number;
}

export interface AnnualRecord {
  year: number;
  price: number;
  total: number;
  inflation: number;
}

export function deriveAnnualReturns(rows: readonly MonthlyRow[]): AnnualRecord[];
export function renderModule(
  records: readonly AnnualRecord[],
  dates: { downloadedOn: string; savedOn: string },
): string;
