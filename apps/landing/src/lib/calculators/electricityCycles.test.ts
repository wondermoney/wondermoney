import { describe, expect, it } from "vitest";
import {
  biHourlyPeriodAt,
  instantsOfLegalTime,
  isSummerTime,
  legalMidnight,
  legalTimeOf,
  quartersInLegalDay,
  triHourlyPeriodAt,
  type HourlyCycle,
  type PeriodSchedule,
} from "./electricityCycles";

const QUARTER = 15 * 60_000;
const LETTER = { peak: "P", shoulder: "S", valley: "V" } as const;

/** The day's 96 tri-hourly periods as 24 groups of four letters, one group per hour. */
function dayPattern(date: string, cycle: HourlyCycle, schedule: PeriodSchedule = "current"): string {
  const [year, month, day] = date.split("-").map(Number);
  const start = legalMidnight(year, month, day);
  const letters = Array.from({ length: 96 }, (_, q) => LETTER[triHourlyPeriodAt(start + q * QUARTER, cycle, schedule)]);
  return Array.from({ length: 24 }, (_, h) => letters.slice(h * 4, h * 4 + 4).join("")).join(" ");
}

/** Builds the expected pattern from "hour:group" overrides on an all-valley day. */
function hours(overrides: Record<number, string>): string {
  return Array.from({ length: 24 }, (_, h) => overrides[h] ?? "VVVV").join(" ");
}

const S = "SSSS";
const P = "PPPP";

// Expected hours, written out from the official tables (see electricityCycles.ts for the citations):
// weekly cycle, Despacho n.º 26 126-A/2004, annex II.5; daily cycle, ERSE, ciclo diário para 2009,
// Quadro 8-1. Winter days are in January 2026, summer days in July 2026 (Wed, Sat, Sun).
const CURRENT = {
  weekly: {
    "2026-01-14": hours({ 7: S, 8: S, 9: "SSPP", 10: P, 11: P, 12: S, 13: S, 14: S, 15: S, 16: S, 17: S, 18: "SSPP", 19: P, 20: P, 21: S, 22: S, 23: S }),
    "2026-01-17": hours({ 9: "VVSS", 10: S, 11: S, 12: S, 18: "VVSS", 19: S, 20: S, 21: S }),
    "2026-01-18": hours({}),
    "2026-07-15": hours({ 7: S, 8: S, 9: "SPPP", 10: P, 11: P, 12: "PSSS", 13: S, 14: S, 15: S, 16: S, 17: S, 18: S, 19: S, 20: S, 21: S, 22: S, 23: S }),
    "2026-07-18": hours({ 9: S, 10: S, 11: S, 12: S, 13: S, 20: S, 21: S }),
    "2026-07-19": hours({}),
  },
  daily: {
    "2026-01-14": hours({ 8: S, 9: P, 10: "PPSS", 11: S, 12: S, 13: S, 14: S, 15: S, 16: S, 17: S, 18: P, 19: P, 20: "PPSS", 21: S }),
    "2026-07-15": hours({ 8: S, 9: S, 10: "SSPP", 11: P, 12: P, 13: S, 14: S, 15: S, 16: S, 17: S, 18: S, 19: "SSPP", 20: P, 21: S }),
  },
};

