#!/usr/bin/env node
// Generator for src/lib/calculators/data/electricityProfiles.ts.
//
// Source: the BTN consumption profiles for the year, classes A, B and C, published each December by
// E-REDES, the network operator for mainland Portugal, under the methodology ERSE approved in the
// Guia de Medição, Leitura e Disponibilização de Dados (Regulamento n.º 987/2025), articles 68.º
// and 69.º: for every quarter-hour of the year, the share of the year's consumption, adimensional,
// summing to 1000. The file is in legal time, with 92 and 100 rows on the days the clock changes.
// https://www.e-redes.pt/pt-pt/perfis-de-consumo-e-perdas
//
// The committed module is a compact derivation, not the 35 040 quarter-hours: for each profile
// class, period schedule (electricityCycles.ts), hourly cycle and month, the profile's share of the
// year in tri-hourly peak, shoulder and valley hours. Bi-hourly and simple shares follow from those
// (off-valley = peak + shoulder). The weekly cycle depends on the weekdays, so the table belongs
// to the profile's own calendar year.
//
// Usage, from apps/landing (xlsx is a devDependency, loaded only here):
//
//   node scripts/build-electricity-profiles.mjs [--from-file <profiles.xlsx>] [--date YYYY-MM-DD] [--url <url>]
//
// Without --from-file it downloads SOURCE.url. --date is the download date (defaults to today, UTC).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HOURLY_CYCLES,
  PERIOD_SCHEDULES,
  QUARTER_HOUR_MS,
  legalMidnight,
  legalTimeOf,
  quartersInLegalDay,
  triHourlyPeriodAt,
} from "../src/lib/calculators/electricityCycles.ts";

export const SOURCE = {
  name: "E-REDES, Perfis de consumo e de injeção (BTN classes A, B e C), metodologia aprovada pela ERSE (GMLDD, artigos 68.º e 69.º)",
  page: "https://www.e-redes.pt/pt-pt/perfis-de-consumo-e-perdas",
  url: "https://www.e-redes.pt/sites/eredes/files/2025-12/Perfil_Consumo_Inje%C3%A7%C3%A3o_E-REDES_2026.xlsx",
  rules: "https://www.e-redes.pt/sites/eredes/files/2025-12/GMLDD_2025.pdf",
};

export const PROFILE_CLASSES = ["A", "B", "C"];
const TRI_PERIODS = ["peak", "shoulder", "valley"];
/** Largest accepted gap between a profile's yearly sum and 1000. */
export const SUM_TOLERANCE = 0.001;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function fail(message) {
  throw new Error(`build-electricity-profiles: ${message}`);
}

/** The column of each "BTN A/B/C" header in the first rows of the sheet. */
function profileColumns(rows) {
  const columns = {};
  for (const row of rows.slice(0, 6)) {
    row.forEach((cell, index) => {
      const match = typeof cell === "string" ? /^\s*BTN\s+([ABC])\s*$/i.exec(cell) : null;
      if (match && columns[match[1].toUpperCase()] === undefined) columns[match[1].toUpperCase()] = index;
    });
  }
  for (const profile of PROFILE_CLASSES) if (columns[profile] === undefined) fail(`no "BTN ${profile}" column`);
  return columns;
}

/**
 * Sheet rows (arrays, as from sheet_to_json with header: 1) to one record per calendar day, in
 * order: { year, month, day, values: { A: number[], B, C } }, a value per quarter-hour. Checks that
 * each day has the quarter-hours its legal time gives it (92, 96 or 100) and every value is a
 * non-negative number.
 */
export function deriveDays(rows) {
  const columns = profileColumns(rows);
  const days = [];
  for (const row of rows) {
    const serial = row[0];
    if (typeof serial !== "number") continue;
    const date = new Date(EXCEL_EPOCH + Math.round(serial) * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    if (days.at(-1)?.key !== key) {
      if (days.some((day) => day.key === key)) fail(`rows of ${key} are not together`);
      days.push({
        key,
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        values: { A: [], B: [], C: [] },
      });
    }
    for (const profile of PROFILE_CLASSES) {
      const value = row[columns[profile]];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`bad BTN ${profile} value on ${key}`);
      days.at(-1).values[profile].push(value);
    }
  }
  if (days.length === 0) fail("no data rows");
  for (const day of days) {
    const expected = quartersInLegalDay(day.year, day.month, day.day);
    if (day.values.A.length !== expected) fail(`${day.key} has ${day.values.A.length} quarter-hours, expected ${expected}`);
  }
  return days;
}

/**
 * Sums each profile's quarter-hours by schedule, cycle, month and tri-hourly period. Returns
 * { year, totals: { A: number, ... }, periods: { A: { current: { daily: [[peak, shoulder, valley] x 12] } } } }.
 * Each quarter-hour is classified by its start instant.
 */
