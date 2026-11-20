import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDistrict,
  DISTRICTS,
  pvcalcUrl,
  renderDistrictJson,
  renderIndex,
  seriesUrl,
  tmyUrl,
} from "../../../scripts/build-solar-production.mjs";
import { decodeTypicalYear } from "./solarPvgis";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../scripts/fixtures/pvgis/${name}`, import.meta.url), "utf8"));

/** The parts of a seriescalc response the test rewrites. */
interface SeriesResponse {
  inputs: { meteo_data: { year_min: number; year_max: number }; mounting_system: { fixed: { slope: { value: number } } } };
  outputs: { hourly: { time: string; P: number }[] };
}

const LISBOA = DISTRICTS.find((district) => district.slug === "lisboa")!;
const PVCALC = fixture("pvcalc-lisboa-optimal.json");
const TMY = fixture("tmy-lisboa-trimmed.json");
const SERIES = fixture("seriescalc-lisboa-2023-two-days.json") as SeriesResponse;

/**
 * A seriescalc response for `year` in the fixture's shape, at `slope`, every hour from 08:00 to
 * 17:00 UTC worth `watts` W, so the typical year comes to 365 × 10 × watts Wh.
 */
function seriesFor(year: number, slope: number, watts: number) {
  const response = structuredClone(SERIES);
  response.inputs.meteo_data.year_min = year;
  response.inputs.meteo_data.year_max = year;
  response.inputs.mounting_system.fixed.slope.value = slope;
  const hourly = [];
  for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 3_600_000) {
    const date = new Date(t);
    const stamp = `${year}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}:${String(date.getUTCHours()).padStart(2, "0")}10`;
    hourly.push({ time: stamp, P: date.getUTCHours() >= 8 && date.getUTCHours() < 18 ? watts : 0 });
  }
  response.outputs.hourly = hourly;
  return response;
}

function api(watts: number, slope = 33) {
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url);
    if (url === pvcalcUrl(LISBOA)) return PVCALC;
    if (url === tmyUrl(LISBOA)) return TMY;
    const year = Number(new URL(url).searchParams.get("startyear"));
    if (url === seriesUrl(LISBOA, 33, year)) return seriesFor(year, slope, watts);
    throw new Error(`unexpected ${url}`);
  };
  return { get, calls };
}

describe("build-solar-production", () => {
  it("lists the 18 mainland district capitals once each", () => {
    expect(DISTRICTS).toHaveLength(18);
    expect(new Set(DISTRICTS.map((district) => district.slug)).size).toBe(18);
    for (const district of DISTRICTS) {
      expect(district.lat).toBeGreaterThan(36.9);
      expect(district.lat).toBeLessThan(42.2);
      expect(district.lon).toBeGreaterThan(-9.6);
      expect(district.lon).toBeLessThan(-6.1);
    }
  });

  it("asks PVGIS 5.3 for the optimal tilt facing south, the TMY months and each selected year's hours", () => {
    expect(pvcalcUrl(LISBOA)).toBe(
      "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?lat=38.7223&lon=-9.1393&outputformat=json&peakpower=1&loss=14&optimalinclination=1&aspect=0",
    );
    expect(seriesUrl(LISBOA, 33, 2019)).toBe(
      "https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?lat=38.7223&lon=-9.1393&outputformat=json&peakpower=1&loss=14&angle=33&aspect=0&pvcalculation=1&startyear=2019&endyear=2019",
    );
  });

  it("builds a district's typical year from the years PVGIS selected", async () => {
    const { get, calls } = api(432);
    const result = await buildDistrict(LISBOA, get);
    // 2008, 2010, 2012, 2016, 2019, 2020, 2021, 2022 and 2023: one call each, plus PVcalc and tmy.
    expect(calls).toHaveLength(11);
    expect(result.meta).toMatchObject({ slug: "lisboa", slope: 33, yearlyKwhPerKwp: 1577, pvgisAverageKwhPerKwp: 1578 });
    expect(result.meta.monthsSelected).toEqual([2021, 2023, 2023, 2012, 2016, 2022, 2019, 2019, 2012, 2020, 2008, 2010]);
    expect(result.meteo).toEqual({ radiationDb: "PVGIS-SARAH3", meteoDb: "ERA5", yearMin: 2005, yearMax: 2023 });
    expect(result.days[0]).toEqual([8, 432, 432, 432, 432, 432, 432, 432, 432, 432, 432]);
    const json = renderDistrictJson(result.days);
    expect(decodeTypicalYear(JSON.parse(json).days).reduce((sum, value) => sum + value, 0)).toBe(365 * 10 * 432);
    const index = renderIndex([result], { downloadedOn: "2026-11-20" });
    expect(index).toContain('radiationDb: "PVGIS-SARAH3"');
    expect(index).toContain('version: "5.3"');
    expect(index).toContain('downloadedOn: "2026-11-20"');
  });

  it("refuses a typical year far from PVGIS's average, or a series for another tilt", async () => {
    await expect(buildDistrict(LISBOA, api(250).get)).rejects.toThrow(/implausible|off PVGIS/);
    await expect(buildDistrict(LISBOA, api(350).get)).rejects.toThrow(/off PVGIS's average/);
    await expect(buildDistrict(LISBOA, api(432, 35).get)).rejects.toThrow(/another system/);
  });
});