describe("legal time in mainland Portugal (Decreto-Lei n.º 17/96)", () => {
  it("switches at 01:00 UTC on the last Sundays of March and October", () => {
    expect(isSummerTime(Date.UTC(2026, 2, 29, 0, 59))).toBe(false);
    expect(isSummerTime(Date.UTC(2026, 2, 29, 1, 0))).toBe(true);
    expect(isSummerTime(Date.UTC(2026, 9, 25, 0, 59))).toBe(true);
    expect(isSummerTime(Date.UTC(2026, 9, 25, 1, 0))).toBe(false);
    expect(isSummerTime(Date.UTC(2027, 2, 28, 1, 0))).toBe(true);
  });

  it("reads wall-clock time, weekday and season from an instant", () => {
    expect(legalTimeOf(Date.UTC(2026, 6, 15, 8, 15))).toEqual({
      year: 2026, month: 7, day: 15, weekday: 3, minuteOfDay: 9 * 60 + 15, season: "summer",
    });
    // 23:30 UTC on Saturday 31 October is still Saturday in winter time.
    expect(legalTimeOf(Date.UTC(2026, 9, 31, 23, 30)).weekday).toBe(6);
    // 23:30 UTC on Friday 17 July is 00:30 on Saturday in summer time.
    expect(legalTimeOf(Date.UTC(2026, 6, 17, 23, 30))).toMatchObject({ day: 18, weekday: 6, minuteOfDay: 30 });
  });

  it("has 92 quarter-hours on the March change day and 100 on the October one", () => {
    expect(quartersInLegalDay(2026, 3, 29)).toBe(92);
    expect(quartersInLegalDay(2026, 10, 25)).toBe(100);
    expect(quartersInLegalDay(2026, 7, 15)).toBe(96);
    expect(legalMidnight(2026, 10, 25)).toBe(Date.UTC(2026, 9, 24, 23));
  });

  it("maps wall-clock times to instants, twice in the repeated hour and never in the skipped one", () => {
    expect(instantsOfLegalTime(2026, 10, 25, 90)).toEqual([Date.UTC(2026, 9, 25, 0, 30), Date.UTC(2026, 9, 25, 1, 30)]);
    expect(instantsOfLegalTime(2026, 3, 29, 90)).toEqual([]);
    expect(instantsOfLegalTime(2026, 3, 29, 120)).toEqual([Date.UTC(2026, 2, 29, 1)]);
    expect(instantsOfLegalTime(2026, 1, 14, 600)).toEqual([Date.UTC(2026, 0, 14, 10)]);
  });
});

