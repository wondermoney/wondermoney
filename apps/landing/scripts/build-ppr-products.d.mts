import type { PprGuarantee, PprKind, PprProduct, PprReturns } from "../src/lib/calculators/pprTypes";

export const USER_AGENT: string;
export const CMVM_BASE: string;
export const CMVM_LIST_URL: string;
export const ASF_PLATFORM_URL: string;
export const ASF_API: string;
export const OUTSYSTEMS_ANONYMOUS_CSRF: string;
export const ASF_TYPES: Record<string, Exclude<PprKind, "fund">>;
export const CMVM_FUND_TYPES: Record<string, string>;
export const ASF_GUARANTEES: Record<string, PprGuarantee>;
export const MIN_ROWS: Record<"cmvm" | "insuranceGuaranteed" | "insuranceLinked" | "pensionFund", number>;
export const CMVM_EXPORT_HEADER: readonly string[];
export const CMVM_MAX_AGE_DAYS: number;

export function parsePercent(value: unknown, field: string, bounds?: { min?: number; max?: number }): number | null;
export function parseRiskClass(value: unknown, field: string): number | null;
export function splitCmvmName(raw: string): { name: string; shortName: string; shareClass: string | null };
export function parseGuarantee(value: unknown, field: string): PprGuarantee | null;
export function dropPlaceholderZeros(returns: PprReturns): PprReturns;
export function managersFromExport(rows: unknown[][]): Map<string, string>;
export function buildCmvmProducts(
  list: ReadonlyArray<Record<string, unknown>>,
  managers: Map<string, string>,
  ifiLinks: Map<number, string>,
): PprProduct[];
export function buildAsfProducts(rows: ReadonlyArray<Record<string, unknown>>, kind: Exclude<PprKind, "fund">): PprProduct[];
export function cmvmReturnsYear(updatedOn: string): number;
export function asfReturnsYear(fetchedOn: string): number;
export function checkProducts(products: readonly PprProduct[], lists: readonly (keyof typeof MIN_ROWS)[]): Record<keyof typeof MIN_ROWS, number>;
export function sortProducts(products: readonly PprProduct[]): PprProduct[];
export function renderFundsModule(input: { products: readonly PprProduct[]; updatedOn: string; fetchedOn: string }): string;
export function renderInsuranceModule(input: { products: readonly PprProduct[]; fetchedOn: string }): string;
export function apiVersion(script: string, service: string): string;
export function readAsfDir(dir: string): PprProduct[];
export function refreshFunds(input: { fetchedOn: string; out: string }): Promise<{ count: number; updatedOn: string }>;
export function refreshInsurance(input: { dir: string; fetchedOn: string; out: string }): { count: number };
