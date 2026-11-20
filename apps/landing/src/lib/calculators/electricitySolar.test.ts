import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ELECTRICITY_PROFILE_PERIODS,
  HOURLY_CYCLES,
  PERIOD_SCHEDULES,
  legalMidnight,
  legalTimeOf,
  QUARTER_HOUR_MS,
  summarizeLoadDiagram,
  triHourlyPeriodAt,
  type LoadReading,
  type ProfileClass,
} from "./electricityPeriods";
import { DEFAULT_OFFER_FILTERS, MONTH_DAYS, runComparator, splitTotal, type ComparatorRequest } from "./electricityTariffComparator";
import { FIXTURE_OFFERS } from "./electricityTariffComparison.fixtures";
import {
  loadSolarDistrict,
  nearestDistrict,
  netWithSolar,
  productionKwhAt,
  profileReadings,
  profileShape,
  solarBillSaving,
  solarConsumption,
  solarErrors,
  solarShares,
  SOLAR_DISTRICTS,
  SOLAR_PRODUCTION_SOURCE,
  yearlyBalance,
  yearlyProductionKwh,
  type SolarSystem,
} from "./electricitySolar";
import { parsePvgisSeries, TYPICAL_YEAR_HOURS, typicalHourIndexOf } from "./solarPvgis";
import { YEARLY_RANGE } from "../../../scripts/build-solar-production.mjs";

// PVGIS's hourly output of 1 kWp in Lisbon on 21 June 2023 (35° south, 14 % losses), from the
// trimmed seriescalc fixture, placed on 21 June of an otherwise dark typical year.
const series = parsePvgisSeries(
  JSON.parse(readFileSync(new URL("../../../scripts/fixtures/pvgis/seriescalc-lisboa-2023-two-days.json", import.meta.url), "utf8")),
);
const JUNE_21 = new Float64Array(TYPICAL_YEAR_HOURS);
for (const hour of series.hours) if (hour.month === 6) JUNE_21[typicalHourIndexOf(6, 21, hour.hour)] = hour.watts;

const TWO_KWP: SolarSystem = { typicalYear: JUNE_21, kwp: 2, lossPercent: 14 };

/** 21 June 2026 (a Sunday), every quarter-hour 0,1 kWh: 0,4 kWh an hour, 9,6 kWh in the day. */
function flatDay(kwh = 0.1): LoadReading[] {
  const midnight = legalMidnight(2026, 6, 21);
  return Array.from({ length: 96 }, (_, q) => ({ start: midnight + q * QUARTER_HOUR_MS, kwh }));
}

