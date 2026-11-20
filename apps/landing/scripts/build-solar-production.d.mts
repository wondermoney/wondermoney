export const USER_AGENT: string;
export const DISTRICTS: ReadonlyArray<{ slug: string; name: string; lat: number; lon: number }>;
export const MAX_YEARLY_GAP: number;
export const YEARLY_RANGE: { min: number; max: number };

type District = { slug: string; name: string; lat: number; lon: number };

export interface DistrictResult {
  meta: {
    slug: string;
    name: string;
    lat: number;
    lon: number;
    slope: number;
    yearlyKwhPerKwp: number;
    pvgisAverageKwhPerKwp: number;
    monthsSelected: number[];
  };
  meteo: { radiationDb: string; meteoDb: string; yearMin: number; yearMax: number };
  days: number[][];
}

export function pvcalcUrl(district: District): string;
export function tmyUrl(district: District): string;
export function seriesUrl(district: District, slope: number, year: number): string;
export function buildDistrict(district: District, get: (url: string) => Promise<unknown>): Promise<DistrictResult>;
export function renderDistrictJson(days: readonly (readonly number[])[]): string;
export function renderIndex(results: readonly DistrictResult[], meta: { downloadedOn: string }): string;
