#!/usr/bin/env node
// Refresh script for src/lib/calculators/data/depositRates.ts (the deposit-rate index).
//
// Source: the monthly euro-area Monetary Financial Institution interest rate (MIR) statistics,
// ECB Data Portal, dataflow MIR: "Bank interest rates on deposits from households with agreed
// maturity (new business)", annualised agreed rate, all amounts, in euro:
//
//   Portugal   MIR.M.PT.B.L22.{A,F,G,H}.R.A.2250.EUR.N   (compiled by Banco de Portugal)
//   Euro area  MIR.M.U2.B.L22.{A,F,G,H}.R.A.2250.EUR.N   (changing composition)
//
// where the maturity code is A total original maturity, F up to 1 year, G over 1 and up to 2
// years, H over 2 years. The Portuguese series is the Banco de Portugal's own submission
// (SOURCE_AGENCY PT2). Banco de Portugal's BPstat (https://bpstat.bportugal.pt/) publishes the
// new-business deposit volumes for households (series 12519793, 12519795, 12519797) and the
// new-business rates for the whole non-financial sector (12519733 to 12519736), but not the
// household new-business rates through its public API, so the ECB Data Portal copy of the same
// statistic is the source. The ECB allows free use of its statistics when they are reproduced
// accurately and the ECB is cited as the source (https://www.ecb.europa.eu/services/disclaimer/).
//
// Inflation is not fetched: the page reads annual CPI from portugalCpi.ts (INE through BPstat).
//
// Usage (Node 22+, network access; run from apps/landing):
//
//   node scripts/build-deposit-rates.mjs [YYYY-MM-DD retrieval date, default today]

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SOURCE = {
  name: "ECB Data Portal, MFI interest rate statistics (MIR): deposits from households with agreed maturity, new business",
  url: "https://data.ecb.europa.eu/data/datasets/MIR",
  licenceUrl: "https://www.ecb.europa.eu/services/disclaimer/html/index.en.html",
};

export const FIRST_MONTH = "2003-01";
/** Maturity codes in the order the data rows list them. */
export const MATURITIES = ["A", "F", "G", "H"];
export const AREAS = ["PT", "U2"];

export function seriesUrl() {
  const key = `M.{area}.B.L22.${MATURITIES.join("+")}.R.A.2250.EUR.N`;
  return AREAS.map(
    (area) =>
      `https://data-api.ecb.europa.eu/service/data/MIR/${key.replace("{area}", area)}?format=csvdata&startPeriod=${FIRST_MONTH}`,
  );
}

/** Minimal CSV reader: the ECB's fields only quote with double quotes and never span lines here. */
export function parseCsv(text) {
  const rows = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const fields = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') quoted = false;
        else current += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") {
        fields.push(current);
        current = "";
      } else current += char;
    }
    fields.push(current);
    rows.push(fields);
  }
  const [header, ...body] = rows;
  return body.map((fields) => Object.fromEntries(header.map((name, i) => [name, fields[i]])));
}

/**
 * ECB CSV rows from both areas to { months: [{ month, values: [8 numbers] }], provisional: [months] }.
 * The values are Portugal A, F, G, H then euro area A, F, G, H, in percent, null for a maturity bucket with no new business that month. Throws on a gap in the
 * months, a missing value or an implausible rate, so a broken download never reaches the module.
 */
