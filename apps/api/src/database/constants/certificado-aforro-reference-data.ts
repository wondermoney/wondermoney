/**
 * Certificados de Aforro reference data — loyalty-premium schedules and published monthly
 * base-rate history (RAD-445).
 *
 * This is the single source of truth for both provisioning paths: the fresh-DB seeder
 * (`seeders/CertificadoAforroReferenceSeeder.ts`) and the idempotent staging/prod rollout
 * script (`scripts/insert-certificado-aforro-lookups.ts`) read these same constants, so the two
 * environments cannot drift apart.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY ONLY SÉRIES E AND F
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Séries C and D are deliberately left UNPROVISIONED. Their premium schedules are not published
 * in a form we have verified — Série C's was retroactively altered by Portaria 268-D/2012 and
 * varies by subscription cohort, and neither series appears in IGCP's current monthly base-rate
 * announcements at all. Inventing plausible-looking figures for money math is strictly worse than
 * having none: a wrong accrued value is silent, while a missing one is loud. A C/D holding
 * therefore fails to value and raises a Sentry alert tagged with its symbol (see
 * `certificado-aforro-holdings.service.ts`), which is the intended, visible state until the exact
 * figures are sourced from IGCP. Do NOT add C/D rows here without a citable IGCP source.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * PREMIUM SCHEDULES — source
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Verbatim from IGCP's own fichas técnicas (re-confirmed live on 2026-08-06):
 *
 *   Série E — https://www.igcp.pt/pt/ficha-tecnica-certificados-de-aforro-serie-e
 *     "0.5% — from the beginning of the 2nd year to the end of the 5th year"
 *     "1.0% — from the beginning of the 6th year to the end of the 10th year"
 *     Term 10 years; base rate E3+1%, capped 3.5%, floored 0%.
 *
 *   Série F — https://www.igcp.pt/en/aforristas/produtos-de-aforro/certificados-de-aforro/ficha-tecnica-certificados-de-aforro-serie-f
 *     "0.25% — from the 2nd to the 5th year"   "0.50% — from the 6th to the 9th year"
 *     "1.00% — in the 10th and 11th year"      "1.50% — in the 12th and 13th year"
 *     "1.75% — in the 14th and 15th year"
 *     Term 15 years; base rate E3, capped 2.50%, floored 0%.
 *
 * Both series have a single, cohort-independent schedule, hence `cohortStartDate: null`.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * RATE HISTORY — source, derivation and known gaps
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Every figure below was scraped from IGCP's own monthly announcement pages
 * (`igcp.pt/pt/noticias/taxas-de-juro-dos-certificados-de-aforro-…-em-<mês>-de-<ano>`), which
 * publish one sentence of the form: "A taxa de juro bruta para novas subscrições de Certificados
 * de Aforro, Série X, em <mês> de <ano> foi fixada em N,NNN%." Because that is the rate for a
 * *new* subscription — holding year 1, where the loyalty premium is still zero — it IS that
 * month's premium-free base rate, already clamped to the series' legal cap/floor. Nothing here is
 * computed from Euribor; we trust IGCP's own published number (design doc, decision 3).
 *
 * IGCP's live site only retains roughly the last two years of announcements, so months older than
 * that were read from the Internet Archive's captures of the same IGCP pages
 * (`web.archive.org/web/<YYYYMM>/<igcp url>`) — the source is still IGCP's own publication, just
 * a preserved copy of it.
 *
 * Subscription windows (which is why each series' history starts where it does):
 *   Série E — created by Portaria 329-A/2017 of 30 Oct 2017; IGCP's first Série E new-subscription
 *             rate announcement is NOVEMBER 2017 (October 2017's names Série D instead). Closed to
 *             new subscriptions by Portaria 149-A/2023 of 2 Jun 2023.
 *   Série F — created by Portaria 149-A/2023 of 2 Jun 2023; first announced rate JUNE 2023.
 *
 * Série E's rate from July 2023 onward is DERIVED, not separately published: once E closed, IGCP
 * stopped announcing a Série E new-subscription rate and publishes only Série F's. The two
 * formulas differ by exactly 1.00pp (E = Euribor 3M + 1%, F = Euribor 3M), and their caps differ by
 * exactly the same 1.00pp (3.50% vs 2.50%), so `min(x, 250) + 100 === min(x + 100, 350)` makes
 * `F + 100bps` E's exact capped base even while F is pinned at its own cap. This is the same
 * derivation the live sync worker applies (`certificado-aforro-rate-sync.worker.ts`), which
 * documents the arithmetic that confirms it against IGCP's published per-cohort tables. Each
 * derived row is marked in its trailing comment.
 *
 * KNOWN GAPS — four months are missing for both series: 2024-06, 2024-08, 2024-10 and 2024-11.
 * IGCP has purged them from its live site and the Internet Archive holds no usable capture of
 * them (only a 2025 redirect for October 2024), so there is no verifiable source. They are left
 * out rather than guessed. The accrual engine carries the most recent earlier rate forward across
 * a missing month and logs a warning, so a lot spanning one of these quarters is valued with a
 * stale-but-real rate rather than failing — the resulting error is bounded and diagnosable. If an
 * exact figure is ever needed, insert it as a `MANUAL_OVERRIDE` rate-period row.
 *
 * Precision: IGCP publishes three decimals (tenths of a bp); `base_rate_bps` is whole bps, so each
 * figure is rounded half-up at the last step — matching the sync worker's rounding exactly, so a
 * month backfilled here and the same month re-scraped later produce the identical integer.
 */

