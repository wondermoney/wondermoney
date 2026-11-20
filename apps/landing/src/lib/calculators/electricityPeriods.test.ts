import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  ELECTRICITY_PROFILE_PERIODS,
  ELECTRICITY_PROFILES_SOURCE,
  ERedesExportError,
  parseERedesExport,
  profileClassFor,
  profileMonthShares,
  profilePeriodShares,
  readingsFromRows,
  splitByProfile,
  summarizeLoadDiagram,
  type CycleKwh,
  type PeriodBreakdown,
  type ProfileClass,
} from "./electricityPeriods";

const close = (value: number, expected: number, digits = 9) => expect(value).toBeCloseTo(expected, digits);

function expectOptionsSumTo(breakdown: PeriodBreakdown, total: number) {
  close(breakdown.simple.energy, total);
  for (const cycle of [breakdown.daily, breakdown.weekly] as CycleKwh[]) {
    close(cycle.biHourly.offValley + cycle.biHourly.valley, total);
    close(cycle.triHourly.peak + cycle.triHourly.shoulder + cycle.triHourly.valley, total);
    close(cycle.biHourly.valley, cycle.triHourly.valley);
  }
}

describe("profile class (GMLDD, article 69.º)", () => {
  it("is A above 13,8 kVA, B above 7 140 kWh a year, C otherwise", () => {
    expect(profileClassFor(17.25, 3000)).toBe("A");
    expect(profileClassFor(13.8, 7141)).toBe("B");
    expect(profileClassFor(13.8, 7140)).toBe("C");
    expect(profileClassFor(6.9, 2500)).toBe("C");
    expect(profileClassFor(6.9, undefined)).toBe("C");
  });
});

