#!/usr/bin/env node
// Generator for src/lib/calculators/data/omiePrices.ts and public/data/omie-pt-quarter-hours.json.
//
// Sources, all official:
// - OMIE, the Iberian day-ahead market: the daily marginal price files for Portugal
//   ("Precios horarios del mercado diario en Portugal", marginalpdbcpt_YYYYMMDD.1), EUR/MWh. Since
//   1 October 2025 the day-ahead market clears every quarter-hour (96 periods a day, 92 and 100 on
//   the clock-change days); before, every hour (24, 23 and 25). Periods are in Spanish legal time
//   (CET/CEST), one hour ahead of mainland Portugal all year, so period 1 starts at 23:00 Lisbon
//   time on the day before. The layout is "year;month;day;period;price Portugal;price Spain;". The
//   Portuguese price is the first one: on 10 April 2026, periods 31 and 32, the file holds
//   87.17;91.6 and 90.03;95, and OMIE's own results page labels 87.17 and 90.03 "Precio marginal en
//   el sistema portugués" and 91.6 and 95 "Precio marginal en el sistema español".
//   https://www.omie.es/pt/file-access-list?parents=/Mercado%20Diario/1.%20Precios&dir=Precios%20horarios%20del%20mercado%20diario%20en%20Portugal&realdir=marginalpdbcpt
// - E-REDES, the BTN consumption profiles of each year (class C, the default for a household at
//   or below 13,8 kVA and 7 140 kWh a year), the weights below; and the loss profiles of each year
//   ("Perfis de Perdas Simples", columns BT, MT and AT), under the methodology ERSE approved in the
//   Guia de Medição, Leitura e Disponibilização de Dados. https://www.e-redes.pt/pt-pt/perfis-de-consumo-e-perdas
// - REN, the transmission-network loss profile of each year (column AT/RNT, "Perfis de Perdas RNT
//   <year>.xlsx"). https://mercado.ren.pt/PT/Electr/Explora%C3%A7%C3%A3odosistema/Consumo/Paginas/PerfisPerdas.aspx
//   A low-voltage consumer's loss factor is the product of the four, (1 + BT)(1 + MT)(1 + AT)
//   (1 + AT/RNT): E-REDES's equation (6) in "Determinação de Perfis de Perdas" (December 2025).
//   Averaged over the BTN C profile it comes to 1,160 in 2026, the "coeficiente de perdas" of about
//   16 % the supplier formulas quote. All profiles are in Lisbon legal time.
//
// Outputs:
// - The committed module: for each of the last 13 full months, OMIE's arithmetic mean and, for each
//   hourly cycle and tri-hourly period, the profile-weighted average of OMIE, of OMIE x loss factor
//   and of the loss factor, with the profile's weight, and the period's arithmetic mean. Every linear
//   formula of the kind suppliers publish for indexed offers can be priced from those averages
//   (indexedPricing.ts).
// - The static JSON: every quarter-hour price and loss factor of the last 12 full months, fetched
//   by the page only when a visitor prices indexed offers against an uploaded load diagram.
//
// Usage, from apps/landing (xlsx is a devDependency, loaded only here):
//
//   node scripts/build-omie-prices.mjs [--to YYYY-MM] [--date YYYY-MM-DD] [--cache <dir>]
//
// --to is the last month to include (default: the month before today, UTC). --cache keeps the
// downloaded files in a directory and reuses them on a later run.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveDays } from "./build-electricity-profiles.mjs";
import {
  HOURLY_CYCLES,
  QUARTER_HOUR_MS,
  legalMidnight,
  quartersInLegalDay,
  triHourlyPeriodAt,
} from "../src/lib/calculators/electricityCycles.ts";