describe("netting production against consumption", () => {
  it("nets a PVGIS fixture against a fixture load hour by hour", () => {
    // Hours from 07:00 to 13:00 UTC produce less than 0,4 kWh; 13:00 to 18:00 more; 18:00 and 19:00 less.
    expect(productionKwhAt(TWO_KWP, Date.UTC(2026, 5, 21, 12, 30))).toBeCloseTo(0.34474, 9);
    expect(productionKwhAt(TWO_KWP, Date.UTC(2026, 5, 21, 14))).toBeCloseTo(1.38458, 9);

    const { net, balance } = netWithSolar(flatDay(), TWO_KWP);
    expect(balance.consumption).toBeCloseTo(9.6, 9);
    expect(balance.production).toBeCloseTo(6.32996, 9);
    expect(balance.selfConsumed).toBeCloseTo(3.72518, 9);
    expect(balance.surplus).toBeCloseTo(2.60478, 9);
    expect(balance.net).toBeCloseTo(5.87482, 9);
    expect(balance.selfConsumed + balance.surplus).toBeCloseTo(balance.production, 9);
    expect(balance.selfConsumed + balance.net).toBeCloseTo(balance.consumption, 9);

    expect(net).toHaveLength(96);
    expect(Math.min(...net.map((reading) => reading.kwh))).toBe(0);
    // 12:00 UTC: 0,4 kWh used, 0,34474 produced; each quarter-hour keeps a quarter of the rest.
    const noon = net.filter((reading) => reading.start >= Date.UTC(2026, 5, 21, 12) && reading.start < Date.UTC(2026, 5, 21, 13));
    for (const reading of noon) expect(reading.kwh).toBeCloseTo((0.4 - 0.34474) / 4, 9);
    // 14:00 UTC: all taken from the panels.
    expect(net.find((reading) => reading.start === Date.UTC(2026, 5, 21, 14, 15))?.kwh).toBe(0);
    expect(net.reduce((sum, reading) => sum + reading.kwh, 0)).toBeCloseTo(balance.net, 9);
  });

  it("splits the net hours across the tariff periods at their quarter-hour boundaries", () => {
    const { kwh, balance, fromDiagram, readings } = solarConsumption({
      consumption: summarizeLoadDiagram(flatDay()),
      readings: flatDay(),
      contractedPower: 3.45,
      cycle: "daily",
      system: TWO_KWP,
    });
    expect(fromDiagram).toBe(true);
    // The netted quarter-hours, for indexed offers priced on the metered hours.
    expect(readings).toEqual(netWithSolar(flatDay(), TWO_KWP).net);
    expect(kwh.days).toBe(1);
    expect(kwh.simple.energy).toBeCloseTo(balance.net, 9);
    // Daily cycle in summer: peak 10:30-13:00 and 19:30-21:00, legal time (UTC+1). Half of 09:00 UTC,
    // 10:00, 11:00, half of 18:00 and 19:00 UTC, net of the panels.
    const peak = (0.4 - 0.16918) / 2 + (0.4 - 0.3181) + (0.4 - 0.30196) + (0.4 - 0.16776) / 2 + (0.4 - 0.0486);
    expect(kwh.daily.triHourly.peak).toBeCloseTo(peak, 9);
    expect(kwh.daily.biHourly.offValley + kwh.daily.biHourly.valley).toBeCloseTo(balance.net, 9);
    // A Sunday is all valley in the weekly cycle.
    expect(kwh.weekly.triHourly.valley).toBeCloseTo(balance.net, 9);
  });

  it("scales production by the kWp and the losses, and by the quarter-hours an hour has readings for", () => {
    const at = Date.UTC(2026, 5, 21, 14);
    expect(productionKwhAt({ ...TWO_KWP, kwp: 3, lossPercent: 20 }, at)).toBeCloseTo(0.69229 * 3 * (80 / 86), 9);
    const half = flatDay().filter((reading) => reading.start !== at && reading.start !== at + QUARTER_HOUR_MS);
    const { balance } = netWithSolar(half, TWO_KWP);
    expect(balance.production).toBeCloseTo(6.32996 - 1.38458 / 2, 9);
  });

  it("never leaves less than nothing from the grid, however large the system", () => {
    const { net, balance } = netWithSolar(flatDay(), { ...TWO_KWP, kwp: 50 });
    expect(net.every((reading) => reading.kwh >= 0)).toBe(true);
    expect(balance.net).toBeCloseTo(9.6 - balance.selfConsumed, 9);
    expect(solarShares(balance).coverage).toBeLessThan(1);
  });

  it("reports the self-consumed share of production and the share of consumption covered", () => {
    const { balance } = netWithSolar(flatDay(), TWO_KWP);
    expect(solarShares(balance).selfConsumed).toBeCloseTo(3.72518 / 6.32996, 9);
    expect(solarShares(balance).coverage).toBeCloseTo(3.72518 / 9.6, 9);
    expect(solarShares({ consumption: 0, production: 0, selfConsumed: 0, surplus: 0, net: 0 })).toEqual({ selfConsumed: 0, coverage: 0 });
    expect(yearlyBalance(balance, 1).surplus).toBeCloseTo(2.60478 * 365, 6);
  });
});

