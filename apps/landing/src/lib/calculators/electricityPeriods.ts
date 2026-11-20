// How a household's kWh split across the tariff periods, for the electricity tariff comparison.
// Pure: three ways in, one shape out (PeriodKwh), keyed the way the comparison engine reads it.
//
// 1. Cycles: which period each quarter-hour is in (electricityCycles.ts, re-exported here).
// 2. Profiles: the default split when only the total kWh is known, from the 2026 BTN consumption
//    profiles (data/electricityProfiles.ts). The class follows ERSE's Guia de Medição, Leitura e
//    Disponibilização de Dados (Regulamento n.º 987/2025), article 69.º: class A above 13,8 kVA;
//    at or below it, class B above 7 140 kWh a year and class C otherwise.
// 3. E-REDES load diagram: the "consumos" spreadsheet a customer downloads from Balcão Digital,
//    read in the browser. The file never leaves the browser. Its layout follows E-REDES's own
//    description (see E_REDES_EXPORT_LAYOUT).

import {
  instantsOfLegalTime,
  legalMidnight,
  legalTimeOf,
  QUARTER_HOUR_MS,
  quartersInLegalDay,
  triHourlyPeriodAt,
  type HourlyCycle,
  type PeriodSchedule,
} from "./electricityCycles";
import {
  ELECTRICITY_PROFILE_PERIODS,
  ELECTRICITY_PROFILES_SOURCE,
  type PeriodPermille,
  type ProfileClass,
} from "./data/electricityProfiles";

export * from "./electricityCycles";
export { ELECTRICITY_PROFILE_PERIODS, ELECTRICITY_PROFILES_SOURCE };
export type { PeriodPermille, ProfileClass };

/** Simple option: one energy price. */
export interface SimpleKwh {
  energy: number;
}
/** Bi-hourly option: "fora de vazio" and "vazio". */
export interface BiHourlyKwh {
  offValley: number;
  valley: number;
}
/** Tri-hourly option: "ponta", "cheias" and "vazio". */
export interface TriHourlyKwh {
  peak: number;
  shoulder: number;
  valley: number;
}
/** One hourly cycle, both multi-period options. */
export interface CycleKwh {
  biHourly: BiHourlyKwh;
  triHourly: TriHourlyKwh;
}
/** kWh (or shares) per period, for every option and cycle. */
export interface PeriodBreakdown {
  simple: SimpleKwh;
  daily: CycleKwh;
  weekly: CycleKwh;
}
/** kWh per period over a stretch of `days` calendar days: the comparison engine's input. */
export interface PeriodKwh extends PeriodBreakdown {
  days: number;
}

const DAY_MS = 86_400_000;

function cycleFrom([peak, shoulder, valley]: readonly [number, number, number]): CycleKwh {
  return {
    biHourly: { offValley: peak + shoulder, valley },
    triHourly: { peak, shoulder, valley },
  };
}

function scaleBreakdown(breakdown: PeriodBreakdown, factor: number): PeriodBreakdown {
  const scaleCycle = (cycle: CycleKwh): CycleKwh => ({
    biHourly: { offValley: cycle.biHourly.offValley * factor, valley: cycle.biHourly.valley * factor },
    triHourly: {
      peak: cycle.triHourly.peak * factor,
      shoulder: cycle.triHourly.shoulder * factor,
      valley: cycle.triHourly.valley * factor,
    },
  });
  return {
    simple: { energy: breakdown.simple.energy * factor },
    daily: scaleCycle(breakdown.daily),
    weekly: scaleCycle(breakdown.weekly),
  };
}

// ---------------------------------------------------------------------------------------------
// Profiles

/** Above this contracted power, class A (GMLDD, article 69.º, n.º 1). */
export const PROFILE_A_MIN_KVA = 13.8;
/** At or below 13,8 kVA, class B above this annual consumption, class C at or below it. */
export const PROFILE_B_MIN_ANNUAL_KWH = 7140;