export const SOURCE = {
  omie: {
    name: "OMIE, Preços marginais do mercado diário em Portugal (marginalpdbcpt)",
    page: "https://www.omie.es/pt/file-access-list?parents=/Mercado%20Diario/1.%20Precios&dir=Precios%20horarios%20del%20mercado%20diario%20en%20Portugal&realdir=marginalpdbcpt",
    file: (key) => `https://www.omie.es/es/file-download?parents=marginalpdbcpt&filename=marginalpdbcpt_${key}.1`,
  },
  profiles: {
    name: "E-REDES, Perfis de consumo (BTN classe C) e Perfis de perdas (BT, MT e AT); REN, Perfis de perdas RNT (AT/RNT)",
    page: "https://www.e-redes.pt/pt-pt/perfis-de-consumo-e-perdas",
  },
  ren: {
    page: "https://mercado.ren.pt/PT/Electr/Explora%C3%A7%C3%A3odosistema/Consumo/Paginas/PerfisPerdas.aspx",
    file: (year) =>
      `https://mercado.ren.pt/PT/Electr/Explora%C3%A7%C3%A3odosistema/Consumo/BibPerfPerdas/Perfis%20de%20Perdas%20RNT%20${year}.xlsx`,
  },
};

/** Full months kept in the committed module, and in the JSON for the diagram. */
export const MODULE_MONTHS = 13;
export const JSON_MONTHS = 12;
const TRI_PERIODS = ["peak", "shoulder", "valley"];
const HOUR_MS = 3_600_000;

function fail(message) {
  throw new Error(`build-omie-prices: ${message}`);
}

const pad = (value) => String(value).padStart(2, "0");

/** The UTC instant OMIE's day starts: 00:00 Spanish legal time, 23:00 the day before in Lisbon. */
export function omieDayStart(year, month, day) {
  return legalMidnight(year, month, day) - HOUR_MS;
}

/**
 * One OMIE daily file to { start, prices }: the UTC start of each quarter-hour of the Spanish day,
 * and the Portuguese price of each, EUR/MWh. Hourly files (before 1 October 2025) give each hour's
 * price to its four quarter-hours. Throws unless the file has every period of that day.
 */
export function parseOmieDay(text, year, month, day) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line !== "*");
  if (!/^MARGINALPDBC(PT)?;?$/.test(lines[0] ?? "")) fail(`${year}-${pad(month)}-${pad(day)}: not an OMIE marginal price file`);
  const rows = lines.slice(1).map((line) => line.split(";"));
  const quarters = quartersInLegalDay(year, month, day);
  const perPeriod = rows.length === quarters ? 1 : rows.length === quarters / 4 ? 4 : 0;
  if (perPeriod === 0) fail(`${year}-${pad(month)}-${pad(day)}: ${rows.length} periods, expected ${quarters} or ${quarters / 4}`);
  const prices = [];
  rows.forEach((fields, index) => {
    const [y, m, d, period, pt] = fields;
    if (Number(y) !== year || Number(m) !== month || Number(d) !== day || Number(period) !== index + 1) {
      fail(`${year}-${pad(month)}-${pad(day)}: unexpected row ${fields.join(";")}`);
    }
    const price = Number(pt);
    if (pt === "" || !Number.isFinite(price)) fail(`${year}-${pad(month)}-${pad(day)}: bad price in ${fields.join(";")}`);
    for (let i = 0; i < perPeriod; i++) prices.push(price);
  });
  return { start: omieDayStart(year, month, day), prices };
}

/**
 * A loss profile spreadsheet's rows to the values of one column (header "BT", "MT", "AT" or
 * "AT/RNT") per legal day, keyed "YYYY-MM-DD". Each day must hold its 92, 96 or 100 quarter-hours.
 */
export function deriveLossDays(rows, header) {
  let column;
  for (const row of rows.slice(0, 12)) {
    const index = row.findIndex((cell) => typeof cell === "string" && cell.trim() === header);
    if (index !== -1) {
      column = index;
      break;
    }
  }
  if (column === undefined) fail(`no "${header}" column in the loss profiles`);
  const days = new Map();
  for (const row of rows) {
    if (typeof row[0] !== "number") continue;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(row[0]) * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    const value = row[column];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 0.5) fail(`bad ${header} loss on ${key}`);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(value);
  }
  if (days.size === 0) fail(`no ${header} loss rows`);
  for (const [key, values] of days) {
    const [y, m, d] = key.split("-").map(Number);
    if (values.length !== quartersInLegalDay(y, m, d)) fail(`${header} losses on ${key}: ${values.length} quarter-hours`);
  }
  return days;
}

/**
 * The loss factor of a low-voltage (BT) consumer for each quarter-hour, as the energy to inject at
 * the reference (MAT) per kWh consumed: (1 + BT)(1 + MT)(1 + AT)(1 + AT/RNT), E-REDES's equation (6)
 * in "Determinação de Perfis de Perdas" (December 2025), from the per-level loss profiles. Returns
 * a map of day key to factors.
 */
