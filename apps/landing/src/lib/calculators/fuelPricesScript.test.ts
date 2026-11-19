import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FUEL_PRICES, FUEL_PRICES_SOURCE } from "./data/fuelPrices";
import { MAX_AGE_DAYS, deriveRows, parsePrice, renderModule } from "../../../scripts/build-fuel-prices.mjs";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** DGEG-shaped rows for `days` days ending on `last`, for the three fuels. */
function apiRows(last: string, days: number, override: (date: string, fuel: string) => string | null = () => null) {
  const end = Date.parse(`${last}T00:00:00Z`);
  const labels = { "Gasóleo simples": 1.5, "Gasolina simples 95": 1.7, "GPL Auto": 0.9 };
  const rows = [];
  for (let i = 0; i < days; i++) {
    const date = iso(end - i * DAY);
    for (const [label, base] of Object.entries(labels)) {
      const price = override(date, label) ?? `${(base + i * 0.001).toFixed(3).replace(".", ",")} €`;
      if (price !== "skip") rows.push({ Data: date, TipoCombustivel: label, PrecoMedio: price });
    }
  }
  // An unrelated fuel is ignored.
  rows.push({ Data: last, TipoCombustivel: "Gasolina 98", PrecoMedio: "1,999 €" });
  return rows;
}

describe("build-fuel-prices", () => {
  it("reads DGEG's comma prices", () => {
    expect(parsePrice("1,018 €")).toBe(1.018);
    expect(() => parsePrice("n/d")).toThrow(/Unreadable/);
  });

  it("samples the newest day and every seventh day before it, oldest first", () => {
    const rows = deriveRows(apiRows("2026-11-18", 40), { fetchedOn: "2026-11-19", weeks: 4 });
    expect(rows.map((row) => row.date)).toEqual(["2026-10-21", "2026-10-28", "2026-11-04", "2026-11-11", "2026-11-18"]);
    expect(rows.at(-1)).toEqual({ date: "2026-11-18", diesel: 1.5, gasoline95: 1.7, lpg: 0.9 });
    expect(rows[3].diesel).toBe(1.507);
  });

  it("uses the newest day on which all three fuels have a price", () => {
    const rows = deriveRows(
      apiRows("2026-11-18", 40, (date, fuel) => (date === "2026-11-18" && fuel === "GPL Auto" ? "skip" : null)),
      { fetchedOn: "2026-11-19", weeks: 2 },
    );
    expect(rows.at(-1)?.date).toBe("2026-11-17");
  });

  it("refuses a stale response, so a failed refresh keeps the last good file", () => {
    const stale = apiRows("2026-11-01", 40);
    expect(() => deriveRows(stale, { fetchedOn: "2026-11-19", weeks: 2 })).toThrow(/stale/);
    expect(() => deriveRows(stale, { fetchedOn: iso(Date.parse("2026-11-01T00:00:00Z") + MAX_AGE_DAYS * DAY), weeks: 2 })).not.toThrow();
    expect(() => deriveRows(apiRows("2026-11-20", 40), { fetchedOn: "2026-11-19", weeks: 2 })).toThrow(/after the fetch date/);
  });

  it("refuses implausible prices, missing samples and empty responses", () => {
    expect(() =>
      deriveRows(apiRows("2026-11-18", 40, (date, fuel) => (date === "2026-11-11" && fuel === "GPL Auto" ? "0,000 €" : null)), {
        fetchedOn: "2026-11-19",
        weeks: 2,
      }),
    ).toThrow(/Implausible/);
    expect(() =>
      deriveRows(apiRows("2026-11-18", 40, (date, fuel) => (date === "2026-11-11" && fuel === "GPL Auto" ? "skip" : null)), {
        fetchedOn: "2026-11-19",
        weeks: 2,
      }),
    ).toThrow(/No GPL Auto price on 2026-11-11/);
    expect(() => deriveRows(apiRows("2026-11-18", 5), { fetchedOn: "2026-11-19", weeks: 2 })).toThrow(/No Gasóleo/);
    expect(() => deriveRows([], { fetchedOn: "2026-11-19" })).toThrow(/No Gasóleo/);
    expect(() => deriveRows({} as never)).toThrow(/Not a list/);
  });

  it("renders the committed module byte for byte", () => {
    const committed = readFileSync(fileURLToPath(new URL("./data/fuelPrices.ts", import.meta.url)), "utf8");
    const rows = FUEL_PRICES.map(([date, diesel, gasoline95, lpg]) => ({ date, diesel, gasoline95, lpg }));
    expect(renderModule(rows, { fetchedOn: FUEL_PRICES_SOURCE.fetchedOn })).toBe(committed);
  });

  it("commits plausible, evenly spaced weekly data that ends on the as-of day", () => {
    expect(FUEL_PRICES.at(-1)?.[0]).toBe(FUEL_PRICES_SOURCE.asOf);
    expect(FUEL_PRICES[0][0]).toBe(FUEL_PRICES_SOURCE.firstDate);
    FUEL_PRICES.forEach(([date, ...prices], i) => {
      if (i > 0) expect(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${FUEL_PRICES[i - 1][0]}T00:00:00Z`)).toBe(7 * DAY);
      for (const price of prices) expect(price).toBeGreaterThan(0.5);
      for (const price of prices) expect(price).toBeLessThan(4);
    });
    expect(Date.parse(`${FUEL_PRICES_SOURCE.fetchedOn}T00:00:00Z`) - Date.parse(`${FUEL_PRICES_SOURCE.asOf}T00:00:00Z`)).toBeLessThanOrEqual(
      MAX_AGE_DAYS * DAY,
    );
  });
});
