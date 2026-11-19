export const SOURCE: { name: string; url: string; dataset: string; band: string; tax: string };
export const API_URL: string;

export interface ElectricityPriceRecord {
  period: string;
  pt: number;
  eu: number;
}

export function deriveRows(json: unknown): ElectricityPriceRecord[];
export function renderModule(
  rows: readonly ElectricityPriceRecord[],
  dates: { updatedOn: string; fetchedOn: string },
): string;
