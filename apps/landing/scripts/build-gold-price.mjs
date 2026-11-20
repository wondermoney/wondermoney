#!/usr/bin/env node
// Refresh script for src/lib/calculators/data/goldPrice.ts, the gold price page.
//
// Gold: Narodowy Bank Polski (NBP), the central bank of Poland, publishes every business day "the
// price of 1 g of gold (of 1000 millesimal fineness) calculated at NBP", in zloty, through its
// public Web API (https://api.nbp.pl/en.html#cenyZlota), which needs no key or sign-up.
//
// Why not the LBMA Gold Price in US dollars: it is a benchmark administered by ICE Benchmark
// Administration, and IBA requires a redistribution licence from anyone who passes the price to
// third parties, live or delayed (https://www.ice.com/iba/licensing). Central bank and statistics
// sites that used to republish it free stopped (FRED dropped its LBMA series in 2022). NBP's figure
// is the central bank's own published calculation, offered for reuse through an open API, so the
// page shows it with NBP named as the source.
//
// Euro: the ECB euro reference rate for the zloty (EXR.D.PLN.EUR.SP00.A, data-api.ecb.europa.eu),
// which the ECB lets anyone reuse with the source named. Euro per gram = NBP's zloty per gram
// divided by the zloty per euro of the SAME day. A day without both figures is skipped.
//
// History: the last 30 days with both figures, newest last. Refused (the old file stays): a stale
// newest day, a price or rate out of range, or a day-on-day move over 15%.
//
// Usage, from apps/landing (needs network; Node 18+ for fetch):
//
//   node scripts/build-gold-price.mjs [--date YYYY-MM-DD]
//
// --date sets the fetch date (defaults to today, UTC). scripts/build-daily-snapshots.mjs runs the
// same refresh at build time and keeps the committed file when it fails.

import { renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const GOLD_SOURCE = {
  name: "Narodowy Bank Polski (NBP), price of 1 g of gold of 1000 fineness",
  url: "https://nbp.pl/en/statistic-and-financial-reporting/rates/gold-price/",
};
export const FX_SOURCE = {
  name: "European Central Bank, euro reference exchange rate (Polish zloty)",
  url: "https://data.ecb.europa.eu/data/datasets/EXR/EXR.D.PLN.EUR.SP00.A",
};
export const NBP_URL = "https://api.nbp.pl/api/cenyzlota/last/60/?format=json";
export const ECB_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.PLN.EUR.SP00.A";
export const USER_AGENT = "WonderMoney-landing-build/1.0 (+https://github.com/wondermoney/wondermoney)";
export const DAYS = 30;
/** The newest day with both figures must be at most this many days before the fetch date. */
export const MAX_AGE_DAYS = 7;
export const RANGES = {
  plnPerGram: { min: 50, max: 5_000 },
  plnPerEuro: { min: 3, max: 6 },
  eurPerGram: { min: 15, max: 1_000 },
};
export const MAX_DAILY_MOVE = 0.15;
export const TROY_OUNCE_GRAMS = 31.1034768;

const DAY = 86_400_000;
const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** NBP's [{ data, cena }] to a Map of date to zloty per gram. */
export function parseNbp(json) {
  if (!Array.isArray(json)) throw new Error("NBP: not a list of prices");
  const prices = new Map();
  for (const row of json) {
    if (!isDate(row?.data) || typeof row.cena !== "number" || !Number.isFinite(row.cena)) {
      throw new Error(`NBP: unreadable row ${JSON.stringify(row)}`);
    }
    prices.set(row.data, row.cena);
  }
  return prices;
}

/** The ECB's SDMX CSV (detail=dataonly) to a Map of date to zloty per euro. */
export function parseEcbCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  const header = lines.shift()?.split(",") ?? [];
  const dateAt = header.indexOf("TIME_PERIOD");
  const valueAt = header.indexOf("OBS_VALUE");
  if (dateAt === -1 || valueAt === -1) throw new Error("ECB: no TIME_PERIOD or OBS_VALUE column");
  const rates = new Map();
  for (const line of lines) {
    const cells = line.split(",");
    const value = Number(cells[valueAt]);
    if (!isDate(cells[dateAt]) || !Number.isFinite(value)) throw new Error(`ECB: unreadable line ${line}`);
    rates.set(cells[dateAt], value);
  }
  return rates;
}

/**
 * Same-day zloty prices and rates to rows { date, plnPerGram, plnPerEuro, eurPerGram }, oldest
 * first, the last `days` days that have both. Throws when the result must not be shown.
 */