export interface CertificadoAforroPremiumBracketSeed {
  /** `null` = the series' standard, cohort-independent schedule. */
  cohortStartDate: null | string;
  premiumBps: number;
  yearFrom: number;
  yearTo: null | number;
}

export interface CertificadoAforroRatePeriodSeed {
  baseRateBps: number;
  /** First day of the month the rate applies to, `YYYY-MM-DD`. */
  effectiveMonth: string;
}

export const CERTIFICADO_AFORRO_PREMIUM_SCHEDULES: Record<string, CertificadoAforroPremiumBracketSeed[]> = {
  'CA-SERIE-E': [
    { cohortStartDate: null, premiumBps: 50, yearFrom: 2, yearTo: 5 },
    { cohortStartDate: null, premiumBps: 100, yearFrom: 6, yearTo: 10 },
  ],
  'CA-SERIE-F': [
    { cohortStartDate: null, premiumBps: 25, yearFrom: 2, yearTo: 5 },
    { cohortStartDate: null, premiumBps: 50, yearFrom: 6, yearTo: 9 },
    { cohortStartDate: null, premiumBps: 100, yearFrom: 10, yearTo: 11 },
    { cohortStartDate: null, premiumBps: 150, yearFrom: 12, yearTo: 13 },
    { cohortStartDate: null, premiumBps: 175, yearFrom: 14, yearTo: 15 },
  ],
};

