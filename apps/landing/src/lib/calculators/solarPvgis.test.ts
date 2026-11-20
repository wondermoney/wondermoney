import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeTypicalYear,
  encodeTypicalYear,
  parsePvgisPvcalc,
  parsePvgisSeries,
  parsePvgisTmyMonths,
  PvgisResponseError,
  TYPICAL_YEAR_HOURS,
  typicalHourIndex,
  typicalHourIndexOf,
  typicalYear,
  type PvgisSeries,
} from "./solarPvgis";

// Responses of the PVGIS 5.3 API for Lisbon, 20 November 2026, trimmed: seriescalc for 2023 with
// pvcalculation=1, 1 kWp, 14 % losses, 35° facing south, kept to 1 January and 21 June; tmy with two
// of its hours; PVcalc with optimalinclination=1.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../scripts/fixtures/pvgis/${name}`, import.meta.url), "utf8")) as unknown;

describe("PVGIS responses", () => {
  it("reads a seriescalc response: the system, the database and each hour's power in UTC", () => {
    const series = parsePvgisSeries(fixture("seriescalc-lisboa-2023-two-days.json"));
    expect(series).toMatchObject({
      radiationDb: "PVGIS-SARAH3",
      meteoDb: "ERA5",
      yearMin: 2023,
      yearMax: 2023,
      slope: 35,
      azimuth: 0,
      peakPowerKw: 1,
      lossPercent: 14,
      latitude: 38.722,
    });
    expect(series.hours).toHaveLength(48);
    expect(series.hours[0]).toEqual({ year: 2023, month: 1, day: 1, hour: 0, watts: 0 });
    // "20230621:1210": the hour from 12:00 UTC.
    expect(series.hours.find((hour) => hour.month === 6 && hour.hour === 12)).toEqual({ year: 2023, month: 6, day: 21, hour: 12, watts: 172.37 });
  });

  it("refuses a response without PV power or with a bad time", () => {
    const series = fixture("seriescalc-lisboa-2023-two-days.json") as { outputs: { hourly: Record<string, unknown>[] } };
    const withoutPower = structuredClone(series);
    delete withoutPower.outputs.hourly[3].P;
    expect(() => parsePvgisSeries(withoutPower)).toThrow(PvgisResponseError);
    const badTime = structuredClone(series);
    badTime.outputs.hourly[0].time = "2023-01-01 00:10";
    expect(() => parsePvgisSeries(badTime)).toThrow(/Bad time/);
    expect(() => parsePvgisSeries({ message: "Location over the sea" })).toThrow(PvgisResponseError);
  });

  it("reads the year PVGIS picked for each month of its typical meteorological year", () => {
    const { meteo, months } = parsePvgisTmyMonths(fixture("tmy-lisboa-trimmed.json"));
    expect(meteo).toEqual({ radiationDb: "PVGIS-SARAH3", meteoDb: "ERA5", yearMin: 2005, yearMax: 2023 });
    expect(months.map((month) => month.year)).toEqual([2021, 2023, 2023, 2012, 2016, 2022, 2019, 2019, 2012, 2020, 2008, 2010]);
  });

  it("reads PVcalc's optimal tilt and yearly production", () => {
    expect(parsePvgisPvcalc(fixture("pvcalc-lisboa-optimal.json"))).toMatchObject({ slope: 33, azimuth: 0, yearlyKwh: 1578.35, radiationDb: "PVGIS-SARAH3" });
  });
});

/** A series of `year` where every hour is worth `watts(month, day, hour)`. */
function syntheticSeries(year: number, watts: (month: number, day: number, hour: number) => number): PvgisSeries {
  const hours = [];
  for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 3_600_000) {
    const date = new Date(t);
    const [month, day, hour] = [date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours()];
    hours.push({ year, month, day, hour, watts: watts(month, day, hour) });
  }
  return {
    radiationDb: "PVGIS-SARAH3",
    meteoDb: "ERA5",
    yearMin: year,
    yearMax: year,
    latitude: 38.7,
    longitude: -9.1,
    slope: 33,
    azimuth: 0,
    peakPowerKw: 1,
    lossPercent: 14,
    hours,
  };
}

describe("typical year", () => {
  it("indexes 365 days of 24 UTC hours, reading 29 February as the 28th", () => {
    expect(typicalHourIndexOf(1, 1, 0)).toBe(0);
    expect(typicalHourIndexOf(12, 31, 23)).toBe(TYPICAL_YEAR_HOURS - 1);
    expect(typicalHourIndexOf(3, 1, 0)).toBe(59 * 24);
    expect(typicalHourIndexOf(2, 29, 10)).toBe(typicalHourIndexOf(2, 28, 10));
    expect(typicalHourIndex(Date.UTC(2026, 5, 21, 12, 45))).toBe(typicalHourIndexOf(6, 21, 12));
    expect(typicalHourIndex(Date.UTC(2028, 1, 29, 13))).toBe(typicalHourIndexOf(2, 28, 13));
  });

  it("takes each month from its selected year and leaves out 29 February", () => {
    const series = new Map([
      [2020, syntheticSeries(2020, (month, day) => (month === 2 && day === 29 ? 999 : 2020))],
      [2021, syntheticSeries(2021, () => 2021)],
    ]);
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: i % 2 === 0 ? 2021 : 2020 }));
    const year = typicalYear(series, months);
    expect(year).toHaveLength(TYPICAL_YEAR_HOURS);
    expect(year[typicalHourIndexOf(1, 15, 12)]).toBe(2021);
    expect(year[typicalHourIndexOf(2, 28, 12)]).toBe(2020);
    expect(year).not.toContain(999);
    expect(() => typicalYear(new Map([[2021, syntheticSeries(2021, () => 1)]]), months)).toThrow(/No series for 2020/);
  });

  it("encodes each day from its first to its last hour of production, and decodes it back", () => {
    const year = typicalYear(new Map([[2023, syntheticSeries(2023, (month, _day, hour) => (month === 12 ? 0 : hour >= 7 && hour <= 18 ? hour * 10.4 : 0))]]), Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 2023 })));
    const days = encodeTypicalYear(year);
    expect(days).toHaveLength(365);
    expect(days[0]).toEqual([7, 73, 83, 94, 104, 114, 125, 135, 146, 156, 166, 177, 187]);
    expect(days[364]).toEqual([0]);
    const decoded = decodeTypicalYear(days);
    expect(decoded[7]).toBe(73);
    expect(decoded[6]).toBe(0);
    expect(decoded[364 * 24 + 12]).toBe(0);
    expect(() => decodeTypicalYear(days.slice(1))).toThrow(RangeError);
    expect(() => decodeTypicalYear([[20, 1, 2, 3, 4, 5], ...days.slice(1)])).toThrow(/Bad day 0/);
  });
});