export function buildRows(records) {
  const byKey = new Map();
  const provisional = new Set();
  for (const record of records) {
    const area = record.REF_AREA;
    const maturity = record.MATURITY_NOT_IRATE;
    if (!AREAS.includes(area) || !MATURITIES.includes(maturity)) continue;
    const value = Number(record.OBS_VALUE);
    if (record.OBS_VALUE === "" || !Number.isFinite(value)) {
      throw new Error(`No value for ${area} ${maturity} ${record.TIME_PERIOD}`);
    }
    if (value < -1 || value > 15) throw new Error(`Implausible rate ${value} for ${area} ${maturity} ${record.TIME_PERIOD}`);
    byKey.set(`${area}|${maturity}|${record.TIME_PERIOD}`, value);
    if (record.OBS_STATUS === "P") provisional.add(record.TIME_PERIOD);
  }
  const months = [...new Set([...byKey.keys()].map((key) => key.split("|")[2]))].sort();
  if (months[0] !== FIRST_MONTH) throw new Error(`The series starts in ${months[0]}, not ${FIRST_MONTH}`);
  let expected = FIRST_MONTH;
  const rows = months.map((month) => {
    if (month !== expected) throw new Error(`Gap in the monthly series: expected ${expected}, found ${month}`);
    const [year, number] = month.split("-").map(Number);
    expected = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
    const values = AREAS.flatMap((area) =>
      MATURITIES.map((maturity) => {
        const value = byKey.get(`${area}|${maturity}|${month}`);
        if (value !== undefined) return value;
        // The maturity buckets are empty in months with no new business; the total never is.
        if (maturity === "A") throw new Error(`Missing ${area} total in ${month}`);
        return null;
      }),
    );
    return { month, values };
  });
  // Only the recent months can still be revised; older flags are leftovers in the ECB's history.
  const recent = new Set(months.slice(-6));
  return { months: rows, provisional: [...provisional].filter((month) => recent.has(month)).sort() };
}

export function renderModule({ months, provisional }, retrievedOn) {
  const first = months[0].month;
  const last = months[months.length - 1].month;
  const lines = months.map(({ month, values }) => `  ["${month}", ${values.map((value) => (value === null ? "null" : String(value))).join(", ")}],`);
  return `// Generated by scripts/build-deposit-rates.mjs. Do not edit by hand: rerun the script.
//
// Monthly average interest rates banks paid on NEW deposits with an agreed maturity from
// households (new business, annualised agreed rate, all amounts, euro), for Portugal and the euro
// area. An average of what was actually agreed, not the best offer. Educational data only.

export const DEPOSIT_RATES_SOURCE = {
  name: ${JSON.stringify(SOURCE.name)},
  url: ${JSON.stringify(SOURCE.url)},
  licenceUrl: ${JSON.stringify(SOURCE.licenceUrl)},
  /** Series ids in the ECB Data Portal, by area. The maturity code replaces {m}. */
  seriesPortugal: "MIR.M.PT.B.L22.{m}.R.A.2250.EUR.N",
  seriesEuroArea: "MIR.M.U2.B.L22.{m}.R.A.2250.EUR.N",
  retrievedOn: ${JSON.stringify(retrievedOn)},
  firstMonth: ${JSON.stringify(first)},
  lastMonth: ${JSON.stringify(last)},
  /** Recent months the ECB still flags as provisional. */
  provisionalMonths: [${provisional.map((month) => JSON.stringify(month)).join(", ")}] as readonly string[],
  /** Bump when the derivation changes, not when new months are appended. */
  version: 1,
} as const;

/**
 * One month: [month "YYYY-MM", then in percent, Portugal: all maturities, up to 1 year, over 1 and
 * up to 2 years, over 2 years; then the euro area in the same order]. A maturity bucket is null in a month with no new business.
 */
export type DepositRateRow = readonly [
  month: string,
  ptAll: number,
  ptUpTo1y: number | null,
  pt1to2y: number | null,
  ptOver2y: number | null,
  eaAll: number,
  eaUpTo1y: number | null,
  ea1to2y: number | null,
  eaOver2y: number | null,
];

export const DEPOSIT_RATES: readonly DepositRateRow[] = [
${lines.join("\n")}
];
`;
}

async function main() {
  const [retrievedOn = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedOn)) {
    console.error("Usage: node scripts/build-deposit-rates.mjs [YYYY-MM-DD]");
    process.exit(1);
  }
  const records = [];
  for (const url of seriesUrl()) {
    const response = await fetch(url, { headers: { Accept: "text/csv" } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    records.push(...parseCsv(await response.text()));
  }
  const built = buildRows(records);
  const out = fileURLToPath(new URL("../src/lib/calculators/data/depositRates.ts", import.meta.url));
  writeFileSync(out, renderModule(built, retrievedOn));
  const last = built.months.at(-1);
  console.log(`Wrote ${built.months.length} months (${built.months[0].month} to ${last.month}) to ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