/** Ordered oldest-first per series. See the module docblock for source, derivation and gaps. */
export const CERTIFICADO_AFORRO_RATE_HISTORY: Record<string, CertificadoAforroRatePeriodSeed[]> = {
  'CA-SERIE-E': [
    { baseRateBps: 67, effectiveMonth: '2017-11-01' }, // 0.671%
    { baseRateBps: 67, effectiveMonth: '2017-12-01' }, // 0.671%
    { baseRateBps: 67, effectiveMonth: '2018-01-01' }, // 0.671%
    { baseRateBps: 67, effectiveMonth: '2018-02-01' }, // 0.672%
    { baseRateBps: 67, effectiveMonth: '2018-03-01' }, // 0.672%
    { baseRateBps: 67, effectiveMonth: '2018-04-01' }, // 0.672%
    { baseRateBps: 67, effectiveMonth: '2018-05-01' }, // 0.672%
    { baseRateBps: 68, effectiveMonth: '2018-06-01' }, // 0.675%
    { baseRateBps: 68, effectiveMonth: '2018-07-01' }, // 0.678%
    { baseRateBps: 68, effectiveMonth: '2018-08-01' }, // 0.679%
    { baseRateBps: 68, effectiveMonth: '2018-09-01' }, // 0.681%
    { baseRateBps: 68, effectiveMonth: '2018-10-01' }, // 0.681%
    { baseRateBps: 68, effectiveMonth: '2018-11-01' }, // 0.683%
    { baseRateBps: 68, effectiveMonth: '2018-12-01' }, // 0.684%
    { baseRateBps: 69, effectiveMonth: '2019-01-01' }, // 0.689%
    { baseRateBps: 69, effectiveMonth: '2019-02-01' }, // 0.692%
    { baseRateBps: 69, effectiveMonth: '2019-03-01' }, // 0.692%
    { baseRateBps: 69, effectiveMonth: '2019-04-01' }, // 0.691%
    { baseRateBps: 69, effectiveMonth: '2019-05-01' }, // 0.689%
    { baseRateBps: 69, effectiveMonth: '2019-06-01' }, // 0.688%
    { baseRateBps: 67, effectiveMonth: '2019-07-01' }, // 0.67%
    { baseRateBps: 63, effectiveMonth: '2019-08-01' }, // 0.629%
    { baseRateBps: 58, effectiveMonth: '2019-09-01' }, // 0.584%
    { baseRateBps: 60, effectiveMonth: '2019-10-01' }, // 0.598%
    { baseRateBps: 59, effectiveMonth: '2019-11-01' }, // 0.592%
    { baseRateBps: 60, effectiveMonth: '2019-12-01' }, // 0.596%
    { baseRateBps: 60, effectiveMonth: '2020-01-01' }, // 0.603%
    { baseRateBps: 61, effectiveMonth: '2020-02-01' }, // 0.608%
    { baseRateBps: 59, effectiveMonth: '2020-03-01' }, // 0.589%
    { baseRateBps: 61, effectiveMonth: '2020-04-01' }, // 0.612%
    { baseRateBps: 78, effectiveMonth: '2020-05-01' }, // 0.779%
    { baseRateBps: 73, effectiveMonth: '2020-06-01' }, // 0.729%
    { baseRateBps: 61, effectiveMonth: '2020-07-01' }, // 0.611%
    { baseRateBps: 55, effectiveMonth: '2020-08-01' }, // 0.55%
    { baseRateBps: 52, effectiveMonth: '2020-09-01' }, // 0.516%
    { baseRateBps: 50, effectiveMonth: '2020-10-01' }, // 0.503%
    { baseRateBps: 49, effectiveMonth: '2020-11-01' }, // 0.491%
    { baseRateBps: 48, effectiveMonth: '2020-12-01' }, // 0.478%
    { baseRateBps: 46, effectiveMonth: '2021-01-01' }, // 0.46%
    { baseRateBps: 45, effectiveMonth: '2021-02-01' }, // 0.454%
    { baseRateBps: 46, effectiveMonth: '2021-03-01' }, // 0.457%
    { baseRateBps: 46, effectiveMonth: '2021-04-01' }, // 0.461%
    { baseRateBps: 46, effectiveMonth: '2021-05-01' }, // 0.463%
    { baseRateBps: 46, effectiveMonth: '2021-06-01' }, // 0.455%
    { baseRateBps: 46, effectiveMonth: '2021-07-01' }, // 0.458%
    { baseRateBps: 45, effectiveMonth: '2021-08-01' }, // 0.454%
    { baseRateBps: 45, effectiveMonth: '2021-09-01' }, // 0.45%
    { baseRateBps: 46, effectiveMonth: '2021-10-01' }, // 0.455%
    { baseRateBps: 45, effectiveMonth: '2021-11-01' }, // 0.452%
    { baseRateBps: 43, effectiveMonth: '2021-12-01' }, // 0.434%
    { baseRateBps: 41, effectiveMonth: '2022-01-01' }, // 0.411%
    { baseRateBps: 44, effectiveMonth: '2022-02-01' }, // 0.444%
    { baseRateBps: 48, effectiveMonth: '2022-03-01' }, // 0.475%
    { baseRateBps: 51, effectiveMonth: '2022-04-01' }, // 0.511%
    { baseRateBps: 56, effectiveMonth: '2022-05-01' }, // 0.555%
    { baseRateBps: 63, effectiveMonth: '2022-06-01' }, // 0.633%
    { baseRateBps: 81, effectiveMonth: '2022-07-01' }, // 0.81%
    { baseRateBps: 110, effectiveMonth: '2022-08-01' }, // 1.103%
    { baseRateBps: 143, effectiveMonth: '2022-09-01' }, // 1.432%
    { baseRateBps: 211, effectiveMonth: '2022-10-01' }, // 2.106%
    { baseRateBps: 249, effectiveMonth: '2022-11-01' }, // 2.492%
    { baseRateBps: 284, effectiveMonth: '2022-12-01' }, // 2.842%
    { baseRateBps: 309, effectiveMonth: '2023-01-01' }, // 3.088%
    { baseRateBps: 340, effectiveMonth: '2023-02-01' }, // 3.403%
    { baseRateBps: 350, effectiveMonth: '2023-03-01' }, // 3.5%
    { baseRateBps: 350, effectiveMonth: '2023-04-01' }, // 3.5%
    { baseRateBps: 350, effectiveMonth: '2023-05-01' }, // 3.5%
    { baseRateBps: 350, effectiveMonth: '2023-06-01' }, // 3.5%
    { baseRateBps: 350, effectiveMonth: '2023-07-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2023-08-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2023-09-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2023-10-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2023-11-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2023-12-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2024-01-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2024-02-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2024-03-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2024-04-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2024-05-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2024-07-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2024-09-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2024-12-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2025-01-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2025-02-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 350, effectiveMonth: '2025-03-01' }, // Série F 2.5% + 1.00pp
    { baseRateBps: 342, effectiveMonth: '2025-04-01' }, // Série F 2.415% + 1.00pp
    { baseRateBps: 322, effectiveMonth: '2025-05-01' }, // Série F 2.216% + 1.00pp
    { baseRateBps: 307, effectiveMonth: '2025-06-01' }, // Série F 2.07% + 1.00pp
    { baseRateBps: 301, effectiveMonth: '2025-07-01' }, // Série F 2.011% + 1.00pp
    { baseRateBps: 299, effectiveMonth: '2025-08-01' }, // Série F 1.987% + 1.00pp
    { baseRateBps: 303, effectiveMonth: '2025-09-01' }, // Série F 2.028% + 1.00pp
    { baseRateBps: 301, effectiveMonth: '2025-10-01' }, // Série F 2.009% + 1.00pp
    { baseRateBps: 304, effectiveMonth: '2025-11-01' }, // Série F 2.044% + 1.00pp
    { baseRateBps: 306, effectiveMonth: '2025-12-01' }, // Série F 2.057% + 1.00pp
    { baseRateBps: 305, effectiveMonth: '2026-01-01' }, // Série F 2.046% + 1.00pp
    { baseRateBps: 303, effectiveMonth: '2026-02-01' }, // Série F 2.031% + 1.00pp
    { baseRateBps: 301, effectiveMonth: '2026-03-01' }, // Série F 2.012% + 1.00pp
    { baseRateBps: 314, effectiveMonth: '2026-04-01' }, // Série F 2.138% + 1.00pp
    { baseRateBps: 320, effectiveMonth: '2026-05-01' }, // Série F 2.195% + 1.00pp
    { baseRateBps: 322, effectiveMonth: '2026-06-01' }, // Série F 2.215% + 1.00pp
    { baseRateBps: 336, effectiveMonth: '2026-07-01' }, // Série F 2.356% + 1.00pp
    { baseRateBps: 347, effectiveMonth: '2026-08-01' }, // Série F 2.474% + 1.00pp
  ],
  'CA-SERIE-F': [
    { baseRateBps: 250, effectiveMonth: '2023-06-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2023-07-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2023-08-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2023-09-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2023-10-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2023-11-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2023-12-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2024-01-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2024-02-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2024-03-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2024-04-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2024-05-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2024-07-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2024-09-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2024-12-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2025-01-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2025-02-01' }, // 2.5%
    { baseRateBps: 250, effectiveMonth: '2025-03-01' }, // 2.5%
    { baseRateBps: 242, effectiveMonth: '2025-04-01' }, // 2.415%
    { baseRateBps: 222, effectiveMonth: '2025-05-01' }, // 2.216%
    { baseRateBps: 207, effectiveMonth: '2025-06-01' }, // 2.07%
    { baseRateBps: 201, effectiveMonth: '2025-07-01' }, // 2.011%
    { baseRateBps: 199, effectiveMonth: '2025-08-01' }, // 1.987%
    { baseRateBps: 203, effectiveMonth: '2025-09-01' }, // 2.028%
    { baseRateBps: 201, effectiveMonth: '2025-10-01' }, // 2.009%
    { baseRateBps: 204, effectiveMonth: '2025-11-01' }, // 2.044%
    { baseRateBps: 206, effectiveMonth: '2025-12-01' }, // 2.057%
    { baseRateBps: 205, effectiveMonth: '2026-01-01' }, // 2.046%
    { baseRateBps: 203, effectiveMonth: '2026-02-01' }, // 2.031%
    { baseRateBps: 201, effectiveMonth: '2026-03-01' }, // 2.012%
    { baseRateBps: 214, effectiveMonth: '2026-04-01' }, // 2.138%
    { baseRateBps: 220, effectiveMonth: '2026-05-01' }, // 2.195%
    { baseRateBps: 222, effectiveMonth: '2026-06-01' }, // 2.215%
    { baseRateBps: 236, effectiveMonth: '2026-07-01' }, // 2.356%
    { baseRateBps: 247, effectiveMonth: '2026-08-01' }, // 2.474%
  ],
};