/**
 * The BTN profile class of an installation (GMLDD, article 69.º): from the contracted power and
 * the last 12 months' kWh. Without a consumption history, pass undefined: class C at or below
 * 13,8 kVA (n.º 4).
 */
export function profileClassFor(contractedPowerKva: number, annualKwh: number | undefined): ProfileClass {
  if (contractedPowerKva > PROFILE_A_MIN_KVA) return "A";
  if (annualKwh === undefined) return "C";
  return annualKwh > PROFILE_B_MIN_ANNUAL_KWH ? "B" : "C";
}

export interface ProfileOptions {
  /** Months to cover, 1 to 12. Defaults to the whole year. */
  months?: readonly number[];
  schedule?: PeriodSchedule;
}

function selectedMonths(months: readonly number[] | undefined): number[] {
  const list = months ?? Array.from({ length: 12 }, (_, i) => i + 1);
  if (list.length === 0) throw new RangeError("No months selected");
  for (const month of list) {
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`Bad month ${month}`);
  }
  return [...new Set(list)];
}

function profileTotals(profile: ProfileClass, months: readonly number[], schedule: PeriodSchedule, cycle: HourlyCycle) {
  const table = ELECTRICITY_PROFILE_PERIODS[profile][schedule][cycle];
  const sum: [number, number, number] = [0, 0, 0];
  for (const month of months) table[month - 1].forEach((value, i) => (sum[i] += value));
  return sum;
}

/**
 * Each month's share of the profile's yearly consumption, January first. The twelve sum to 1.
 */
export function profileMonthShares(profile: ProfileClass): number[] {
  const months = ELECTRICITY_PROFILE_PERIODS[profile].current.daily.map((m) => m[0] + m[1] + m[2]);
  const year = months.reduce((a, b) => a + b, 0);
  return months.map((month) => month / year);
}

/**
 * The default share of consumption in each period, as fractions: every option sums to 1. From
 * the profile's quarter-hours in the selected months.
 */
export function profilePeriodShares(profile: ProfileClass, options: ProfileOptions = {}): PeriodBreakdown {
  const months = selectedMonths(options.months);
  const schedule = options.schedule ?? "current";
  const share = (cycle: HourlyCycle) => {
    const sum = profileTotals(profile, months, schedule, cycle);
    const total = sum[0] + sum[1] + sum[2];
    return cycleFrom([sum[0] / total, sum[1] / total, sum[2] / total]);
  };
  return { simple: { energy: 1 }, daily: share("daily"), weekly: share("weekly") };
}

/**
 * Splits a total kWh across the periods with a profile: `kwh` is the consumption over the selected
 * months (the whole year by default). `days` is the number of days in those months in the profile's
 * year.
 */
export function splitByProfile(kwh: number, profile: ProfileClass, options: ProfileOptions = {}): PeriodKwh {
  if (!Number.isFinite(kwh) || kwh < 0) throw new RangeError("kWh must be a non-negative number");
  const months = selectedMonths(options.months);
  const year = ELECTRICITY_PROFILES_SOURCE.year;
  const days = months.reduce((sum, month) => sum + new Date(Date.UTC(year, month, 0)).getUTCDate(), 0);
  return { days, ...scaleBreakdown(profilePeriodShares(profile, { ...options, months }), kwh) };
}

// ---------------------------------------------------------------------------------------------
// Load diagram (E-REDES Balcão Digital export)

/** One quarter-hour of consumption. */
export interface LoadReading {
  /** UTC instant the quarter-hour starts, in ms. */
  start: number;
  kwh: number;
}

export interface MonthTotal {
  /** "YYYY-MM", in legal time. */
  month: string;
  /** Calendar days of that month with at least one reading. */
  days: number;
  kwh: number;
}