export function cumulativeLossDays(levels) {
  const out = new Map();
  for (const [key, bt] of levels.BT) {
    const others = ["MT", "AT", "AT/RNT"].map((level) => levels[level].get(key));
    if (others.some((values) => values?.length !== bt.length)) fail(`loss levels disagree on ${key}`);
    out.set(key, bt.map((value, i) => others.reduce((factor, values) => factor * (1 + values[i]), 1 + value)));
  }
  return out;
}

/** Profile or loss days to a map from each quarter-hour's UTC start to its value. */
export function byInstant(days, valueOf) {
  const map = new Map();
  for (const [key, values] of days) {
    const [y, m, d] = key.split("-").map(Number);
    const start = legalMidnight(y, m, d);
    valueOf(values).forEach((value, quarter) => map.set(start + quarter * QUARTER_HOUR_MS, value));
  }
  return map;
}

/** The `count` full months that end with `to` ("YYYY-MM"), oldest first. */
export function monthsEndingWith(to, count) {
  const [year, month] = to.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(year, month - count + i, 1));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
  });
}

/** Every quarter-hour start (UTC) of a legal-time month. */
function quartersOfMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const start = legalMidnight(year, month, 1);
  const next = new Date(Date.UTC(year, month, 1));
  const end = legalMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
  const out = [];
  for (let t = start; t < end; t += QUARTER_HOUR_MS) out.push(t);
  return out;
}

/**
 * Monthly aggregates from quarter-hour maps (UTC start to value): OMIE price (EUR/MWh), profile
 * weight and loss factor. Each month: { month, quarters, mean, daily, weekly }, the cycles as
 * [peak, shoulder, valley] buckets of [weight, omie, omie x loss factor, loss factor, mean,
 * quarters]: the middle three weighted by the profile, `mean` the period's arithmetic mean.
 */
