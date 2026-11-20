// The BTN hourly cycles in mainland Portugal: which tariff period each quarter-hour falls in, for
// the daily and the weekly cycle, in winter and summer legal time. Pure and dependency-free, so
// that scripts/build-electricity-profiles.mjs can import it directly (Node strips the types).
// `electricityPeriods.ts` is the public entry point and re-exports everything here.
//
// Two schedules, both from official texts, read on 2026-11-20:
//
// "current", in force in 2026 and until the network operator re-parameterises each meter in the
// second half of 2027:
//   - Durations: Regulamento Tarifário do setor elétrico (Regulamento n.º 1218/2025, 7 November),
//     article 36.º, Quadro 8.1 (weekly cycle) and Quadro 8.2 (daily cycle). Every table below
//     matches those hours per day; the tests check it.
//     https://www.erse.pt/media/4y4odvlh/articulado_rt-se_publicado-dr-com-dretif-e-1a-alt.pdf
//   - Weekly cycle hours: ERSE, Despacho n.º 26 126-A/2004 (Diário da República, 2.ª série,
//     n.º 293, suplemento, 16 December 2004), annex, n.º II.5 "Períodos horários", page
//     18 790-(28) to (29). https://files.diariodarepublica.pt/gratuitos/2s/2004/12/2S293A0000S01.pdf
//   - Daily cycle hours: ERSE, "Localização de períodos tarifários no ciclo diário para 2009"
//     (December 2008), Quadro 8-1, the cycle in force since 2009.
//     https://www.erse.pt/media/fv2jtyzs/localiza%C3%A7%C3%A3odosper%C3%ADodostarif%C3%A1rios_finaldez08_.pdf
//   - Both are restated for 2026 in ERSE's "Estudo técnico para a atualização dos períodos horários
//     em Portugal continental" (Consulta Pública n.º 137), Quadros 2-7 and 2-8, which notes the
//     summer weekday peak runs 9:15-12:15, the only 15-minute boundary.
//     https://www.erse.pt/media/nqpn01yb/estudo-t%C3%A9cnico-atualiza%C3%A7%C3%A3o-dos-periodos-hor%C3%A1rios-em-pc.pdf
//
// "2027": ERSE, Diretiva n.º 3/2026 (Diário da República, 2.ª série, n.º 160, 19 August 2026),
//   article 2.º, n.º 4 (weekly cycle) and n.º 7 (daily cycle, the same all year). Article 3.º,
//   n.º 2 and 3: BTN bi-hourly and tri-hourly meters move to it between 1 July and 31 December 2027.
//   https://www.erse.pt/media/3hanbooq/diretiva-n%C2%BA-3_2026-19-de-agosto-aprova-os-per%C3%ADodos-hor%C3%A1rios.pdf
//
// Aggregation (Regulamento Tarifário, article 36.º; Diretiva n.º 3/2026, article 2.º, n.º 8 and 9):
// tri-hourly "vazio" is "vazio normal" plus "super vazio"; bi-hourly "fora de vazio" is "ponta" plus
// "cheias". National holidays count as Sundays only for MT, AT and MAT clients, so in BTN a holiday
// follows its weekday. Hours are legal time: winter time is UTC from 01:00 UTC on the last Sunday of
// October to 01:00 UTC on the last Sunday of March, summer time is UTC+1 (Decreto-Lei n.º 17/96).
// The Guia de Medição, Leitura e Disponibilização de Dados (Regulamento n.º 987/2025) does not set
// the hours; it defines the BTN profiles (see electricityPeriods.ts).

export const HOURLY_CYCLES = ["daily", "weekly"] as const;
export type HourlyCycle = (typeof HOURLY_CYCLES)[number];

export const PERIOD_SCHEDULES = ["current", "2027"] as const;
/** "current": the cycles in force in 2026. "2027": Diretiva n.º 3/2026, applied to BTN meters in 2027. */
export type PeriodSchedule = (typeof PERIOD_SCHEDULES)[number];

export type TriHourlyPeriod = "peak" | "shoulder" | "valley";
export type BiHourlyPeriod = "offValley" | "valley";
export type LegalSeason = "winter" | "summer";
export type DayType = "weekday" | "saturday" | "sunday";