export interface LoadDiagramSummary extends PeriodKwh {
  /** First and last calendar day with a reading, "YYYY-MM-DD" in legal time. */
  firstDay: string;
  lastDay: string;
  readings: number;
  /** Quarter-hours between the first and the last reading that have no value. */
  missingQuarters: number;
  months: MonthTotal[];
  schedule: PeriodSchedule;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Adds up 15-minute readings by period, for both cycles. `days` counts the calendar days with at
 * least one reading.
 */
export function summarizeLoadDiagram(readings: readonly LoadReading[], schedule: PeriodSchedule = "current"): LoadDiagramSummary {
  if (readings.length === 0) throw new RangeError("No readings");
  const sorted = [...readings].sort((a, b) => a.start - b.start);
  const tri: Record<HourlyCycle, [number, number, number]> = { daily: [0, 0, 0], weekly: [0, 0, 0] };
  const index = { peak: 0, shoulder: 1, valley: 2 } as const;
  const days = new Set<string>();
  const months = new Map<string, { days: Set<string>; kwh: number }>();
  let energy = 0;
  for (const { start, kwh } of sorted) {
    energy += kwh;
    for (const cycle of ["daily", "weekly"] as const) tri[cycle][index[triHourlyPeriodAt(start, cycle, schedule)]] += kwh;
    const time = legalTimeOf(start);
    const month = `${time.year}-${pad(time.month)}`;
    const day = `${month}-${pad(time.day)}`;
    days.add(day);
    const entry = months.get(month) ?? { days: new Set<string>(), kwh: 0 };
    entry.days.add(day);
    entry.kwh += kwh;
    months.set(month, entry);
  }
  const ordered = [...days].sort();
  const span = (sorted.at(-1)!.start - sorted[0].start) / QUARTER_HOUR_MS + 1;
  return {
    days: days.size,
    simple: { energy },
    daily: cycleFrom(tri.daily),
    weekly: cycleFrom(tri.weekly),
    firstDay: ordered[0],
    lastDay: ordered.at(-1)!,
    readings: sorted.length,
    missingQuarters: span - new Set(sorted.map((r) => r.start)).size,
    months: [...months].map(([month, entry]) => ({ month, days: entry.days.size, kwh: entry.kwh })),
    schedule,
  };
}

/**
 * The column mapping of the Balcão Digital "consumos" export. E-REDES describes the file in
 * "Cálculo dos consumos/injeção no autoconsumo coletivo" (August 2024): a table with a "Data"
 * column (e.g. 2024/05/26), an "Hora" column holding the end of each quarter-hour (00:15 is the
 * first), and one column per diagram named "<diagram>, Ativa (kW)", each value the average power
 * over the quarter-hour, so kWh = kW / 4. The consumption diagram is "Consumo registado, Ativa (kW)".
 * https://e-redes.pt/sites/eredes/files/2024-08/E-REDES%20-%20Calculo%20dos%20consumos-injecao%20no%20autoconsumo%20coletivo_vfinal.pdf
 * The headers are matched loosely (case, accents and spacing are ignored); edit the patterns here
 * if E-REDES renames a column.
 */
export const E_REDES_EXPORT_LAYOUT = {
  date: [/^data$/, /^dia$/, /^data e hora$/, /^data\/hora$/],
  time: [/^hora$/, /^hora fim$/],
  /** In order of preference. */
  consumption: [/^consumo registado/, /^consumo medido/, /^consumo/],
  /** Rows searched for the header row. */
  headerSearchRows: 40,
} as const;

export type ERedesExportErrorCode =
  | "unreadable"
  | "notERedesExport"
  | "noReadings"
  | "invalidRow"
  | "duplicateReading";

/** Why an uploaded file could not be read. `code` is for the page's localized message. */
export class ERedesExportError extends Error {
  readonly code: ERedesExportErrorCode;
  /** 1-based spreadsheet row, for row errors. */
  readonly row?: number;

