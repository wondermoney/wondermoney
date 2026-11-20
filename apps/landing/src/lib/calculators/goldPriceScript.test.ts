import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GOLD_PRICES, GOLD_PRICE_SOURCE } from "./data/goldPrice";
import {
  ECB_URL,
  MAX_AGE_DAYS,
  NBP_URL,
  USER_AGENT,
  deriveRows,
  parseEcbCsv,
  parseNbp,
  refresh,
  renderModule,
} from "../../../scripts/build-gold-price.mjs";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Business-day-like series ending on `last`: gold at 480 + i zloty, the euro at 4.4 zloty. */
function series(last: string, days: number) {
  const end = Date.parse(`${last}T00:00:00Z`);
  const prices = new Map<string, number>();
  const rates = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const date = iso(end - i * DAY);
    prices.set(date, 480 + i);
    rates.set(date, 4.4);
  }
  return { prices, rates };
}

const ECB_CSV = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.PLN.EUR.SP00.A,D,PLN,EUR,SP00,A,2026-11-18,4.4118
EXR.D.PLN.EUR.SP00.A,D,PLN,EUR,SP00,A,2026-11-19,4.417
`;

describe("build-gold-price", () => {
  it("reads NBP's prices and the ECB's CSV", () => {
    expect(parseNbp([{ data: "2026-11-19", cena: 487.99 }])).toEqual(new Map([["2026-11-19", 487.99]]));
    expect(() => parseNbp([{ data: "x", cena: 1 }])).toThrow(/unreadable/);
    expect(() => parseNbp({})).toThrow(/not a list/);
    expect(parseEcbCsv(ECB_CSV)).toEqual(new Map([["2026-11-18", 4.4118], ["2026-11-19", 4.417]]));
    expect(() => parseEcbCsv("A,B\n1,2")).toThrow(/TIME_PERIOD/);
  });

  it("converts each day's zloty price with the same day's rate and keeps the last 30 days", () => {
    const { prices, rates } = series("2026-11-19", 45);
    rates.delete("2026-11-18");
    const rows = deriveRows(prices, rates, { fetchedOn: "2026-11-20" });
    expect(rows).toHaveLength(30);
    expect(rows.map((row) => row.date)).not.toContain("2026-11-18");
    expect(rows.at(-1)).toEqual({ date: "2026-11-19", plnPerGram: 480, plnPerEuro: 4.4, eurPerGram: 109.0909 });
  });

  it.each([
    ["a stale newest day", () => series("2026-11-01", 20), /stale/],
    ["a day after the fetch date", () => series("2026-11-21", 20), /after the fetch date/],
    [
      "an implausible rate",
      () => {
        const data = series("2026-11-19", 20);
        data.rates.set("2026-11-19", 44);
        return data;
      },
      /Implausible plnPerEuro/,
    ],
    [
      "a 20% jump",
      () => {
        const data = series("2026-11-19", 20);
        data.prices.set("2026-11-19", 600);
        return data;
      },
      /moved 2\d\.\d% on 2026-11-19/,
    ],
    ["no common day", () => ({ prices: series("2026-11-19", 10).prices, rates: new Map<string, number>() }), /No day has both/],
    ["too short a series", () => series("2026-11-19", 3), /Only 3 days/],
  ])("refuses %s", (_, make, message) => {
    const { prices, rates } = make();
    expect(() => deriveRows(prices, rates, { fetchedOn: "2026-11-20" })).toThrow(message);
  });

  it("allows a long weekend between the newest price and the fetch", () => {
    expect(MAX_AGE_DAYS).toBe(7);
    expect(() => deriveRows(...Object.values(series("2026-11-16", 20)) as [Map<string, number>, Map<string, number>], { fetchedOn: "2026-11-20" })).not.toThrow();
  });

  it("renders a module the page can import, dated with the newest day", () => {
    const rows = deriveRows(series("2026-11-19", 10).prices, series("2026-11-19", 10).rates, { fetchedOn: "2026-11-20" });
    const text = renderModule(rows, { fetchedOn: "2026-11-20" });
    expect(text).toContain('asOf: "2026-11-19"');
    expect(text).toContain('fetchedOn: "2026-11-20"');
    expect(text).toContain('["2026-11-19", 480, 4.4, 109.0909],');
  });

  it("matches the committed module", () => {
    expect(GOLD_PRICE_SOURCE.url).toMatch(/^https:\/\/nbp\.pl\//);
    expect(GOLD_PRICE_SOURCE.fxUrl).toMatch(/^https:\/\/data\.ecb\.europa\.eu\//);
    expect(GOLD_PRICES.length).toBeGreaterThanOrEqual(5);
  });
});

describe("refreshing the gold snapshot", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("calls NBP and the ECB once each and writes only valid data", async () => {
    dir = mkdtempSync(join(tmpdir(), "gold-"));
    const out = join(dir, "goldPrice.ts");
    writeFileSync(out, "old");
    const calls: string[] = [];
    const agents: string[] = [];
    const answer = (nbp: unknown) =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push(String(url));
        agents.push((init?.headers as Record<string, string>)["User-Agent"]);
        if (String(url).startsWith(NBP_URL)) return new Response(JSON.stringify(nbp));
        const lines = [...series("2026-11-19", 20).rates].map(([date, rate]) => `EXR.D.PLN.EUR.SP00.A,D,PLN,EUR,SP00,A,${date},${rate}`);
        return new Response(`KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n${lines.join("\n")}`);
      }) as typeof fetch;

    await expect(refresh({ fetchImpl: answer([{ data: "2026-11-19", cena: "487" }]), fetchedOn: "2026-11-20", out })).rejects.toThrow();
    expect(readFileSync(out, "utf8")).toBe("old");

    const nbp = [...series("2026-11-19", 20).prices].map(([data, cena]) => ({ data, cena }));
    calls.length = 0;
    await refresh({ fetchImpl: answer(nbp), fetchedOn: "2026-11-20", out });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(`${ECB_URL}?startPeriod=2026-09-11&detail=dataonly&format=csvdata`);
    expect(new Set(agents)).toEqual(new Set([USER_AGENT]));
    expect(readFileSync(out, "utf8")).toContain('asOf: "2026-11-19"');
  });
});