describe("profile shares", () => {
  it("records the 2026 E-REDES profile file it was built from", () => {
    expect(ELECTRICITY_PROFILES_SOURCE.year).toBe(2026);
    expect(ELECTRICITY_PROFILES_SOURCE.url).toMatch(/^https:\/\/www\.e-redes\.pt\/.*2026\.xlsx$/);
    expect(ELECTRICITY_PROFILES_SOURCE.downloadedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("covers the whole year: each profile sums to 1000 in every schedule and cycle", () => {
    for (const profile of ["A", "B", "C"] as ProfileClass[]) {
      for (const schedule of ["current", "2027"] as const) {
        for (const cycle of ["daily", "weekly"] as const) {
          const months = ELECTRICITY_PROFILE_PERIODS[profile][schedule][cycle];
          expect(months).toHaveLength(12);
          close(months.flat().reduce((a, b) => a + b, 0), 1000, 4);
        }
      }
    }
  });

  it("matches the published BTN C profile: January holds 108,5636997 thousandths of the year", () => {
    // The sum of the 2 976 January quarter-hours in column "BTN C" of
    // Perfil_Consumo_Injeção_E-REDES_2026.xlsx (rows 5 to 2980), read on 2026-11-20.
    for (const schedule of ["current", "2027"] as const) {
      for (const cycle of ["daily", "weekly"] as const) {
        const [peak, shoulder, valley] = ELECTRICITY_PROFILE_PERIODS.C[schedule][cycle][0];
        close(peak + shoulder + valley, 108.5636997, 6);
      }
    }
    // The same file's bi-hourly daily valley (22:00 to 08:00) over the year, summed independently
    // from the file's own hour labels: 322,421707 thousandths.
    close(profilePeriodShares("C").daily.biHourly.valley, 0.322421707, 6);
  });

  it("gives BTN C default shares that sum to 100 % per option, for a year, a month and the 2027 cycles", () => {
    expectOptionsSumTo(profilePeriodShares("C"), 1);
    expectOptionsSumTo(profilePeriodShares("C", { months: [8] }), 1);
    expectOptionsSumTo(profilePeriodShares("C", { months: [1, 2, 12], schedule: "2027" }), 1);
    expectOptionsSumTo(profilePeriodShares("A"), 1);
  });

  it("puts more of a household's (C) consumption in the evening peak under the 2027 cycles", () => {
    expect(profilePeriodShares("C", { schedule: "2027" }).daily.triHourly.peak).toBeGreaterThan(
      profilePeriodShares("C").daily.triHourly.peak,
    );
  });

  it("weights months by the profile", () => {
    const shares = profileMonthShares("C");
    expect(shares).toHaveLength(12);
    close(shares.reduce((a, b) => a + b, 0), 1);
    close(shares[0], 0.1085636997, 6);
  });

  it("splits a total over a year or chosen months, with the days they cover", () => {
    const year = splitByProfile(3000, "C");
    expect(year.days).toBe(365);
    expectOptionsSumTo(year, 3000);
    close(year.weekly.triHourly.peak, 3000 * profilePeriodShares("C").weekly.triHourly.peak);

    const february = splitByProfile(250, "B", { months: [2] });
    expect(february.days).toBe(28);
    expectOptionsSumTo(february, 250);
    expect(splitByProfile(0, "C").daily.biHourly.valley).toBe(0);
  });

  it("rejects bad input", () => {
    expect(() => splitByProfile(-1, "C")).toThrow(RangeError);
    expect(() => splitByProfile(Number.NaN, "C")).toThrow(RangeError);
    expect(() => profilePeriodShares("C", { months: [] })).toThrow(RangeError);
    expect(() => profilePeriodShares("C", { months: [13] })).toThrow(RangeError);
  });
});

// A synthetic export in the layout E-REDES documents (Data, Hora at the end of each quarter-hour,
// "<diagram>, Ativa (kW)" columns, average kW). The readings are made up: a steady 0,4 kW, so every
// quarter-hour is 0,1 kWh.
const HEADER = ["Data", "Hora", "Consumo registado, Ativa (kW)", "Injeção registada, Ativa (kW)"];
const PREAMBLE = [["Diagrama de carga"], ["Instalação", "PT0000000000000000XX"], []];

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** End-of-quarter labels of a day: 00:15 ... 24:00, with the clock change applied. */
function dayLabels(kind: "normal" | "spring" | "autumn"): string[] {
  const ends = Array.from({ length: 96 }, (_, i) => (i + 1) * 15);
  if (kind === "spring") return ends.filter((m) => m <= 60 || m > 120).map(hhmm); // 01:15 to 02:00 skipped
  if (kind === "autumn") {
    const labels = ends.map(hhmm);
    return [...labels.slice(0, 8), "01:15", "01:30", "01:45", "02:00", ...labels.slice(8)]; // repeated hour
  }
  return ends.map(hhmm);
}

function dayRows(date: string, kind: "normal" | "spring" | "autumn", kw: number | string = "0,4"): unknown[][] {
  return dayLabels(kind).map((label) => [date, label, kw, 0]);
}

function workbookBytes(rows: unknown[][]): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Consumos");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
}

describe("E-REDES load diagram", () => {
  it("reads an export with a winter weekday and both clock-change days", async () => {
    const bytes = workbookBytes([
      ...PREAMBLE,
      HEADER,
      ...dayRows("2026/01/14", "normal"),
      ...dayRows("2026/03/29", "spring"),
      ...dayRows("2026/10/25", "autumn", 0.4),
    ]);
    const readings = await parseERedesExport(bytes);
    expect(readings).toHaveLength(96 + 92 + 100);
    expect(readings[0]).toEqual({ start: Date.UTC(2026, 0, 14), kwh: 0.1 });

    const summary = summarizeLoadDiagram(readings);
    expect(summary.days).toBe(3);
    expect(summary.readings).toBe(288);
    expect([summary.firstDay, summary.lastDay]).toEqual(["2026-01-14", "2026-10-25"]);
    close(summary.simple.energy, 28.8);
    expect(summary.months.map((m) => [m.month, m.days, Math.round(m.kwh * 10) / 10])).toEqual([
      ["2026-01", 1, 9.6],
      ["2026-03", 1, 9.2],
      ["2026-10", 1, 10],
    ]);
    // Daily cycle: the weekday has 4 h peak, 10 h shoulder, 10 h valley; each Sunday adds 4 h peak
    // and 10 h shoulder, the rest valley (9 h in March, 11 h in October).
    close(summary.daily.triHourly.peak, 4.8);
    close(summary.daily.triHourly.shoulder, 12);
    close(summary.daily.triHourly.valley, 4 + 3.6 + 4.4);
    close(summary.daily.biHourly.offValley, 16.8);
    // Weekly cycle: Sundays are all valley; the winter weekday has 5 h peak and 12 h shoulder.
    close(summary.weekly.triHourly.peak, 2);
    close(summary.weekly.triHourly.shoulder, 4.8);
    close(summary.weekly.biHourly.valley, 2.8 + 9.2 + 10);
    // The quarter-hours between the days are missing, not zero.
    expect(summary.missingQuarters).toBeGreaterThan(0);
  });

  it("places the repeated October hour in order, summer time first", () => {
    const readings = readingsFromRows([HEADER, ...dayRows("2026/10/25", "autumn")]);
    const starts = readings.map((r) => r.start);
    expect(new Set(starts).size).toBe(100);
    expect(starts[4]).toBe(Date.UTC(2026, 9, 25, 0)); // 01:00 summer time
    expect(starts[8]).toBe(Date.UTC(2026, 9, 25, 1)); // 01:00 winter time
    expect(starts[99]).toBe(Date.UTC(2026, 9, 25, 23, 45));
  });

  it("reads a partial change day by its labels", () => {
    const readings = readingsFromRows([
      HEADER,
      ["2026/10/25", "01:15", 1, 0],
      ["2026/10/25", "01:15", 2, 0],
      ["2026/03/29", "01:00", 1, 0],
      ["2026/03/29", "02:15", 1, 0],
    ]);
    expect(readings.map((r) => r.start)).toEqual([
      Date.UTC(2026, 2, 29, 0, 45),
      Date.UTC(2026, 2, 29, 1, 0),
      Date.UTC(2026, 9, 25, 0, 0),
      Date.UTC(2026, 9, 25, 1, 0),
    ]);
  });

  it("accepts the last quarter-hour as 00:00 of the next day, Excel dates and times, and kWh columns", () => {
    const labels = dayLabels("normal");
    const rows: unknown[][] = [["Data", "Hora", "Consumo registado (kWh)"]];
    // 2026-07-15 is Excel day 46218; times as day fractions.
    labels.slice(0, 95).forEach((label) => {
      const [h, m] = label.split(":").map(Number);
      rows.push([46218, (h * 60 + m) / 1440, 0.25]);
    });
    rows.push(["16-07-2026", "00:00", "0,25"]);
    const summary = summarizeLoadDiagram(readingsFromRows(rows));
    expect(summary.days).toBe(1);
    expect(summary.missingQuarters).toBe(0);
    close(summary.simple.energy, 24);
    // Summer weekday, weekly cycle: 3 h peak, 14 h shoulder, 7 h valley.
    close(summary.weekly.triHourly.peak, 3);
    close(summary.weekly.triHourly.shoulder, 14);
    close(summary.weekly.triHourly.valley, 7);
  });

  it("keeps the readings of a day with every quarter-hour in file order, whatever the labels", () => {
    // E-REDES's own profile files label the fourth quarter-hour of 29 March "02:00".
    const labels = ["00:15", "00:30", "00:45", "02:00", ...dayLabels("spring").slice(4)];
    const readings = readingsFromRows([HEADER, ...labels.map((label) => ["2026/03/29", label, 0.4, 0])]);
    expect(readings).toHaveLength(92);
    expect(readings[3].start).toBe(Date.UTC(2026, 2, 29, 0, 45));
    expect(readings[4].start).toBe(Date.UTC(2026, 2, 29, 1, 0));
  });

  it("skips quarter-hours without a value and counts them as missing", () => {
    const rows = [HEADER, ...dayRows("2026/01/14", "normal")];
    rows[10][2] = "";
    rows[11][2] = null;
    const summary = summarizeLoadDiagram(readingsFromRows(rows));
    expect(summary.readings).toBe(94);
    expect(summary.missingQuarters).toBe(2);
  });

  it("rejects files that are not E-REDES exports", async () => {
    const other = workbookBytes([["Date", "Description", "Amount"], ["2026-01-01", "Groceries", "-12,30"]]);
    await expect(parseERedesExport(other)).rejects.toMatchObject({ code: "notERedesExport" });
    await expect(parseERedesExport(other)).rejects.toThrow(/not an E-REDES consumption export/);
    await expect(parseERedesExport(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]))).rejects.toBeInstanceOf(
      ERedesExportError,
    );
    await expect(parseERedesExport(workbookBytes([HEADER]))).rejects.toMatchObject({ code: "noReadings" });
  });

  it("rejects bad rows and duplicate quarter-hours with the row number", () => {
    expect(() => readingsFromRows([HEADER, ["2026/01/14", "00:15", 0.4, 0], ["2026/13/40", "00:30", 0.4, 0]])).toThrow(
      expect.objectContaining({ code: "invalidRow", row: 3 }),
    );
    expect(() => readingsFromRows([HEADER, ["2026/01/14", "00:10", 0.4, 0]])).toThrow(
      expect.objectContaining({ code: "invalidRow" }),
    );
    expect(() => readingsFromRows([HEADER, ["2026/01/14", "00:15", "abc", 0]])).toThrow(
      expect.objectContaining({ code: "invalidRow" }),
    );
    expect(() => readingsFromRows([HEADER, ["2026/01/14", "00:15", 0.4, 0], ["2026/01/14", "00:15", 0.4, 0]])).toThrow(
      expect.objectContaining({ code: "duplicateReading", row: 3 }),
    );
  });

  it("uses the 2027 cycles when asked", () => {
    const readings = readingsFromRows([HEADER, ...dayRows("2026/01/14", "normal")]);
    const summary = summarizeLoadDiagram(readings, "2027");
    expect(summary.schedule).toBe("2027");
    close(summary.daily.triHourly.peak, 1.6); // 17:30 to 21:30
    close(summary.weekly.triHourly.peak, 2); // 17:00 to 22:00
  });
});