export function deriveRows(prices, rates, { fetchedOn, days = DAYS } = {}) {
  const dates = [...prices.keys()].filter((date) => rates.has(date)).sort();
  if (dates.length === 0) throw new Error("No day has both a gold price and a euro rate");
  const rows = dates.slice(-days).map((date) => {
    const plnPerGram = prices.get(date);
    const plnPerEuro = rates.get(date);
    const eurPerGram = Math.round((plnPerGram / plnPerEuro) * 10_000) / 10_000;
    for (const [name, value] of Object.entries({ plnPerGram, plnPerEuro, eurPerGram })) {
      const range = RANGES[name];
      if (!(value > range.min && value < range.max)) throw new Error(`Implausible ${name} ${value} on ${date}`);
    }
    return { date, plnPerGram, plnPerEuro, eurPerGram };
  });
  for (let i = 1; i < rows.length; i++) {
    const move = Math.abs(rows[i].eurPerGram / rows[i - 1].eurPerGram - 1);
    if (move > MAX_DAILY_MOVE) throw new Error(`Gold moved ${(move * 100).toFixed(1)}% on ${rows[i].date}: refusing`);
  }
  if (rows.length < 5) throw new Error(`Only ${rows.length} days with both figures`);
  const latest = rows.at(-1).date;
  if (fetchedOn !== undefined) {
    const age = (dayMs(fetchedOn) - dayMs(latest)) / DAY;
    if (age > MAX_AGE_DAYS) throw new Error(`Newest gold price is from ${latest}, ${age} days before ${fetchedOn}: stale`);
    if (age < 0) throw new Error(`Newest gold price ${latest} is after the fetch date ${fetchedOn}`);
  }
  return rows;
}

export function renderModule(rows, { fetchedOn }) {
  const lines = rows.map(
    (row) => `  [${JSON.stringify(row.date)}, ${row.plnPerGram}, ${row.plnPerEuro}, ${row.eurPerGram}],`,
  );
  return `// Generated by scripts/build-gold-price.mjs. Do not edit by hand: rerun the script.
//
// The price of 1 g of pure gold (1000 fineness) published by Narodowy Bank Polski, in zloty,
// converted to euro with the ECB euro reference rate of the same day. The script's header says why
// this source and not the LBMA Gold Price. The page reads this module only: it never calls NBP or
// the ECB. Educational data, not a quote.

export const GOLD_PRICE_SOURCE = {
  name: ${JSON.stringify(GOLD_SOURCE.name)},
  url: ${JSON.stringify(GOLD_SOURCE.url)},
  fxName: ${JSON.stringify(FX_SOURCE.name)},
  fxUrl: ${JSON.stringify(FX_SOURCE.url)},
  /** The day of the newest price and rate: the "data as of" the page shows. */
  asOf: ${JSON.stringify(rows.at(-1).date)},
  /** When this file was generated from the two APIs. */
  fetchedOn: ${JSON.stringify(fetchedOn)},
  /** Bump when the derivation changes, not when new days are appended. */
  version: 1,
} as const;

/** One day: [date, zloty per gram (NBP), zloty per euro (ECB), euro per gram], pure gold. */
export type GoldPriceRow = readonly [date: string, plnPerGram: number, plnPerEuro: number, eurPerGram: number];

export const GOLD_PRICES: readonly GoldPriceRow[] = [
${lines.join("\n")}
];
`;
}

async function get(fetchImpl, url, accept) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response;
}

export async function fetchSources({ fetchImpl = fetch, fetchedOn }) {
  const start = new Date(dayMs(fetchedOn) - 70 * DAY).toISOString().slice(0, 10);
  const nbp = await (await get(fetchImpl, NBP_URL, "application/json")).json();
  const ecb = await (
    await get(fetchImpl, `${ECB_URL}?startPeriod=${start}&detail=dataonly&format=csvdata`, "text/csv")
  ).text();
  return { prices: parseNbp(nbp), rates: parseEcbCsv(ecb) };
}

export const OUT_FILE = fileURLToPath(new URL("../src/lib/calculators/data/goldPrice.ts", import.meta.url));

/** Fetches, validates and writes (through a temporary file). Throws before writing on bad data. */
export async function refresh({ fetchImpl = fetch, fetchedOn = new Date().toISOString().slice(0, 10), out = OUT_FILE } = {}) {
  const { prices, rates } = await fetchSources({ fetchImpl, fetchedOn });
  const rows = deriveRows(prices, rates, { fetchedOn });
  writeFileSync(`${out}.next`, renderModule(rows, { fetchedOn }));
  renameSync(`${out}.next`, out);
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--date");
  const fetchedOn = at === -1 ? new Date().toISOString().slice(0, 10) : args[at + 1];
  if (!isDate(fetchedOn)) throw new Error("--date must be YYYY-MM-DD");
  const rows = await refresh({ fetchedOn });
  const last = rows.at(-1);
  console.log(`Wrote ${rows.length} days (${rows[0].date} to ${last.date}, ${last.eurPerGram} EUR/g) to ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