/** Half-open [from, to) ranges in legal time, "HH:MM", "24:00" for the end of the day. */
interface DayRanges {
  peak: readonly (readonly [string, string])[];
  shoulder: readonly (readonly [string, string])[];
}

interface ScheduleTable {
  daily: Record<LegalSeason, DayRanges>;
  weekly: Record<LegalSeason, Record<DayType, DayRanges>>;
}

const SUNDAY: DayRanges = { peak: [], shoulder: [] };

/** Peak ("ponta") and shoulder ("cheias") hours; every other quarter-hour is valley ("vazio"). */
export const PERIOD_TABLES: Record<PeriodSchedule, ScheduleTable> = {
  current: {
    // ERSE, Localização de períodos tarifários no ciclo diário para 2009, Quadro 8-1.
    daily: {
      winter: {
        peak: [["09:00", "10:30"], ["18:00", "20:30"]],
        shoulder: [["08:00", "09:00"], ["10:30", "18:00"], ["20:30", "22:00"]],
      },
      summer: {
        peak: [["10:30", "13:00"], ["19:30", "21:00"]],
        shoulder: [["08:00", "10:30"], ["13:00", "19:30"], ["21:00", "22:00"]],
      },
    },
    // Despacho n.º 26 126-A/2004, annex, n.º II.5, "Ciclo semanal".
    weekly: {
      winter: {
        weekday: {
          peak: [["09:30", "12:00"], ["18:30", "21:00"]],
          shoulder: [["07:00", "09:30"], ["12:00", "18:30"], ["21:00", "24:00"]],
        },
        saturday: { peak: [], shoulder: [["09:30", "13:00"], ["18:30", "22:00"]] },
        sunday: SUNDAY,
      },
      summer: {
        weekday: {
          peak: [["09:15", "12:15"]],
          shoulder: [["07:00", "09:15"], ["12:15", "24:00"]],
        },
        saturday: { peak: [], shoulder: [["09:00", "14:00"], ["20:00", "22:00"]] },
        sunday: SUNDAY,
      },
    },
  },
  "2027": {
    // Diretiva n.º 3/2026, article 2.º, n.º 7: one daily cycle for the whole year.
    daily: {
      winter: {
        peak: [["17:30", "21:30"]],
        shoulder: [["08:30", "17:30"], ["21:30", "22:30"]],
      },
      summer: {
        peak: [["17:30", "21:30"]],
        shoulder: [["08:30", "17:30"], ["21:30", "22:30"]],
      },
    },
    // Diretiva n.º 3/2026, article 2.º, n.º 4.
    weekly: {
      winter: {
        weekday: {
          peak: [["17:00", "22:00"]],
          shoulder: [["00:00", "00:30"], ["07:30", "17:00"], ["22:00", "24:00"]],
        },
        saturday: { peak: [], shoulder: [["17:00", "24:00"]] },
        sunday: SUNDAY,
      },
      summer: {
        weekday: {
          peak: [["19:30", "22:30"]],
          shoulder: [["00:00", "00:30"], ["07:30", "19:30"], ["22:30", "24:00"]],
        },
        saturday: { peak: [], shoulder: [["17:00", "24:00"]] },
        sunday: SUNDAY,
      },
    },
  },
};

const QUARTERS_PER_DAY = 96;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const QUARTER_HOUR_MS = 15 * MINUTE_MS;

