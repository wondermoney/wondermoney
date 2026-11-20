export const SOURCE: {
  omie: { name: string; page: string; file: (key: string) => string };
  profiles: { name: string; page: string };
  ren: { page: string; file: (year: string | number) => string };
};
export const MONTHS: number;
export const PRICE_RANGE: { min: number; max: number };
export const MONTH_MEAN_RANGE: { min: number; max: number };

type Bucket = [weight: number, omie: number, omieLoss: number, loss: number, mean: number, quarters: number];

export interface AggregatedMonth {
  month: string;
  quarters: number;
  mean: number;
  daily: Bucket[];
  weekly: Bucket[];
}

export function omieDayStart(year: number, month: number, day: number): number;
export function parseOmieDay(text: string, year: number, month: number, day: number): { start: number; prices: number[] };
export function deriveLossDays(rows: readonly (readonly unknown[])[], header: string): Map<string, number[]>;
export function cumulativeLossDays(levels: Record<"BT" | "MT" | "AT" | "AT/RNT", Map<string, number[]>>): Map<string, number[]>;
export function byInstant<T>(days: Map<string, T>, valueOf: (values: T) => number[]): Map<number, number>;
export function monthsEndingWith(to: string, count: number): string[];
export function aggregateMonths(
  months: readonly string[],
  maps: { prices: Map<number, number>; profile: Map<number, number>; losses: Map<number, number> },
): AggregatedMonth[];
export function renderModule(
  months: readonly AggregatedMonth[],
  meta: { files: Record<string, Record<string, string>>; fetchedOn: string; jsonPath: string },
): string;
export function renderQuarterHours(
  months: readonly string[],
  maps: { prices: Map<number, number>; losses: Map<number, number>; profile: Map<number, number> },
): string;
export function eredesLinks(html: string): { consumption: Record<string, string>; losses: Record<string, string> };