describe("consumption rebuilt from the BTN profile", () => {
  // The table holds 7 significant digits, so the four splits agree to about 1e-4 permille.
  it.each(["A", "B", "C"] as ProfileClass[])("reproduces every split of profile %s in every month", (profile) => {
    const shape = profileShape(profile);
    expect(shape).toHaveLength(35_040);
    expect(shape.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1000, 3);
    const start = legalMidnight(2026, 1, 1);
    for (const schedule of PERIOD_SCHEDULES) {
      for (const cycle of HOURLY_CYCLES) {
        const sums = Array.from({ length: 12 }, () => [0, 0, 0]);
        shape.forEach((weight, q) => {
          const instant = start + q * QUARTER_HOUR_MS;
          const month = legalTimeOf(instant).month - 1;
          sums[month][["peak", "shoulder", "valley"].indexOf(triHourlyPeriodAt(instant, cycle, schedule))] += weight;
        });
        sums.forEach((month, m) =>
          month.forEach((value, p) => expect(value, `${schedule} ${cycle} ${m + 1} ${p}`).toBeCloseTo(ELECTRICITY_PROFILE_PERIODS[profile][schedule][cycle][m][p], 3)),
        );
      }
    }
  });

  it("scales the profile year to the entered kWh and the entered split of the visitor's cycle", () => {
    const tri = { days: 30, simple: { energy: 200 }, daily: { biHourly: { offValley: 140, valley: 60 }, triHourly: { peak: 40, shoulder: 100, valley: 60 } } };
    const year = profileReadings({ ...tri, weekly: tri.daily }, 3.45, "daily");
    expect(year).toHaveLength(35_040);
    const sum = (period?: string) =>
      year.filter((reading) => !period || triHourlyPeriodAt(reading.start, "daily") === period).reduce((total, reading) => total + reading.kwh, 0);
    expect(sum()).toBeCloseTo((200 * 365) / 30, 6);
    expect(sum("peak")).toBeCloseTo((40 * 365) / 30, 6);
    expect(sum("valley")).toBeCloseTo((60 * 365) / 30, 6);
  });

  it("gives the comparator a grid consumption over the same days, below the consumption without solar", async () => {
    const lisboa = await loadSolarDistrict("lisboa");
    const gross = splitTotal(250, MONTH_DAYS, 3.45);
    const result = solarConsumption({ consumption: gross, readings: null, contractedPower: 3.45, cycle: "daily", system: { typicalYear: lisboa, kwp: 2, lossPercent: 14 } });
    expect(result.fromDiagram).toBe(false);
    expect(result.readings).toBeNull();
    expect(result.kwh.days).toBe(MONTH_DAYS);
    expect(result.balance.consumption).toBeCloseTo(250, 6);
    expect(result.kwh.simple.energy).toBeCloseTo(result.balance.net, 6);
    expect(result.kwh.simple.energy).toBeLessThan(250);
    // A month of a 2 kWp system: a twelfth of its typical year.
    expect(result.balance.production).toBeCloseTo((yearlyProductionKwh({ typicalYear: lisboa, kwp: 2, lossPercent: 14 }) * MONTH_DAYS) / 365, 6);
    const { peak, shoulder, valley } = result.kwh.daily.triHourly;
    expect(peak + shoulder + valley).toBeCloseTo(result.kwh.simple.energy, 6);
    // The panels work in the day: valley (night) consumption drops least.
    expect(valley / gross.daily.triHourly.valley).toBeGreaterThan(shoulder / gross.daily.triHourly.shoulder);
  });
});