export function aggregateMonths(months, { prices, profile, losses }) {
  return months.map((month) => {
    const instants = quartersOfMonth(month);
    const buckets = Object.fromEntries(HOURLY_CYCLES.map((cycle) => [cycle, TRI_PERIODS.map(() => [0, 0, 0, 0, 0, 0])]));
    let sum = 0;
    for (const instant of instants) {
      const price = prices.get(instant);
      const weight = profile.get(instant);
      const loss = losses.get(instant);
      const when = new Date(instant).toISOString();
      if (price === undefined) fail(`no OMIE price for ${when}`);
      if (weight === undefined) fail(`no profile value for ${when}`);
      if (loss === undefined) fail(`no loss factor for ${when}`);
      sum += price;
      for (const cycle of HOURLY_CYCLES) {
        const bucket = buckets[cycle][TRI_PERIODS.indexOf(triHourlyPeriodAt(instant, cycle))];
        bucket[0] += weight;
        bucket[1] += weight * price;
        bucket[2] += weight * price * loss;
        bucket[3] += weight * loss;
        bucket[4] += price;
        bucket[5] += 1;
      }
    }
    const finish = ([w, p, pl, l, sum, n]) => (w > 0 ? [w, p / w, pl / w, l / w, sum / n, n] : [0, 0, 0, 1, 0, n]);
    return {
      month,
      quarters: instants.length,
      mean: sum / instants.length,
      daily: buckets.daily.map(finish),
      weekly: buckets.weekly.map(finish),
    };
  });
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

export function renderModule(months, meta) {
  const bucket = ([w, p, pl, l, mean, n]) =>
    `[${round(w, 5)}, ${round(p, 4)}, ${round(pl, 4)}, ${round(l, 7)}, ${round(mean, 4)}, ${n}]`;
  const rows = months
    .map(
      (m) =>
        `  { month: ${JSON.stringify(m.month)}, quarters: ${m.quarters}, mean: ${round(m.mean, 4)},\n` +
        `    daily: [${m.daily.map(bucket).join(", ")}],\n` +
        `    weekly: [${m.weekly.map(bucket).join(", ")}] },`,
    )
    .join("\n");
  return `// Generated by scripts/build-omie-prices.mjs. Do not edit by hand: rerun the script.
//
// OMIE day-ahead marginal prices for Portugal, ${months[0].month} to ${months.at(-1).month}, reduced to
// monthly averages by tariff period: what the indexed-offer formulas (data/indexedFormulas.ts) are
// priced from. Each period's averages are weighted by the E-REDES BTN class C consumption profile, as
// a supplier bills a household without a quarter-hour meter reading. The sources and the method are
// in the script header. Quarter-hour prices are not bundled: the load-diagram mode fetches
// ${meta.jsonPath} instead.

import type { OmieMonth } from "../indexedPricing";

export const OMIE_PRICES_SOURCE = {
  name: ${JSON.stringify(SOURCE.omie.name)},
  url: ${JSON.stringify(SOURCE.omie.page)},
  profiles: ${JSON.stringify(SOURCE.profiles.name)},
  profilesUrl: ${JSON.stringify(SOURCE.profiles.page)},
  /** The spreadsheets used, by year: E-REDES consumption and loss profiles, REN's AT/RNT losses. */
  files: ${JSON.stringify(meta.files, null, 2).replace(/\n/g, "\n  ")},
  /** The first and last month covered. */
  firstMonth: ${JSON.stringify(months[0].month)},
  lastMonth: ${JSON.stringify(months.at(-1).month)},
  /** The quarter-hour prices of the last ${JSON_MONTHS} months, for the load-diagram mode. */
  quarterHoursPath: ${JSON.stringify(meta.jsonPath)},
  fetchedOn: ${JSON.stringify(meta.fetchedOn)},
  /** Bump when the derivation changes, not when the prices change. */
  version: 1,
} as const;

/**
 * Oldest first. \`mean\`: OMIE's arithmetic mean over the month, EUR/MWh. \`daily\` and \`weekly\`:
 * [peak, shoulder, valley], each [profile weight (thousandths of the profile's year), OMIE,
 * OMIE x loss factor, loss factor, the period's arithmetic mean of OMIE, its quarter-hours]; the
 * second to fourth are profile-weighted averages. Prices in EUR/MWh.
 */
export const OMIE_MONTHS: readonly OmieMonth[] = [
${rows}
];
`;
}

/** The JSON for the diagram mode: integers keep it small. */
export function renderQuarterHours(months, { prices, losses }) {
  const instants = months.flatMap(quartersOfMonth);
  return JSON.stringify({
    source: SOURCE.omie.name,
    url: SOURCE.omie.page,
    firstMonth: months[0],
    lastMonth: months.at(-1),
    /** UTC start of the first quarter-hour; the rest follow every 15 minutes, without gaps. */
    start: new Date(instants[0]).toISOString(),
    /** OMIE Portugal, hundredths of a EUR/MWh. */
    omie: instants.map((t) => Math.round(prices.get(t) * 100)),
    /** Loss factor minus 1, hundred-thousandths. */
    loss: instants.map((t) => Math.round((losses.get(t) - 1) * 1e5)),
  });
}

async function download(url, cacheDir, name) {
  if (cacheDir && existsSync(join(cacheDir, name))) return readFileSync(join(cacheDir, name));
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (cacheDir) writeFileSync(join(cacheDir, name), buffer);
      return buffer;
    } catch (error) {
      if (attempt >= 3) fail(`download of ${url} failed: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/** The E-REDES spreadsheet links on its profiles page, by kind and year. */
export function eredesLinks(html) {
  const links = { consumption: {}, losses: {} };
  for (const [, raw] of html.matchAll(/href="([^"]+)"/g)) {
    let href = raw.replaceAll("&amp;", "&");
    const embedded = /[?&]src=([^&]+)/.exec(href);
    if (embedded) href = decodeURIComponent(embedded[1]);
    const name = decodeURIComponent(href.split("/").pop() ?? "");
    const year = /(20\d\d)/.exec(name)?.[1];
    if (!year || !/\.xlsx$/i.test(name)) continue;
    if (/Perfil_Consumo/i.test(name)) links.consumption[year] ??= href;
    else if (/Perfis_Perdas/i.test(name)) links.losses[year] ??= href;
  }
  return links;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const fetchedOn = option("--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fetchedOn)) fail("--date must be YYYY-MM-DD");
  const previous = new Date(Date.UTC(Number(fetchedOn.slice(0, 4)), Number(fetchedOn.slice(5, 7)) - 2, 1));
  const to = option("--to") ?? `${previous.getUTCFullYear()}-${pad(previous.getUTCMonth() + 1)}`;
  if (!/^\d{4}-\d{2}$/.test(to)) fail("--to must be YYYY-MM");
  const cacheDir = option("--cache");
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });

  const months = monthsEndingWith(to, MODULE_MONTHS);
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];

  // E-REDES profiles and losses for every year covered.
  const XLSX = (await import("xlsx")).default ?? (await import("xlsx"));
  const page = (await download(SOURCE.profiles.page, cacheDir, "eredes-profiles.html")).toString("utf8");
  const links = eredesLinks(page);
  const profileDays = [];
  const lossDays = { BT: new Map(), MT: new Map(), AT: new Map(), "AT/RNT": new Map() };
  const files = {};
  for (const year of years) {
    const consumptionUrl = links.consumption[year];
    const lossesUrl = links.losses[year];
    if (!consumptionUrl || !lossesUrl) fail(`E-REDES has no ${year} consumption or loss profile on ${SOURCE.profiles.page}`);
    const sheetRows = (buffer) => {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheet = workbook.SheetNames.find((name) => /^\d{4}$/.test(name.trim())) ?? workbook.SheetNames[0];
      return XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, raw: true, defval: null });
    };
    const consumption = await download(consumptionUrl, cacheDir, `consumption-${year}.xlsx`);
    const loss = await download(lossesUrl, cacheDir, `losses-${year}.xlsx`);
    const transmission = await download(SOURCE.ren.file(year), cacheDir, `ren-losses-${year}.xlsx`);
    const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
    files[year] = {
      consumption: consumptionUrl,
      consumptionSha256: sha(consumption),
      losses: lossesUrl,
      lossesSha256: sha(loss),
      transmissionLosses: SOURCE.ren.file(year),
      transmissionLossesSha256: sha(transmission),
    };
    profileDays.push(...deriveDays(sheetRows(consumption)));
    const distribution = sheetRows(loss);
    for (const level of ["BT", "MT", "AT"]) {
      for (const [key, values] of deriveLossDays(distribution, level)) lossDays[level].set(key, values);
    }
    for (const [key, values] of deriveLossDays(sheetRows(transmission), "AT/RNT")) lossDays["AT/RNT"].set(key, values);
  }
  const profile = byInstant(new Map(profileDays.map((d) => [d.key, d.values.C])), (v) => v);
  const losses = byInstant(cumulativeLossDays(lossDays), (v) => v);

  // OMIE: every Spanish day from the first month's first day to the day after the last month.
  const [fy, fm] = months[0].split("-").map(Number);
  const [ly, lm] = to.split("-").map(Number);
  const days = [];
  for (let t = Date.UTC(fy, fm - 1, 1); t <= Date.UTC(ly, lm, 1); t += 86_400_000) days.push(new Date(t));
  const prices = new Map();
  const queue = [...days];
  const worker = async () => {
    while (queue.length > 0) {
      const date = queue.shift();
      const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
      const key = `${y}${pad(m)}${pad(d)}`;
      const text = (await download(SOURCE.omie.file(key), cacheDir, `omie-${key}.txt`)).toString("latin1");
      const day = parseOmieDay(text, y, m, d);
      day.prices.forEach((price, i) => prices.set(day.start + i * QUARTER_HOUR_MS, price));
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  const aggregated = aggregateMonths(months, { prices, profile, losses });
  const jsonPath = "/data/omie-pt-quarter-hours.json";
  const moduleOut = fileURLToPath(new URL("../src/lib/calculators/data/omiePrices.ts", import.meta.url));
  const jsonOut = fileURLToPath(new URL(`../public${jsonPath}`, import.meta.url));
  mkdirSync(fileURLToPath(new URL("../public/data/", import.meta.url)), { recursive: true });
  const json = renderQuarterHours(months.slice(-JSON_MONTHS), { prices, losses });
  writeFileSync(moduleOut, renderModule(aggregated, { files, fetchedOn, jsonPath }));
  writeFileSync(jsonOut, `${json}\n`);
  console.log(`Wrote ${months[0]} to ${to} to ${moduleOut} and ${jsonOut} (${json.length} bytes)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
