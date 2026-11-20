import { describe, expect, it } from "vitest";
import {
  aggregateMonths,
  byInstant,
  cumulativeLossDays,
  deriveLossDays,
  eredesLinks,
  monthsEndingWith,
  omieDayStart,
  parseOmieDay,
  renderModule,
  renderQuarterHours,
} from "../../../scripts/build-omie-prices.mjs";
import { legalMidnight, QUARTER_HOUR_MS, quartersInLegalDay, triHourlyPeriodAt } from "./electricityCycles";

/** An OMIE daily file: `count` periods, the Portuguese price first and the Spanish one second. */
function omieFile(date: [number, number, number], count: number, price: (period: number) => [number, number]) {
  const [y, m, d] = date;
  const pad = (v: number) => String(v).padStart(2, "0");
  const rows = Array.from({ length: count }, (_, i) => {
    const [pt, es] = price(i + 1);
    return `${y};${pad(m)};${pad(d)};${i + 1};${pt};${es};`;
  });
  return ["MARGINALPDBCPT;", ...rows, "*", ""].join("\r\n");
}

describe("build-omie-prices: OMIE files", () => {
  it("starts OMIE's day at 00:00 Spanish time, 23:00 the day before in Lisbon, winter and summer", () => {
    expect(new Date(omieDayStart(2026, 1, 15)).toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(new Date(omieDayStart(2026, 7, 15)).toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });

  it("reads the Portuguese price, the first of the two (10 April 2026, period 31: 87,17 PT, 91,6 ES)", () => {
    const text = omieFile([2026, 4, 10], 96, (p) => (p === 31 ? [87.17, 91.6] : [50, 50]));
    const day = parseOmieDay(text, 2026, 4, 10);
    expect(day.prices).toHaveLength(96);
    expect(day.prices[30]).toBe(87.17);
    expect(day.start).toBe(omieDayStart(2026, 4, 10));
  });

  it("gives an hourly file's price to each of the hour's four quarter-hours", () => {
    const day = parseOmieDay(omieFile([2025, 9, 30], 24, (p) => [p, p]), 2025, 9, 30);
    expect(day.prices).toHaveLength(96);
    expect(day.prices.slice(0, 5)).toEqual([1, 1, 1, 1, 2]);
  });

  it("expects 92 and 100 quarter-hours on the clock-change days", () => {
    expect(parseOmieDay(omieFile([2026, 3, 29], 92, () => [1, 1]), 2026, 3, 29).prices).toHaveLength(92);
    expect(parseOmieDay(omieFile([2026, 10, 25], 100, () => [1, 1]), 2026, 10, 25).prices).toHaveLength(100);
    expect(() => parseOmieDay(omieFile([2026, 10, 25], 96, () => [1, 1]), 2026, 10, 25)).toThrow(/100/);
  });

  it("rejects another file, another day or a missing price", () => {
    expect(() => parseOmieDay("<html></html>", 2026, 1, 1)).toThrow(/not an OMIE/);
    expect(() => parseOmieDay(omieFile([2026, 1, 2], 96, () => [1, 1]), 2026, 1, 1)).toThrow(/unexpected row/);
    expect(() => parseOmieDay(omieFile([2026, 1, 1], 96, (p) => [p === 5 ? Number.NaN : 1, 1]), 2026, 1, 1)).toThrow(/bad price/);
  });
});

describe("build-omie-prices: loss profiles", () => {
  // The header rows of E-REDES's Perfis_Perdas_E-REDES_2026.xlsx and REN's AT/RNT file, shortened.
  const day = (serial: number, count: number, values: number[]) =>
    Array.from({ length: count }, () => [serial, 5, "", ...values]);
  const EXCEL_2026_01_01 = 46023;
  const distribution = [
    ["Data", "Dia", "Hora", "Perfis de Perdas Simples"],
    [null, null, null, "BT", "MT", "AT"],
    ...day(EXCEL_2026_01_01, 96, [0.08, 0.035, 0.012]),
  ];
  const transmission = [
    ["Data", "Dia", "Hora", "Perfis de perdas"],
    [null, null, null, "AT/RNT", "MAT"],
    ...day(EXCEL_2026_01_01, 96, [0.0228, 0.0175]),
  ];

  it("reads a column by its header, a day at a time", () => {
    const bt = deriveLossDays(distribution, "BT");
    expect([...bt.keys()]).toEqual(["2026-01-01"]);
    expect(bt.get("2026-01-01")).toHaveLength(96);
    expect(deriveLossDays(transmission, "AT/RNT").get("2026-01-01")![0]).toBe(0.0228);
    expect(() => deriveLossDays(distribution, "AT/RNT")).toThrow(/no "AT\/RNT" column/);
    expect(() => deriveLossDays([...distribution.slice(0, 50)], "BT")).toThrow(/quarter-hours/);
  });

  it("multiplies the four levels into a low-voltage consumer's factor", () => {
    const levels = {
      BT: deriveLossDays(distribution, "BT"),
      MT: deriveLossDays(distribution, "MT"),
      AT: deriveLossDays(distribution, "AT"),
      "AT/RNT": deriveLossDays(transmission, "AT/RNT"),
    };
    const factor = cumulativeLossDays(levels).get("2026-01-01")![0];
    expect(factor).toBeCloseTo(1.08 * 1.035 * 1.012 * 1.0228, 12);
  });
});

describe("build-omie-prices: aggregation", () => {
  it("lists the full months that end with the given one", () => {
    expect(monthsEndingWith("2026-10", 13)).toEqual([
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04",
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
  });

  it("weights each period's prices by the profile and keeps its plain mean", () => {
    // February 2026, every quarter-hour: price 100 in peak hours and 50 otherwise, profile weight
    // 2 in peak hours and 1 otherwise, loss factor 1,1.
    const days = new Map<string, number[]>();
    for (let d = 1; d <= 28; d++) days.set(`2026-02-${String(d).padStart(2, "0")}`, Array(quartersInLegalDay(2026, 2, d)).fill(0));
    const instants = [...byInstant(days, (v) => v).keys()];
    const isPeak = (t: number) => triHourlyPeriodAt(t, "daily") === "peak";
    const prices = new Map(instants.map((t) => [t, isPeak(t) ? 100 : 50]));
    const profile = new Map(instants.map((t) => [t, isPeak(t) ? 2 : 1]));
    const losses = new Map(instants.map((t) => [t, 1.1]));
    const [month] = aggregateMonths(["2026-02"], { prices, profile, losses });
    expect(month.quarters).toBe(28 * 96);
    const [peak, shoulder] = month.daily;
    const peakQuarters = instants.filter(isPeak).length;
    expect(peak).toEqual([2 * peakQuarters, 100, expect.closeTo(110, 9), expect.closeTo(1.1, 12), 100, peakQuarters]);
    expect(shoulder[1]).toBe(50);
    expect(month.mean).toBeCloseTo((100 * peakQuarters + 50 * (28 * 96 - peakQuarters)) / (28 * 96), 9);
    expect(() => aggregateMonths(["2026-03"], { prices, profile, losses })).toThrow(/no OMIE price/);

    const module = renderModule([month], { files: {}, fetchedOn: "2026-11-20", jsonPath: "/data/x.json" });
    expect(module).toContain('month: "2026-02", quarters: 2688');
    expect(module).toContain('fetchedOn: "2026-11-20"');

    const json = JSON.parse(renderQuarterHours(["2026-02"], { prices, losses }));
    expect(json.start).toBe(new Date(legalMidnight(2026, 2, 1)).toISOString());
    expect(json.omie).toHaveLength(28 * 96);
    expect(json.loss[0]).toBe(10000);
    expect(Date.parse(json.start) + json.omie.length * QUARTER_HOUR_MS).toBe(legalMidnight(2026, 3, 1));
  });
});

describe("build-omie-prices: E-REDES links", () => {
  it("finds each year's consumption and loss spreadsheets, also behind the Office viewer", () => {
    const html = `
      <a href="https://www.e-redes.pt/sites/eredes/files/2024-12/Perfil_Consumo_Inje%C3%A7%C3%A3o_E-REDES_2025.xlsx">x</a>
      <a href="https://view.officeapps.live.com/op/view.aspx?src=https%3A%2F%2Fwww.e-redes.pt%2Fsites%2Feredes%2Ffiles%2F2025-12%2FPerfis_Perdas_E-REDES_2026..xlsx&amp;wdOrigin=BROWSELINK">y</a>
      <a href="https://www.e-redes.pt/sites/eredes/files/2025-12/GMLDD_2025.pdf">z</a>`;
    const links = eredesLinks(html);
    expect(links.consumption["2025"]).toBe("https://www.e-redes.pt/sites/eredes/files/2024-12/Perfil_Consumo_Inje%C3%A7%C3%A3o_E-REDES_2025.xlsx");
    expect(links.losses["2026"]).toBe("https://www.e-redes.pt/sites/eredes/files/2025-12/Perfis_Perdas_E-REDES_2026..xlsx");
    expect(Object.keys(links.consumption)).toEqual(["2025"]);
  });
});