  constructor(code: ERedesExportErrorCode, message: string, row?: number) {
    super(message);
    this.name = "ERedesExportError";
    this.code = code;
    this.row = row;
  }
}

function normalize(cell: unknown): string {
  return String(cell ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface ColumnMap {
  headerRow: number;
  date: number;
  time: number | undefined;
  value: number;
  /** Divide by 4 for kW columns; 1 for a kWh column. */
  divisor: number;
}

function findColumns(rows: readonly (readonly unknown[])[]): ColumnMap | undefined {
  const find = (cells: string[], patterns: readonly RegExp[]) => {
    for (const pattern of patterns) {
      const index = cells.findIndex((cell) => pattern.test(cell));
      if (index !== -1) return index;
    }
    return -1;
  };
  for (let r = 0; r < Math.min(rows.length, E_REDES_EXPORT_LAYOUT.headerSearchRows); r++) {
    const cells = (rows[r] ?? []).map(normalize);
    const date = find(cells, E_REDES_EXPORT_LAYOUT.date);
    const value = find(cells, E_REDES_EXPORT_LAYOUT.consumption);
    if (date === -1 || value === -1) continue;
    const unit = /\(kwh\)/.test(cells[value]) ? "kwh" : /\(kw\)/.test(cells[value]) ? "kw" : undefined;
    if (!unit) continue;
    const time = find(cells, E_REDES_EXPORT_LAYOUT.time);
    return { headerRow: r, date, time: time === -1 ? undefined : time, value, divisor: unit === "kw" ? 4 : 1 };
  }
  return undefined;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

function validDate(year: number, month: number, day: number): CivilDate | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return { year, month, day };
}

/** A date cell, and the time of day in minutes if the cell carries one. */
function parseDateCell(cell: unknown): { date: CivilDate; minutes?: number } | undefined {
  if (typeof cell === "number" && Number.isFinite(cell)) {
    const whole = Math.floor(cell);
    const date = new Date(EXCEL_EPOCH + whole * DAY_MS);
    const fraction = Math.round((cell - whole) * 1440);
    return {
      date: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() },
      minutes: fraction > 0 ? fraction : undefined,
    };
  }
  if (typeof cell !== "string") return undefined;
  const text = cell.trim();
  const time = /[ T](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  const datePart = time ? text.slice(0, time.index) : text;
  const minutes = time ? Number(time[1]) * 60 + Number(time[2]) : undefined;
  let match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(datePart);
  if (match) {
    const date = validDate(Number(match[1]), Number(match[2]), Number(match[3]));
    return date && { date, minutes };
  }
  match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(datePart);
  if (match) {
    const date = validDate(Number(match[3]), Number(match[2]), Number(match[1]));
    return date && { date, minutes };
  }
  return undefined;
}

/** "HH:MM" (an optional suffix such as the "a" E-REDES gives repeated hours is ignored), or an Excel time. */
function parseTimeCell(cell: unknown): number | undefined {
  if (typeof cell === "number" && Number.isFinite(cell) && cell >= 0 && cell <= 1) return Math.round(cell * 1440);
  if (typeof cell !== "string") return undefined;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*[a-z]?$/i.exec(cell.trim());
  if (!match) return undefined;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes <= 1440 ? minutes : undefined;
}

function parseNumberCell(cell: unknown): number | undefined {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : undefined;
  if (typeof cell !== "string") return undefined;
  const text = cell.trim().replace(/\s/g, "");
  if (text === "") return undefined;
  // Portuguese decimals use a comma; a dot is accepted too.
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  return Number(normalized);
}

function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

interface RawReading {
  row: number;
  /** Legal-time calendar day and minute the quarter-hour starts. */
  date: CivilDate;
  startMinute: number;
  kwh: number;
}

/**
 * Assigns each reading its UTC start. A day with all its quarter-hours (92, 96 or 100) is placed
 * in file order from legal midnight, whatever its labels say about the clock change. Other days go
 * by their labels, the repeated October hour taking summer time first.
 */
function placeReadings(raw: readonly RawReading[]): LoadReading[] {
  const byDay = new Map<string, RawReading[]>();
  for (const reading of raw) {
    const key = `${reading.date.year}-${pad(reading.date.month)}-${pad(reading.date.day)}`;
    const list = byDay.get(key) ?? [];
    list.push(reading);
    byDay.set(key, list);
  }
  const placed: LoadReading[] = [];
  const seen = new Map<number, number>();
  const add = (start: number, reading: RawReading) => {
    const previous = seen.get(start);
    if (previous !== undefined) {
      throw new ERedesExportError(
        "duplicateReading",
        `Rows ${previous} and ${reading.row} are the same quarter-hour`,
        reading.row,
      );
    }
    seen.set(start, reading.row);
    placed.push({ start, kwh: reading.kwh });
  };
  for (const list of byDay.values()) {
    const { year, month, day } = list[0].date;
    if (list.length === quartersInLegalDay(year, month, day)) {
      const midnight = legalMidnight(year, month, day);
      list.forEach((reading, i) => add(midnight + i * QUARTER_HOUR_MS, reading));
      continue;
    }
    const occurrences = new Map<number, number>();
    for (const reading of list) {
      const instants = instantsOfLegalTime(year, month, day, reading.startMinute);
      const n = occurrences.get(reading.startMinute) ?? 0;
      occurrences.set(reading.startMinute, n + 1);
      // The hour skipped in March has no instant: read it as winter time.
      const start = instants[Math.min(n, instants.length - 1)] ?? Date.UTC(year, month - 1, day, 0, reading.startMinute);
      add(start, reading);
    }
  }
  return placed.sort((a, b) => a.start - b.start);
}

/** Rows (arrays, as from sheet_to_json with header: 1) of an E-REDES export to readings. */
export function readingsFromRows(rows: readonly (readonly unknown[])[]): LoadReading[] {
  const columns = findColumns(rows);
  if (!columns) {
    throw new ERedesExportError(
      "notERedesExport",
      'This is not an E-REDES consumption export: no "Data" column next to a consumption column in kW.',
    );
  }
  const raw: RawReading[] = [];
  for (let r = columns.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const dateCell = row[columns.date];
    const valueCell = row[columns.value];
    const timeCell = columns.time === undefined ? undefined : row[columns.time];
    const blank = (cell: unknown) => cell === null || cell === undefined || String(cell).trim() === "";
    if (blank(dateCell) && blank(timeCell) && blank(valueCell)) continue;
    const rowNumber = r + 1;
    const parsed = parseDateCell(dateCell);
    const endMinute = columns.time === undefined ? parsed?.minutes : parseTimeCell(timeCell);
    if (!parsed || endMinute === undefined || endMinute % 15 !== 0) {
      throw new ERedesExportError("invalidRow", `Row ${rowNumber} has no valid date and quarter-hour`, rowNumber);
    }
    if (blank(valueCell)) continue; // a quarter-hour without a reading
    const value = parseNumberCell(valueCell);
    if (value === undefined || value < 0) {
      throw new ERedesExportError("invalidRow", `Row ${rowNumber} has no valid consumption`, rowNumber);
    }
    // The time is the end of the quarter-hour: 00:15 is the first of the day, 00:00 or 24:00 the last.
    const start = endMinute === 0 ? 1440 - 15 : endMinute - 15;
    raw.push({
      row: rowNumber,
      date: endMinute === 0 ? addDays(parsed.date, -1) : parsed.date,
      startMinute: start,
      kwh: value / columns.divisor,
    });
  }
  if (raw.length === 0) throw new ERedesExportError("noReadings", "The file has no consumption readings");
  return placeReadings(raw);
}

/**
 * Reads an E-REDES Balcão Digital "consumos" export (xlsx, or the same table as csv) in the
 * browser. Loads the spreadsheet library on first use. Throws ERedesExportError.
 */
export async function parseERedesExport(data: ArrayBuffer | Uint8Array): Promise<LoadReading[]> {
  const { read, utils } = await import("xlsx");
  let rows: unknown[][];
  try {
    const workbook = read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("no sheet");
    rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  } catch {
    throw new ERedesExportError("unreadable", "The file could not be read as a spreadsheet");
  }
  return readingsFromRows(rows);
}