describe("BTN cycles in force (schedule 'current')", () => {
  for (const [date, expected] of Object.entries(CURRENT.weekly)) {
    it(`weekly cycle on ${date}`, () => expect(dayPattern(date, "weekly")).toBe(expected));
  }
  for (const [date, expected] of Object.entries(CURRENT.daily)) {
    it(`daily cycle on ${date}`, () => expect(dayPattern(date, "daily")).toBe(expected));
  }

  it("uses the same daily cycle on Saturdays and Sundays as on weekdays", () => {
    expect(dayPattern("2026-01-17", "daily")).toBe(CURRENT.daily["2026-01-14"]);
    expect(dayPattern("2026-01-18", "daily")).toBe(CURRENT.daily["2026-01-14"]);
    expect(dayPattern("2026-07-18", "daily")).toBe(CURRENT.daily["2026-07-15"]);
    expect(dayPattern("2026-07-19", "daily")).toBe(CURRENT.daily["2026-07-15"]);
  });

  it("treats a national holiday as an ordinary weekday (Christmas 2026 is a Friday)", () => {
    expect(dayPattern("2026-12-25", "weekly")).toBe(CURRENT.weekly["2026-01-14"]);
  });

  it("matches the hours per day of the Regulamento Tarifário, Quadros 8.1 and 8.2", () => {
    const count = (pattern: string, letter: string) => pattern.split("").filter((c) => c === letter).length / 4;
    const w = CURRENT.weekly;
    expect([count(w["2026-01-14"], "P"), count(w["2026-01-14"], "S")]).toEqual([5, 12]);
    expect([count(w["2026-07-15"], "P"), count(w["2026-07-15"], "S")]).toEqual([3, 14]);
    expect([count(w["2026-01-17"], "S"), count(w["2026-07-18"], "S")]).toEqual([7, 7]);
    for (const day of Object.values(CURRENT.daily)) expect([count(day, "P"), count(day, "S")]).toEqual([4, 10]);
  });

  it("gives bi-hourly valley exactly where tri-hourly is valley", () => {
    const start = legalMidnight(2026, 1, 17);
    for (let q = 0; q < 96; q++) {
      const instant = start + q * QUARTER;
      const tri = triHourlyPeriodAt(instant, "weekly");
      expect(biHourlyPeriodAt(instant, "weekly")).toBe(tri === "valley" ? "valley" : "offValley");
    }
    // Bi-hourly weekly: weekdays are valley from 00:00 to 07:00 all year.
    expect(biHourlyPeriodAt(Date.UTC(2026, 6, 15, 5, 45), "weekly")).toBe("valley"); // 06:45 summer
    expect(biHourlyPeriodAt(Date.UTC(2026, 6, 15, 6, 0), "weekly")).toBe("offValley"); // 07:00 summer
    // Bi-hourly daily: valley from 22:00 to 08:00 all year.
    expect(biHourlyPeriodAt(Date.UTC(2026, 0, 14, 22), "daily")).toBe("valley");
    expect(biHourlyPeriodAt(Date.UTC(2026, 6, 15, 20, 45), "daily")).toBe("offValley"); // 21:45 summer
  });

  it("reads periods across the clock changes", () => {
    // 29 March 2026, 01:00 UTC is 02:00 summer time on a Sunday: valley in both cycles.
    expect(triHourlyPeriodAt(Date.UTC(2026, 2, 29, 1), "weekly")).toBe("valley");
    // Monday 30 March, 08:15 UTC is 09:15 summer time: the summer weekday peak has started.
    expect(triHourlyPeriodAt(Date.UTC(2026, 2, 30, 8, 15), "weekly")).toBe("peak");
    // Monday 26 October, 09:15 UTC is 09:15 winter time: still shoulder until 09:30.
    expect(triHourlyPeriodAt(Date.UTC(2026, 9, 26, 9, 15), "weekly")).toBe("shoulder");
    expect(triHourlyPeriodAt(new Date(Date.UTC(2026, 9, 26, 9, 30)), "weekly")).toBe("peak");
  });
});

describe("BTN cycles of Diretiva n.º 3/2026 (schedule '2027')", () => {
  it("weekly cycle: weekdays, Saturdays and Sundays in winter and summer", () => {
    expect(dayPattern("2026-01-14", "weekly", "2027")).toBe(
      hours({ 0: "SSVV", 7: "VVSS", 8: S, 9: S, 10: S, 11: S, 12: S, 13: S, 14: S, 15: S, 16: S, 17: P, 18: P, 19: P, 20: P, 21: P, 22: S, 23: S }),
    );
    expect(dayPattern("2026-07-15", "weekly", "2027")).toBe(
      hours({ 0: "SSVV", 7: "VVSS", 8: S, 9: S, 10: S, 11: S, 12: S, 13: S, 14: S, 15: S, 16: S, 17: S, 18: S, 19: "SSPP", 20: P, 21: P, 22: "PPSS", 23: S }),
    );
    for (const saturday of ["2026-01-17", "2026-07-18"]) {
      expect(dayPattern(saturday, "weekly", "2027")).toBe(hours({ 17: S, 18: S, 19: S, 20: S, 21: S, 22: S, 23: S }));
    }
    expect(dayPattern("2026-07-19", "weekly", "2027")).toBe(hours({}));
  });

  it("daily cycle: the same every day of the year", () => {
    const expected = hours({ 8: "VVSS", 9: S, 10: S, 11: S, 12: S, 13: S, 14: S, 15: S, 16: S, 17: "SSPP", 18: P, 19: P, 20: P, 21: "PPSS", 22: "SSVV" });
    for (const date of ["2026-01-14", "2026-01-18", "2026-07-15", "2026-07-18"]) {
      expect(dayPattern(date, "daily", "2027")).toBe(expected);
    }
  });
});