describe("the bill saving and the ranking", () => {
  const REQUEST: ComparatorRequest = {
    offers: FIXTURE_OFFERS,
    consumption: splitTotal(250, MONTH_DAYS, 3.45),
    contractedPower: 3.45,
    cycle: "daily",
    option: "simple",
    socialTariff: false,
    largeFamily: false,
    newClient: false,
    includeRefunds: true,
    includeConditioned: true,
    includeDual: false,
    cheapestPerSupplier: false,
    sortBy: "firstYear",
    filters: DEFAULT_OFFER_FILTERS,
    myTariff: null,
  };

  it("ranks on the grid consumption and prices the best offer without solar for the saving", async () => {
    const lisboa = await loadSolarDistrict("lisboa");
    const solar = solarConsumption({ consumption: REQUEST.consumption, readings: null, contractedPower: 3.45, cycle: "daily", system: { typicalYear: lisboa, kwp: 2, lossPercent: 14 } });
    const request = { ...REQUEST, consumption: solar.kwh };
    const outcome = runComparator(request);
    if (!outcome.ok) throw new Error("unexpected errors");
    const saving = solarBillSaving(request, outcome.view, REQUEST.consumption);
    expect(saving).not.toBeNull();
    const without = runComparator({ ...REQUEST, offers: [outcome.view.results[0].offer] });
    if (!without.ok) throw new Error("unexpected errors");
    expect(saving?.best.offer.id).toBe(outcome.view.results[0].offer.id);
    expect(saving?.withSolar).toBe(outcome.view.results[0].firstYear.total);
    expect(saving?.withoutSolar).toBe(without.view.results[0].firstYear.total);
    expect(saving?.saving).toBeGreaterThan(0);
    expect(outcome.view.annualKwh).toBeCloseTo((solar.kwh.simple.energy * 365) / MONTH_DAYS, 6);
  });

  it("has no saving to show when no offer is left", () => {
    const empty = runComparator({ ...REQUEST, offers: [] });
    if (!empty.ok) throw new Error("unexpected errors");
    expect(solarBillSaving({ ...REQUEST, offers: [] }, empty.view, REQUEST.consumption)).toBeNull();
  });
});

describe("inputs and districts", () => {
  it("checks the kWp, the losses and the optional sale price", () => {
    expect(solarErrors({ kwp: 2, lossPercent: 14, surplusPrice: null })).toEqual({});
    expect(solarErrors({ kwp: 0, lossPercent: 14, surplusPrice: 0.05 })).toEqual({ kwp: "outOfRange" });
    expect(solarErrors({ kwp: Number.NaN, lossPercent: 60, surplusPrice: 2 })).toEqual({ kwp: "required", lossPercent: "outOfRange", surplusPrice: "outOfRange" });
  });

  it("picks the nearest district capital", () => {
    expect(nearestDistrict(38.7223, -9.1393).slug).toBe("lisboa");
    expect(nearestDistrict(41.18, -8.69).slug).toBe("porto");
    expect(nearestDistrict(37.1, -8.67).slug).toBe("faro");
  });

  it("commits a typical year for each of the 18 mainland district capitals, cited to PVGIS", async () => {
    expect(SOLAR_PRODUCTION_SOURCE).toMatchObject({ version: "5.3", radiationDb: "PVGIS-SARAH3", meteoDb: "ERA5" });
    expect(SOLAR_DISTRICTS).toHaveLength(18);
    const files = readdirSync(new URL("./data/solarProduction/", import.meta.url)).filter((name) => name.endsWith(".json"));
    expect(files.sort()).toEqual(SOLAR_DISTRICTS.map((district) => `${district.slug}.json`).sort());
    for (const district of SOLAR_DISTRICTS) {
      const year = await loadSolarDistrict(district.slug);
      const kwh = yearlyProductionKwh({ typicalYear: year, kwp: 1, lossPercent: 14 });
      expect(kwh, district.slug).toBeCloseTo(district.yearlyKwhPerKwp, -1);
      expect(kwh).toBeGreaterThan(YEARLY_RANGE.min);
      expect(kwh).toBeLessThan(YEARLY_RANGE.max);
      expect(district.slope).toBeGreaterThanOrEqual(30);
      expect(district.slope).toBeLessThanOrEqual(40);
      // Nothing at night: midnight UTC on 21 June and 21 December.
      expect(year[typicalHourIndexOf(6, 21, 0)]).toBe(0);
      expect(year[typicalHourIndexOf(12, 21, 0)]).toBe(0);
    }
    await expect(loadSolarDistrict("madeira")).rejects.toThrow(/No solar data/);
  });
});
