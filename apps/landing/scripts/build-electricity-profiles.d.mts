export const SOURCE: { name: string; page: string; url: string; rules: string };
export const PROFILE_CLASSES: readonly ["A", "B", "C"];
export const SUM_TOLERANCE: number;

export interface ProfileDay {
  key: string;
  year: number;
  month: number;
  day: number;
  values: Record<"A" | "B" | "C", number[]>;
}

type Triple = [peak: number, shoulder: number, valley: number];

export interface ProfileAggregate {
  year: number;
  totals: Record<"A" | "B" | "C", number>;
  periods: Record<"A" | "B" | "C", Record<"current" | "2027", Record<"daily" | "weekly", Triple[]>>>;
}

export function deriveDays(rows: readonly (readonly unknown[])[]): ProfileDay[];
export function aggregate(days: readonly ProfileDay[]): ProfileAggregate;
export function renderModule(
  result: ProfileAggregate,
  meta: { downloadedOn: string; sha256: string; url?: string },
): string;