export function aggregate(days) {
  const year = days[0].year;
  if (days.some((day) => day.year !== year)) fail("rows from more than one year");
  const expectedDays = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
  if (days.length !== expectedDays) fail(`${days.length} days, expected ${expectedDays}`);

  const periods = {};
  const totals = {};
  for (const profile of PROFILE_CLASSES) {
    totals[profile] = 0;
    periods[profile] = {};
    for (const schedule of PERIOD_SCHEDULES) {
      periods[profile][schedule] = {};
      for (const cycle of HOURLY_CYCLES) {
        periods[profile][schedule][cycle] = Array.from({ length: 12 }, () => [0, 0, 0]);
      }
    }
  }
  for (const day of days) {
    const start = legalMidnight(day.year, day.month, day.day);
    for (let quarter = 0; quarter < day.values.A.length; quarter++) {
      const instant = start + quarter * QUARTER_HOUR_MS;
      const month = legalTimeOf(instant).month - 1;
      for (const schedule of PERIOD_SCHEDULES) {
        for (const cycle of HOURLY_CYCLES) {
          const period = TRI_PERIODS.indexOf(triHourlyPeriodAt(instant, cycle, schedule));
          for (const profile of PROFILE_CLASSES) {
            periods[profile][schedule][cycle][month][period] += day.values[profile][quarter];
          }
        }
      }
      for (const profile of PROFILE_CLASSES) totals[profile] += day.values[profile][quarter];
    }
  }
  for (const profile of PROFILE_CLASSES) {
    if (Math.abs(totals[profile] - 1000) > SUM_TOLERANCE) fail(`BTN ${profile} sums to ${totals[profile]}, not 1000`);
  }
  return { year, totals, periods };
}

const round7 = (value) => Math.round(value * 1e7) / 1e7;

export function renderModule(result, { downloadedOn, sha256, url = SOURCE.url }) {
  const blocks = PROFILE_CLASSES.map((profile) => {
    const schedules = PERIOD_SCHEDULES.map((schedule) => {
      const cycles = HOURLY_CYCLES.map((cycle) => {
        const months = result.periods[profile][schedule][cycle]
          .map((triple) => `        [${triple.map(round7).join(", ")}],`)
          .join("\n");
        return `      ${cycle}: [\n${months}\n      ],`;
      }).join("\n");
      return `    ${JSON.stringify(schedule)}: {\n${cycles}\n    },`;
    }).join("\n");
    return `  ${profile}: {\n${schedules}\n  },`;
  }).join("\n");

  return `// Generated by scripts/build-electricity-profiles.mjs. Do not edit by hand: rerun the script.
//
// The BTN consumption profiles for ${result.year} (classes A, B and C), reduced to the share of the
// year's consumption in each tri-hourly period, by period schedule, hourly cycle and month. The
// method and the source are in the script header. Bi-hourly off-valley is peak plus shoulder.

import type { HourlyCycle, PeriodSchedule } from "../electricityCycles";

export const ELECTRICITY_PROFILES_SOURCE = {
  name: ${JSON.stringify(SOURCE.name.replace("injeção", `injeção ${result.year}`))},
  page: ${JSON.stringify(SOURCE.page)},
  url: ${JSON.stringify(url)},
  /** Guia de Medição, Leitura e Disponibilização de Dados: articles 68.º and 69.º define the profiles. */
  rules: ${JSON.stringify(SOURCE.rules)},
  downloadedOn: ${JSON.stringify(downloadedOn)},
  /** SHA-256 of the downloaded spreadsheet. */
  sha256: ${JSON.stringify(sha256)},
  /** The calendar year the profiles describe. */
  year: ${result.year},
  /** Bump when the derivation changes. */
  version: 1,
} as const;

export type ProfileClass = "A" | "B" | "C";

/** [peak, shoulder, valley], each in thousandths of the profile's yearly consumption. */
export type PeriodPermille = readonly [peak: number, shoulder: number, valley: number];

/** By profile class, period schedule and hourly cycle: twelve months, January first. */
export const ELECTRICITY_PROFILE_PERIODS: Record<
  ProfileClass,
  Record<PeriodSchedule, Record<HourlyCycle, readonly PeriodPermille[]>>
> = {
${blocks}
};
`;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const fromFile = option("--from-file");
  const url = option("--url") ?? SOURCE.url;
  const downloadedOn = option("--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(downloadedOn)) fail("--date must be YYYY-MM-DD");

  let buffer;
  if (fromFile) {
    buffer = readFileSync(fromFile);
  } else {
    const response = await fetch(url);
    if (!response.ok) fail(`download failed: HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const XLSX = (await import("xlsx")).default ?? (await import("xlsx"));
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.find((name) => /^\d{4}$/.test(name.trim())) ?? workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });

  const result = aggregate(deriveDays(rows));
  const out = fileURLToPath(new URL("../src/lib/calculators/data/electricityProfiles.ts", import.meta.url));
  writeFileSync(out, renderModule(result, { downloadedOn, sha256, url }));
  console.log(`Wrote the ${result.year} BTN A/B/C period shares to ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