function minutesOf(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`Bad time ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** The 96 quarter-hours of one day type, each a tri-hourly period. */
function quartersOf(ranges: DayRanges): readonly TriHourlyPeriod[] {
  const quarters: TriHourlyPeriod[] = Array.from({ length: QUARTERS_PER_DAY }, () => "valley");
  for (const period of ["shoulder", "peak"] as const) {
    for (const [from, to] of ranges[period]) {
      for (let minute = minutesOf(from); minute < minutesOf(to); minute += 15) quarters[minute / 15] = period;
    }
  }
  return quarters;
}

type QuarterTable = Record<HourlyCycle, Record<LegalSeason, Record<DayType, readonly TriHourlyPeriod[]>>>;

function buildQuarterTable(table: ScheduleTable): QuarterTable {
  const daily = {
    winter: quartersOf(table.daily.winter),
    summer: quartersOf(table.daily.summer),
  };
  const weekly = (season: LegalSeason) => ({
    weekday: quartersOf(table.weekly[season].weekday),
    saturday: quartersOf(table.weekly[season].saturday),
    sunday: quartersOf(table.weekly[season].sunday),
  });
  return {
    daily: {
      winter: { weekday: daily.winter, saturday: daily.winter, sunday: daily.winter },
      summer: { weekday: daily.summer, saturday: daily.summer, sunday: daily.summer },
    },
    weekly: { winter: weekly("winter"), summer: weekly("summer") },
  };
}

const QUARTERS: Record<PeriodSchedule, QuarterTable> = {
  current: buildQuarterTable(PERIOD_TABLES.current),
  "2027": buildQuarterTable(PERIOD_TABLES["2027"]),
};

/** 01:00 UTC on the last Sunday of a month (0-based), when legal time changes in Portugal. */
function lastSundayChange(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, lastDay.getUTCDate() - lastDay.getUTCDay(), 1);
}

/** Whether a UTC instant falls in summer legal time (UTC+1) in mainland Portugal. */
export function isSummerTime(instant: number): boolean {
  const year = new Date(instant).getUTCFullYear();
  return instant >= lastSundayChange(year, 2) && instant < lastSundayChange(year, 9);
}

export interface LegalTime {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  /** 0 is Sunday, as in Date#getDay. */
  weekday: number;
  minuteOfDay: number;
  season: LegalSeason;
}

/** The legal (wall-clock) time in mainland Portugal of a UTC instant. */
export function legalTimeOf(instant: number): LegalTime {
  const summer = isSummerTime(instant);
  const local = new Date(instant + (summer ? HOUR_MS : 0));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    weekday: local.getUTCDay(),
    minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
    season: summer ? "summer" : "winter",
  };
}

/** The UTC instant of 00:00 legal time on a calendar day (month 1 to 12). */
export function legalMidnight(year: number, month: number, day: number): number {
  const asSummer = Date.UTC(year, month - 1, day) - HOUR_MS;
  return isSummerTime(asSummer) ? asSummer : Date.UTC(year, month - 1, day);
}

/** Quarter-hours in a legal-time calendar day: 96, or 92 and 100 on the days the clock changes. */
export function quartersInLegalDay(year: number, month: number, day: number): number {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const end = legalMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return (end - legalMidnight(year, month, day)) / QUARTER_HOUR_MS;
}

/**
 * The UTC instants a legal wall-clock time can mean on a day: two in the repeated hour in October
 * (summer time first), one otherwise, and none in the hour skipped in March.
 */
export function instantsOfLegalTime(year: number, month: number, day: number, minuteOfDay: number): number[] {
  const asWinter = Date.UTC(year, month - 1, day) + minuteOfDay * MINUTE_MS;
  const asSummer = asWinter - HOUR_MS;
  const instants: number[] = [];
  if (isSummerTime(asSummer)) instants.push(asSummer);
  if (!isSummerTime(asWinter)) instants.push(asWinter);
  return instants;
}

function dayTypeOf(weekday: number): DayType {
  if (weekday === 0) return "sunday";
  return weekday === 6 ? "saturday" : "weekday";
}

/**
 * The tri-hourly period of the quarter-hour that starts at a UTC instant. Every boundary is on a
 * quarter-hour, so a 15-minute reading never straddles two periods.
 */
export function triHourlyPeriodAt(
  instant: number | Date,
  cycle: HourlyCycle,
  schedule: PeriodSchedule = "current",
): TriHourlyPeriod {
  const time = legalTimeOf(typeof instant === "number" ? instant : instant.getTime());
  return QUARTERS[schedule][cycle][time.season][dayTypeOf(time.weekday)][Math.floor(time.minuteOfDay / 15)];
}

/** The bi-hourly period of the quarter-hour that starts at a UTC instant. */
export function biHourlyPeriodAt(
  instant: number | Date,
  cycle: HourlyCycle,
  schedule: PeriodSchedule = "current",
): BiHourlyPeriod {
  return triHourlyPeriodAt(instant, cycle, schedule) === "valley" ? "valley" : "offValley";
}
