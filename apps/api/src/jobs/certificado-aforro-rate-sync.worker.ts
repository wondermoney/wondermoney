import * as Sentry from '@sentry/node';
import type { Kysely } from 'kysely';
import type { Job } from 'pg-boss';

import { DI } from '@app/database/di';
import { type SqlDatabase, sqlQuery } from '@app/database/sql';
import { CertificadoAforroRateSource } from '@entity/CertificadoAforroRatePeriod';
import OpenAI, { type PromptResponseFormat } from '@service/ai/openai';
import { CERTIFICADO_AFORRO_SERIES_CONSTANTS } from '@service/portfolio/certificado-aforro-calculation.service';
import { convertPDFToImage, extractPDFTextLayer } from '@utils/documents';
import logger from '@utils/logger';

/**
 * Certificados de Aforro monthly base-rate ingestion.
 *
 * === What IGCP actually publishes (verified live against igcp.pt on 2026-08-06) ===
 *
 * One news page per month at a predictable URL, e.g.
 *   https://www.igcp.pt/pt/noticias/taxas-de-juro-dos-certificados-de-aforro-das-series-b-d-e-e-f-em-agosto-de-2026
 *
 * 1. The page's HTML body contains exactly ONE machine-readable rate, in a fixed sentence:
 *      "A taxa de juro bruta para novas subscrições de Certificados de Aforro, Série F,
 *       em agosto de 2026 foi fixada em 2,474%."
 *    That is the *new-subscription* gross rate for Série F — i.e. holding-year 1, where the
 *    loyalty premium is still zero — so it IS the month's base rate.
 *
 * 2. The linked per-series PDFs (`Taxa_Anual_<A|B|D|E|F>+PP.pdf`) do NOT publish base rates.
 *    They publish, per issue cohort, the gross annual rate currently in effect *including* the
 *    Prémio de Permanência ("As taxas refletem as atuais condições de remuneração incluindo o
 *    Prémio de Permanência").
 *
 * === Séries C/D/E's base rate is F's base rate PLUS 1.00pp ===
 *
 * The two formulas are NOT the same quantity (design doc, "Domain facts"):
 *
 *   Série F   base = Euribor 3M            , cap 2.50%, floor 0%
 *   Série C/D/E base = Euribor 3M + 1.00pp , cap 3.50%, floor 0%
 *
 * So the scraped Série F sentence gives Euribor 3M directly, and C/D/E's base rate is that
 * figure + 100bps. Getting this wrong is not subtle — it shifts every C/D/E lot's rate by a
 * full percentage point — so here is the arithmetic that confirms it against the real
 * August-2026 tables (base_F = 2.474%, hence base_CDE = 3.474%):
 *
 *   Série E, 2017 – Aug 2021 cohorts: 4,474% − 3,474% = +1.00pp -> E's year 6-10 bracket ✓
 *   Série E, Sep 2021 – 2023 cohorts: 3,974% − 3,474% = +0.50pp -> E's year 2-5  bracket ✓
 *   Série F, 2023 – Aug 2025 cohorts: 2,724% − 2,474% = +0.25pp -> F's year 2-5  bracket ✓
 *   Série F, Sep 2025 – 2026 cohorts: 2,474% − 2,474% = +0.00pp -> F, still year 1 ✓
 *
 * Every figure lands exactly on a documented premium tier. The Série E table even splits its
 * 2021 row in two — Jan-Aug 2021 at 4,474% and Sep-Dec 2021 at 3,974% — which is precisely the
 * year-6 boundary for a valuation dated August 2026. With the (wrong) assumption that F's
 * figure is also C/D/E's base, those same gaps come out as +2.00pp and +1.50pp: values that do
 * not exist in Série E's schedule at all, which tops out at +1.0pp.
 *
 * === Consequences for this worker ===
 *
 * `certificado_aforro_rate_period.base_rate_bps` holds the *premium-free* base rate for that
 * series; the calculation engine applies the series' own cap/floor and premium schedule on top.
 * So this worker writes the scraped figure to Série F, and that figure + 100bps to C, D and E.
 *
 * The D/E PDFs are used as an INDEPENDENT CROSS-CHECK rather than as a second rate source: every
 * target-month gross rate in those tables must equal the derived C/D/E base rate plus a
 * plausible loyalty premium (a non-negative multiple of 0.25pp, ≤ 3.00pp). If it doesn't, the
 * scrape is not trustworthy for those series and we alert instead of writing. Note the limit of
 * that check: it validates the *shape* of the gap, not its size, so it cannot by itself catch a
 * whole-percentage-point offset error (100bps is 4 × 0.25pp and looks perfectly plausible). It
 * is a guard against misread and wrong-month tables, not against a modelling mistake.
 *
 * === "Target-month" is a row filter, not a property of the table ===
 *
 * These tables are headed "Taxa de Juro Anual … em vigor no TRIMESTRE CORRENTE de contagem de
 * juros". A cohort's quarterly interest period starts on its own subscription anniversary, so at
 * any moment a table holds THREE vintages side by side — quarters that began in each of the last
 * three months — each fixed with that month's base rate. August 2026's Série E table:
 *
 *   desde junho de 2026    4,215% / 3,715%   (June base 3.215% + 1.00pp / + 0.50pp)   8 rows
 *   desde julho de 2026    4,356% / 3,856%   (July base 3.356% + 1.00pp / + 0.50pp)   8 rows
 *   desde agosto de 2026   4,474% / 3,974%   (Aug  base 3.474% + 1.00pp / + 0.50pp)   8 rows
 *
 * Only the last third may be compared against August's base rate. Feeding a June row to the
 * cross-check implies a 0.741pp premium and fails — which is what a vision model that ignores the
 * prompt's row filter produces. The failure is one-directional — an off-month row can only produce
 * a false REJECT, never a false accept, because none of the off-month gaps
 * (0.241 / 0.382 / 0.741 / 0.882pp) lands near a 0.25pp step. A misread withholds the derived rate;
 * it never writes a wrong one.
 *
 * === Why the text layer, not vision ===
 *
 * The design doc originally recorded these PDFs as scanned JPEGs with no text layer, which is why
 * the first implementation reached for `convertPDFToImage` + the Azure vision deployment. They are
 * in fact Excel-exported vector PDFs *with* a text layer, and pdf.js is already in the tree as
 * `pdf-to-img`'s own renderer — so the rows can simply be read rather than recognised.
 * `parseGrossRatesFromTableText` does that deterministically, and vision survives only as a
 * fall-back for a genuinely image-only file. Determinism is the whole point on a money path: an
 * OCR pass that is right most days is indistinguishable from a correct one until it isn't.
 *
 * === Why the caps don't need special handling ===
 *
 * The scraped sentence is Série F's *applied* rate, i.e. already clamped to F's 2.50% cap, so it
 * stops tracking raw Euribor once Euribor reaches 2.50% (August 2026 is at 2.474% — 2.6bp of
 * headroom, so this regime is imminent, not hypothetical). That turns out not to matter, because
 * the two caps differ by exactly the same 100bps as the two formulas, and `min(x, c) + k` equals
 * `min(x + k, c + k)` for any constant `k`:
 *
 *   scraped + 100bps = min(Euribor, 250) + 100 = min(Euribor + 100, 350) = C/D/E's capped base
 *
 * So the offset derivation is exact in the capped regime too. `assertCapOffsetIdentity` guards
 * the coincidence at runtime: if anyone ever edits the cap constants such that the difference is
 * no longer 100bps, the identity silently breaks, so we alert and skip C/D/E instead.
 *
 * === Known limitation: the floor does not commute ===
 *
 * `max(x, 0) + k` is NOT `max(x + k, 0)` when `x` is negative. If raw Euribor 3M ever fell to,
 * say, −0.50%, Série F would publish max(−0.50, 0) = 0.000% while C/D/E's true base would be
 * max(−0.50 + 1.00, 0) = 0.500% — and this worker would write 100bps instead of 50bps. The
 * identity therefore holds only while the unfloored base is non-negative, i.e. whenever Euribor
 * 3M > −1.00%. Euribor 3M is ~1.5% today and has not been below −1% in its history, so this is
 * documented rather than solved; revisit if Europe ever returns to deeply negative rates.
 */

const JOB_NAME = 'certificado-aforro-rate-sync';

const IGCP_ORIGIN = 'https://www.igcp.pt';
/**
 * Both IGCP fetches ran with no timeout. `fetch` with no signal waits forever, and this
 * job runs at `batchSize: 1` with `retryLimit: 0` — one stalled socket on a government
 * site would have held the queue's only slot until the process restarted, with the job
 * itself unrecoverable. Generous enough for a slow public site, bounded either way.
 */
const IGCP_FETCH_TIMEOUT_MS = 30_000;
const IGCP_PDF_FETCH_TIMEOUT_MS = 60_000;

const PT_MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** Séries whose PDF table is used to cross-check the scraped base rate. */
const CROSS_CHECKED_SERIES = ['D', 'E'] as const;
type CrossCheckedSeries = (typeof CROSS_CHECKED_SERIES)[number];

const SERIE_F_SYMBOL = 'CA-SERIE-F';
/**
 * Série C is never published separately — it does not even appear in the monthly announcement's
 * title. It shares Série D's base-rate formula (Euribor 3M + 1.00pp, cap 3.50%); only the premium
 * schedule differs (Portaria 268-D/2012 cohorts).
 *
 * The rate itself is the same arithmetic on Série F's published figure that D and E get,
 * so it is not a guess. What is unverified is narrower — that Série C uses the C/D/E formula at
 * all. Nothing published names C, and C is the only series with no table of its own to cross-check
 * against, so it rides D's gate, which validates D's table rather than C's.
 *
 * Rows are stamped `IGCP_DERIVED_NO_SERIES_CROSSCHECK` so that limitation travels with the data
 * instead of living only in this comment.
 */
const SERIE_C_SYMBOL = 'CA-SERIE-C';

/**
 * Provenance stamped on a rate row.
 *
 * Every C/D/E row is arithmetic on Série F's published figure — none of them is
 * literally scraped from its own table — but D and E each have a published table
 * that cross-checks the result. Série C has none, so the claim "C uses the C/D/E
 * formula" is carried by nothing but the shared-formula inference.
 *
 * Stamping every row `IGCP_PDF_SCRAPE` would say otherwise: it would assert a
 * C-specific scrape that never happened, and make the one series with no
 * independent confirmation indistinguishable from the two that have it. A reader
 * could not tell which rows to doubt.
 */
const RATE_SOURCE_SCRAPED = CertificadoAforroRateSource.IGCP_PDF_SCRAPE;
const RATE_SOURCE_C_NO_OWN_CROSSCHECK = CertificadoAforroRateSource.IGCP_DERIVED_NO_SERIES_CROSSCHECK;

/**
 * Séries C/D/E's base-rate formula is `Euribor 3M + 1.00pp`; Série F's is `Euribor 3M` alone.
 * The scraped sentence gives F's figure, so C/D/E's base is that figure plus this offset.
 * See the "Séries C/D/E's base rate is F's base rate PLUS 1.00pp" section above for the
 * arithmetic confirming it against three real months of published tables.
 */
const CDE_FORMULA_OFFSET_TENTH_BPS = 1000; // 1.00pp = 100bps = 1000 tenths-of-a-bp

/**
 * A parse that finds *a* number but not the *right* number must fail loudly rather than write
 * garbage. The upper bound is the series' own legal cap: IGCP's published figure is already
 * clamped to it, so anything above it means we parsed the wrong number (or our cap constant is
 * wrong) — both worth an alert. Série F's 250bps cap makes this a far tighter net than a generic
 * bound would be, which matters because F is the one series with no independent cross-check.
 */
const SANITY_MIN_BPS = 0;
/** Only used if a series' cap constant is somehow missing — see `sanityMaxBpsFor`. */
const SANITY_MAX_FALLBACK_BPS = 1000;

/**
 * === Precision ===
 *
 * IGCP publishes three decimal places ("2,474%"), i.e. tenths of a basis point, but
 * `base_rate_bps` is a plain INTEGER column of whole basis points. We therefore carry rates
 * internally as *tenths of a basis point* (2.474% -> 2474) so that comparisons and premium
 * arithmetic are exact, and round half-up to whole bps only at the moment of writing.
 *
 * Rounding (not truncating) is deliberate: truncation is a systematic downward bias of up to
 * 1bp on every month, which compounds quarter after quarter and always under-values the holding;
 * rounding is unbiased and bounded at 0.5bp (0.005pp). Worst case on a €10,000 lot that is €0.50
 * of annual interest. The lost precision is a schema limitation, not a modelling choice — see the
 * task report's recommendation to widen `base_rate_bps` to tenths of a bp if that ever matters.
 */
const TENTH_BPS_PER_BPS = 10;
const PERCENT_TO_TENTH_BPS = 1000;

/** Loyalty premiums are published in 0.25pp steps and have never exceeded 3.00pp. */
const PREMIUM_STEP_TENTH_BPS = 250;
const PREMIUM_MAX_TENTH_BPS = 3000;
/** Absorbs half-up rounding noise when the PDF and the HTML disagree in the last digit. */
const PREMIUM_TOLERANCE_TENTH_BPS = 1;

const OCR_UNCERTAIN_TOKEN = 'UNCERTAIN';

export interface CertificadoAforroRateSyncDeps {
  convertPdfToImage?: typeof convertPDFToImage;
  extractPdfText?: typeof extractPDFTextLayer;
  fetch?: typeof fetch;
  now?: () => Date;
  ocr?: (input: { images: string[]; prompt: string }) => Promise<OpenAIVisionResponse>;
  store?: RateSyncStore;
}

/**
 * The three materially different outcomes of a series' PDF cross-check. `unavailable` and
 * `disagreed` are NOT interchangeable and must not be collapsed:
 *
 * - `unavailable` — the check could not run (PDF 404, network error, no Azure credentials, model
 *   refused). This is evidence about our *infrastructure*, not about the rate. The derived value
 *   is pure arithmetic on an already-confirmed figure, so withholding it here would mean
 *   discarding a number we are fully confident in because an unrelated dependency was down.
 * - `disagreed` — the check ran and the published table does not decompose into our derived base
 *   plus a plausible premium. This IS evidence the derived value may be wrong (wrong month's
 *   table, a broken formula assumption), so we withhold the write.
 * - `passed` — the check ran and agreed.
 */
export interface CertificadoAforroRateSyncResult {
  /** Per-series cross-check outcome, for observability. */
  crossChecks: Partial<Record<CrossCheckedSeries, CrossCheckStatus>>;
  /** Symbols whose rate row was written/refreshed this run. */
  written: string[];
  /** Why the run stopped early, when it did. */
  outcome: 'cap-offset-broken' | 'completed' | 'fetch-failed' | 'not-published' | 'parse-failed' | 'sanity-failed';
}

export type CrossCheckStatus = 'disagreed' | 'passed' | 'unavailable';

export interface RateSyncStore {
  findFinancialAssetKey: (symbol: string) => Promise<number | undefined>;
  upsertRatePeriod: (input: { baseRateBps: number; effectiveMonth: string; financialAssetKey: number; source?: string }) => Promise<void>;
}

interface OpenAIVisionResponse { answer: null | string | undefined }

// ---------------------------------------------------------------------------
// URL + date helpers
// ---------------------------------------------------------------------------

/** The month's news page. Slug confirmed live for maio/junho/julho/agosto 2026. */
export function buildAnnouncementUrl(targetMonth: Date): string {
  const monthName = PT_MONTHS[targetMonth.getUTCMonth()];
  return `${IGCP_ORIGIN}/pt/noticias/taxas-de-juro-dos-certificados-de-aforro-das-series-b-d-e-e-f-em-${monthName}-de-${targetMonth.getUTCFullYear()}`;
}

/** `Date` -> `YYYY-MM-01`, in UTC, for the `date`-typed `effective_month` column. */
function toEffectiveMonth(month: Date): string {
  return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Fallback PDF URL, used only when the announcement page's own `<a href>` can't be found.
 * Verified pattern: the folder is a `YYYY-MM` stamp of when IGCP last replaced the file, which in
 * practice has been the month before the announcement month. The files are living documents
 * (every 2026 announcement page links the same `2026-07/` copies), so this is a weak guess —
 * scraping the real href is always preferred.
 */
export function buildFallbackPdfUrl(series: CrossCheckedSeries, targetMonth: Date): string {
  const priorMonth = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() - 1, 1));
  const folder = `${priorMonth.getUTCFullYear()}-${String(priorMonth.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${IGCP_ORIGIN}/sites/default/files/${folder}/Taxa_Anual_${series}%2BPP.pdf`;
}

/**
 * `null` means "IGCP hasn't published this month yet" (404) — a soft no-op, since the job polls
 * daily. Anything else that isn't a 2xx is a genuine failure worth alerting on.
 */
async function fetchAnnouncementPage(targetMonth: Date, fetchImpl: typeof fetch): Promise<null | string> {
  const response = await fetchImpl(buildAnnouncementUrl(targetMonth), { signal: AbortSignal.timeout(IGCP_FETCH_TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`IGCP announcement page returned ${response.status}`);
  return response.text();
}

// ---------------------------------------------------------------------------
// Série F: plain-HTML extraction
// ---------------------------------------------------------------------------

const ACCENT_ALTERNATIVES: Record<string, string> = {
  á: '(?:á|a|&aacute;|&#225;)',
  ç: '(?:ç|c|&ccedil;|&#231;)',
  é: '(?:é|e|&eacute;|&#233;)',
  í: '(?:í|i|&iacute;|&#237;)',
  ó: '(?:ó|o|&oacute;|&#243;)',
  õ: '(?:õ|o|&otilde;|&#245;)',
};

const WHITESPACE_PATTERN = '(?:\\s|&nbsp;|&#160;)+';

/** Accented characters may arrive as raw UTF-8 or as HTML entities; accept either. */
function toEntityTolerantPattern(text: string): string {
  return text.replaceAll(/./gu, (character) => ACCENT_ALTERNATIVES[character] ?? character.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
}

/**
 * Extracts the Série F new-subscription gross rate, in tenths of a basis point, from the
 * announcement page's fixed sentence. Returns `null` when the sentence isn't present.
 */
export function extractSerieFRateTenthBps(html: string, targetMonth: Date): null | number {
  const monthName = PT_MONTHS[targetMonth.getUTCMonth()] ?? '';
  const pattern = new RegExp(
    [
      toEntityTolerantPattern('Série F,'),
      WHITESPACE_PATTERN,
      'em',
      WHITESPACE_PATTERN,
      toEntityTolerantPattern(monthName),
      WHITESPACE_PATTERN,
      'de',
      WHITESPACE_PATTERN,
      targetMonth.getUTCFullYear(),
      WHITESPACE_PATTERN,
      'foi',
      WHITESPACE_PATTERN,
      'fixada',
      WHITESPACE_PATTERN,
      'em',
      WHITESPACE_PATTERN,
      '(\\d{1,2},\\d{1,4})\\s?%',
    ].join(''),
    'i',
  );

  const match = pattern.exec(html);
  if (!match?.[1]) return null;
  return percentToTenthBps(match[1]);
}

/**
 * Finds the announcement page's own link to a series' rate table. The filename picks up a `_0`,
 * `_1`, … suffix whenever IGCP re-uploads it (August 2026's Série F file is
 * `Taxa_Anual_F%2BPP_0.pdf`), so match a prefix rather than an exact name.
 */
export function extractPdfLink(html: string, series: CrossCheckedSeries): null | string {
  const pattern = new RegExp(`href="([^"]{0,200}Taxa_Anual_${series}(?:%2B|\\+)PP[^"]{0,40}\\.pdf)"`, 'i');
  const match = pattern.exec(html);
  if (!match?.[1]) return null;

  const href = match[1].replace(/&amp;/g, '&');
  return href.startsWith('http') ? href : `${IGCP_ORIGIN}${href.startsWith('/') ? '' : '/'}${href}`;
}

// ---------------------------------------------------------------------------
// Precision helpers
// ---------------------------------------------------------------------------

/** A series' legal base-rate cap, which doubles as the sanity upper bound for its published figure. */
export function tenthBpsToBps(tenthBps: number): number {
  return Math.round(tenthBps / TENTH_BPS_PER_BPS);
}

function isSaneRateBps(rateBps: number, maxBps: number): boolean {
  return Number.isFinite(rateBps) && rateBps >= SANITY_MIN_BPS && rateBps <= maxBps;
}

function percentToTenthBps(percent: string): null | number {
  const value = Number.parseFloat(percent.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * PERCENT_TO_TENTH_BPS);
}

function sanityMaxBpsFor(symbol: string): number {
  return CERTIFICADO_AFORRO_SERIES_CONSTANTS[symbol]?.capBps ?? SANITY_MAX_FALLBACK_BPS;
}

// ---------------------------------------------------------------------------
// Séries D/E: PDF table read (vision) + cross-check
// ---------------------------------------------------------------------------

/**
 * ⚠️ UNVERIFIED AGAINST REAL AZURE — see the TODO at the `promptWithImages` call site below.
 *
 * Typed as the SDK's own `response_format` parameter type (rather than cast away), so a schema
 * that the SDK would reject is a compile error here instead of a runtime 400 in production.
 */
const RATE_TABLE_RESPONSE_FORMAT: PromptResponseFormat = {
  json_schema: {
    name: 'certificado_aforro_rate_table',
    schema: {
      additionalProperties: false,
      properties: {
        grossRatesPercent: { items: { type: 'number' }, type: 'array' },
        uncertain: { type: 'boolean' },
      },
      required: ['grossRatesPercent', 'uncertain'],
      type: 'object',
    },
    strict: true,
  },
  type: 'json_schema',
};

/**
 * Deliberately asks for an explicit "uncertain" flag instead of a best guess: a misread digit
 * here feeds straight into real money calculations, so a refusal is always cheaper than a wrong
 * number (the caller treats `uncertain` and any unparseable answer alike, as a hard failure).
 */
function buildRateTablePrompt(series: CrossCheckedSeries, targetMonth: Date): string {
  const monthName = PT_MONTHS[targetMonth.getUTCMonth()];
  const since = `desde ${monthName} de ${targetMonth.getUTCFullYear()}`;

  return [
    `This image is IGCP's official "SÉRIE ${series}" table of gross annual interest rates for Portuguese Certificados de Aforro.`,
    'Each table row is one issue cohort and has three cells: the issue period (a year), the issue months, and a cell of the form',
    '"desde <month> de <year>" followed by a percentage written with a comma decimal separator, e.g. "4,474%".',
    `Task: list the percentage of EVERY row whose third cell reads exactly "${since}".`,
    'Return them in "grossRatesPercent" as decimal numbers using a dot separator (so "4,474%" becomes 4.474).',
    `Set "uncertain" to true — and return an empty list — if the image is unreadable, if no row matches "${since}",`,
    'or if you are not completely certain of every digit of every matching percentage.',
    'Never guess a digit. An honest "uncertain" is always preferred over an approximate number.',
    `If you cannot comply with the JSON schema at all, answer with the single word ${OCR_UNCERTAIN_TOKEN}.`,
  ].join(' ');
}

/**
 * Every rate row in an IGCP table, as `desde <month> de <year>` followed by the gross rate that
 * cohort's current quarter was fixed at ("desde agosto de 2026 4,474%"). The month is the start of
 * the *quarter*, not the publication month — see the docblock's "target-month is a row filter".
 */
const RATE_ROW_PATTERN = /desde\s+([a-zç]+)\s+de\s+(\d{4})\s*(\d{1,2},\d{1,4})\s*%/giu;

/**
 * Pulls a rate table's rows out of its text layer and keeps only those whose interest quarter began
 * in `targetMonth` — the only rows that are comparable with that month's base rate.
 *
 * `totalRows` is reported alongside so the caller (and Sentry) can tell the three cases apart:
 * nothing parsed at all (no text layer -> try vision), rows parsed but none for this month (IGCP
 * has not refreshed the file -> the check cannot run), and a normal match.
 */
export function parseGrossRatesFromTableText(
  text: string,
  targetMonth: Date,
): { matched: number[]; totalRows: number } {
  const wantedMonth = PT_MONTHS[targetMonth.getUTCMonth()];
  const wantedYear = String(targetMonth.getUTCFullYear());

  const matched: number[] = [];
  let totalRows = 0;

  for (const [, month, year, percent] of text.normalize('NFC').matchAll(RATE_ROW_PATTERN)) {
    if (!PT_MONTHS.includes(month?.toLowerCase() as (typeof PT_MONTHS)[number])) continue;
    totalRows += 1;
    if (month?.toLowerCase() !== wantedMonth || year !== wantedYear) continue;

    const rate = percentToTenthBps(percent ?? '');
    if (rate !== null) matched.push(rate);
  }

  return { matched, totalRows };
}

/**
 * Fetches a series' PDF table and reads the target month's gross (premium-inclusive) rates out of
 * it — from the embedded text layer where there is one, falling back to the vision model only for a
 * genuinely image-only file. Throws on every failure mode — including a low-confidence model
 * response — so the caller alerts and writes nothing.
 */
export async function readSeriesGrossRatesTenthBps(
  pdfUrl: string,
  series: CrossCheckedSeries,
  targetMonth: Date,
  deps: Required<Pick<CertificadoAforroRateSyncDeps, 'convertPdfToImage' | 'extractPdfText' | 'fetch' | 'ocr'>>,
): Promise<number[]> {
  const response = await deps.fetch(pdfUrl, { signal: AbortSignal.timeout(IGCP_PDF_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`IGCP Série ${series} PDF returned ${response.status}`);

  const pdfBuffer = Buffer.from(await response.arrayBuffer());

  const { matched, totalRows } = parseGrossRatesFromTableText(await deps.extractPdfText(pdfBuffer), targetMonth);
  if (matched.length > 0) return matched;
  if (totalRows > 0) {
    // The table was read cleanly and simply has no quarter starting this month — IGCP has not
    // refreshed the file yet. Vision cannot conjure a row that isn't there, so don't ask it.
    throw new Error(
      `IGCP Série ${series} table has no row for ${PT_MONTHS[targetMonth.getUTCMonth()]} de ${targetMonth.getUTCFullYear()} (${totalRows} rows read)`,
    );
  }

  const images = await deps.convertPdfToImage(`data:application/pdf;base64,${pdfBuffer.toString('base64')}`);
  if (images.length === 0) throw new Error(`IGCP Série ${series} PDF produced no pages`);

  const { answer } = await deps.ocr({ images, prompt: buildRateTablePrompt(series, targetMonth) });
  if (!answer) throw new Error(`Vision model returned no answer for Série ${series}`);
  if (answer.trim().toUpperCase() === OCR_UNCERTAIN_TOKEN) {
    throw new Error(`Vision model reported ${OCR_UNCERTAIN_TOKEN} for Série ${series}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    throw new Error(`Vision model returned non-JSON for Série ${series}`);
  }

  const { grossRatesPercent, uncertain } = (parsed ?? {}) as { grossRatesPercent?: unknown; uncertain?: unknown };
  if (uncertain === true) throw new Error(`Vision model reported ${OCR_UNCERTAIN_TOKEN} for Série ${series}`);
  if (!Array.isArray(grossRatesPercent) || grossRatesPercent.length === 0) {
    throw new Error(`Vision model returned no rates for Série ${series}`);
  }

  return grossRatesPercent.map((rate) => {
    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      throw new TypeError(`Vision model returned a non-numeric rate for Série ${series}`);
    }
    return Math.round(rate * PERCENT_TO_TENTH_BPS);
  });
}

/**
 * Every gross rate in a series' table must be that series' base rate plus one of its cohorts'
 * loyalty premiums. Any other gap means the two sources disagree — a misread digit, a table for
 * the wrong month, or a genuine divergence in IGCP's formula — and the scrape must not be trusted.
 *
 * `baseRateTenthBps` must be the base rate *for the series being checked* — i.e. the +1.00pp
 * offset already applied for C/D/E. Passing Série F's raw figure here would still "pass": the
 * missing 100bps is exactly 4 × 0.25pp, so it is absorbed into a plausible-looking premium. This
 * check validates the shape of the gap, not its magnitude, and is deliberately no defence against
 * a formula-level mistake — only against OCR misreads and wrong-month tables.
 */
export function crossCheckGrossRates(
  grossRatesTenthBps: number[],
  baseRateTenthBps: number,
): { ok: boolean; reason?: string } {
  for (const grossRate of grossRatesTenthBps) {
    const gap = grossRate - baseRateTenthBps;
    if (gap < -PREMIUM_TOLERANCE_TENTH_BPS || gap > PREMIUM_MAX_TENTH_BPS) {
      return { ok: false, reason: `implied premium ${gap / 1000}pp is outside the plausible 0–3.00pp range` };
    }
    const remainder = Math.abs(gap) % PREMIUM_STEP_TENTH_BPS;
    if (Math.min(remainder, PREMIUM_STEP_TENTH_BPS - remainder) > PREMIUM_TOLERANCE_TENTH_BPS) {
      return { ok: false, reason: `implied premium ${gap / 1000}pp is not a multiple of 0.25pp` };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Conditional upsert: a hand-entered `MANUAL_OVERRIDE` row always wins over a later scrape (the
 * `where` on a Postgres `DO UPDATE` filters on the *existing* row). `deleted_at` is cleared so a
 * soft-deleted month can be re-ingested rather than blocking the unique key forever.
 */
export function buildRateUpsertQuery(
  db: Kysely<SqlDatabase>,
  input: { baseRateBps: number; effectiveMonth: string; financialAssetKey: number; source?: string },
  now: Date,
) {
  return db
    .insertInto('certificado_aforro_rate_period')
    .values({
      base_rate_bps: input.baseRateBps,
      created_at: now,
      effective_month: input.effectiveMonth,
      financial_asset_key: input.financialAssetKey,
      source: input.source ?? RATE_SOURCE_SCRAPED,
      updated_at: now,
    })
    .onConflict((conflict) =>
      conflict
        .columns(['financial_asset_key', 'effective_month'])
        .doUpdateSet({ base_rate_bps: input.baseRateBps, deleted_at: null, source: input.source ?? RATE_SOURCE_SCRAPED, updated_at: now })
        .where('certificado_aforro_rate_period.source', '!=', 'MANUAL_OVERRIDE'));
}

function createRateSyncStore(db: Kysely<SqlDatabase>, now: () => Date = () => new Date()): RateSyncStore {
  return {
    findFinancialAssetKey: async (symbol) => {
      const row = await db
        .selectFrom('financial_asset')
        .select('financial_asset_key')
        .where('symbol', '=', symbol)
        .where('deleted_at', 'is', null)
        .limit(1)
        .executeTakeFirst();
      return row?.financial_asset_key as number | undefined;
    },
    upsertRatePeriod: async (input) => {
      await buildRateUpsertQuery(db, input, now()).execute();
    },
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * The C/D/E offset derivation stays exact under capping only because the cap gap and the formula
 * gap are the same 100bps (`min(x, 250) + 100 === min(x + 100, 350)`). That is a real property of
 * the two Portarias, not a coincidence of our constants — but nothing stops a future edit to
 * `CERTIFICADO_AFORRO_SERIES_CONSTANTS` from breaking it silently, so assert it at run time.
 */
export function assertCapOffsetIdentity(): { ok: boolean; reason?: string } {
  const serieFCapBps = CERTIFICADO_AFORRO_SERIES_CONSTANTS[SERIE_F_SYMBOL]?.capBps;
  const offsetBps = CDE_FORMULA_OFFSET_TENTH_BPS / TENTH_BPS_PER_BPS;

  for (const symbol of [SERIE_C_SYMBOL, 'CA-SERIE-D', 'CA-SERIE-E']) {
    const capBps = CERTIFICADO_AFORRO_SERIES_CONSTANTS[symbol]?.capBps;
    if (serieFCapBps === undefined || capBps === undefined) {
      return { ok: false, reason: `missing cap constant for ${serieFCapBps === undefined ? SERIE_F_SYMBOL : symbol}` };
    }
    if (capBps - serieFCapBps !== offsetBps) {
      return { ok: false, reason: `${symbol} cap (${capBps}bps) minus ${SERIE_F_SYMBOL} cap (${serieFCapBps}bps) is not the ${offsetBps}bps formula offset` };
    }
  }

  return { ok: true };
}

function captureFailure(message: string, stage: string, extra: Record<string, unknown> = {}, symbol?: string) {
  Sentry.captureMessage(message, { extra, tags: { job: JOB_NAME, stage, ...(symbol ? { series: symbol } : {}) } });
  logger.warn({ ...extra, stage, symbol }, message);
}

/**
 * Reads a series' published table and checks it against the derived base rate. Never throws —
 * a failure to *run* the check is reported as `unavailable`, which the caller deliberately treats
 * differently from `disagreed`. See {@link CrossCheckStatus}.
 */
async function runCrossCheck(
  html: string,
  series: CrossCheckedSeries,
  targetMonth: Date,
  cdeBaseRateTenthBps: number,
  context: { cdeBaseRateBps: number; effectiveMonth: string },
  deps: Required<Pick<CertificadoAforroRateSyncDeps, 'convertPdfToImage' | 'extractPdfText' | 'fetch' | 'ocr'>>,
): Promise<CrossCheckStatus> {
  const symbol = `CA-SERIE-${series}`;
  const pdfUrl = extractPdfLink(html, series) ?? buildFallbackPdfUrl(series, targetMonth);

  let grossRates: number[];
  try {
    grossRates = await readSeriesGrossRatesTenthBps(pdfUrl, series, targetMonth, deps);
  } catch (error) {
    // Infrastructure, not evidence. Alert so the missing safety net is visible, but let the caller
    // write the arithmetically-derived rate anyway.
    Sentry.captureException(error, { tags: { job: JOB_NAME, series: symbol, stage: 'cross-check-unavailable' } });
    logger.warn(
      { ...context, error, symbol },
      'Certificado de Aforro cross-check could not run — writing the derived rate unverified',
    );
    return 'unavailable';
  }

  const crossCheck = crossCheckGrossRates(grossRates, cdeBaseRateTenthBps);
  if (!crossCheck.ok) {
    captureFailure(
      `Certificado de Aforro rate cross-check disagreed for ${symbol}`,
      'cross-check-mismatch',
      { ...context, grossRates, pdfUrl, reason: crossCheck.reason },
      symbol,
    );
    return 'disagreed';
  }

  return 'passed';
}

async function writeRate(
  store: RateSyncStore,
  symbol: string,
  effectiveMonth: string,
  baseRateBps: number,
  source?: string,
): Promise<boolean> {
  const financialAssetKey = await store.findFinancialAssetKey(symbol);
  if (financialAssetKey === undefined) {
    captureFailure(`Certificado de Aforro FinancialAsset row missing for ${symbol}`, 'lookup', {}, symbol);
    return false;
  }

  await store.upsertRatePeriod({ baseRateBps, effectiveMonth, financialAssetKey, ...(source ? { source } : {}) });
  logger.info({ baseRateBps, effectiveMonth, source: source ?? RATE_SOURCE_SCRAPED, symbol }, 'Certificado de Aforro rate period upserted');
  return true;
}

export const handleCertificadoAforroRateSyncAutoJob = async (
  _job: Job<Record<string, never>>,
  deps: CertificadoAforroRateSyncDeps = {},
): Promise<CertificadoAforroRateSyncResult> => {
  const now = deps.now?.() ?? new Date();
  const targetMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const effectiveMonth = toEffectiveMonth(targetMonth);
  const fetchImpl = deps.fetch ?? fetch;
  const convertPdfToImage = deps.convertPdfToImage ?? convertPDFToImage;
  const extractPdfText = deps.extractPdfText ?? extractPDFTextLayer;
  const ocr =
    deps.ocr ??
    ((input: { images: string[]; prompt: string }) =>
      // Verified against production Azure: the vision deployment (AZURE_OPENAI_OCR_DEPLOYMENT,
      // `gpt-5.4-nano`) accepts `json_schema` at `strict: true` and returns schema-conforming
      // bodies. Keep `strict: true`: a non-strict schema would be a weaker guarantee on
      // money-critical output.
      //
      // What is unreliable is the model's *reading*: it does not honour the prompt's
      // "only rows matching desde <month>" filter and mixes in other quarters' rows. That is why
      // this call is only a fall-back for an image-only PDF — see the docblock. It stays
      // untested by CI (every test injects `deps.ocr`), which is acceptable only because the
      // deterministic path above is the one that actually runs, and that one is covered against the
      // real PDFs in `certificado-aforro-rate-table.test.ts`.
      OpenAI.promptWithImages({
        images: input.images,
        mimeType: 'image/png',
        prompt: input.prompt,
        responseFormat: RATE_TABLE_RESPONSE_FORMAT,
      }));
  const store = deps.store ?? createRateSyncStore(sqlQuery(DI.em), () => now);
  const written: string[] = [];

  let html: null | string;
  try {
    html = await fetchAnnouncementPage(targetMonth, fetchImpl);
  } catch (error) {
    Sentry.captureException(error, { tags: { job: JOB_NAME, stage: 'fetch-page' } });
    logger.error({ effectiveMonth, error }, 'Certificado de Aforro announcement page fetch failed');
    return { crossChecks: {}, outcome: 'fetch-failed', written };
  }

  if (html === null) {
    logger.info({ effectiveMonth }, 'Certificado de Aforro announcement page not published yet — skipping');
    return { crossChecks: {}, outcome: 'not-published', written };
  }

  const baseRateTenthBps = extractSerieFRateTenthBps(html, targetMonth);
  if (baseRateTenthBps === null) {
    captureFailure(
      'Certificado de Aforro Série F rate sentence not found on a published announcement page',
      'parse-serie-f',
      { effectiveMonth, url: buildAnnouncementUrl(targetMonth) },
      SERIE_F_SYMBOL,
    );
    return { crossChecks: {}, outcome: 'parse-failed', written };
  }

  const baseRateBps = tenthBpsToBps(baseRateTenthBps);
  if (!isSaneRateBps(baseRateBps, sanityMaxBpsFor(SERIE_F_SYMBOL))) {
    captureFailure(
      `Certificado de Aforro rate sanity check failed for ${SERIE_F_SYMBOL}`,
      'sanity-check',
      { baseRateBps, effectiveMonth, maxBps: sanityMaxBpsFor(SERIE_F_SYMBOL) },
      SERIE_F_SYMBOL,
    );
    return { crossChecks: {}, outcome: 'sanity-failed', written };
  }

  try {
    if (await writeRate(store, SERIE_F_SYMBOL, effectiveMonth, baseRateBps)) written.push(SERIE_F_SYMBOL);
  } catch (error) {
    Sentry.captureException(error, { tags: { job: JOB_NAME, series: SERIE_F_SYMBOL, stage: 'upsert' } });
    logger.error({ effectiveMonth, error }, 'Certificado de Aforro rate upsert failed for Série F');
  }

  // Séries C/D/E's formula is `Euribor 3M + 1.00pp` where F's is `Euribor 3M` alone, so their base
  // rate is F's published figure plus 100bps. This stays exact even when F's figure is pinned at
  // F's own 2.50% cap, because the caps differ by the same 100bps — see the module docblock.
  const capOffset = assertCapOffsetIdentity();
  if (!capOffset.ok) {
    captureFailure(
      'Certificado de Aforro cap-offset identity no longer holds — cannot derive Séries C/D/E from Série F',
      'cap-offset-broken',
      { effectiveMonth, reason: capOffset.reason },
    );
    return { crossChecks: {}, outcome: 'cap-offset-broken', written };
  }

  const cdeBaseRateTenthBps = baseRateTenthBps + CDE_FORMULA_OFFSET_TENTH_BPS;
  const cdeBaseRateBps = tenthBpsToBps(cdeBaseRateTenthBps);
  if (!isSaneRateBps(cdeBaseRateBps, sanityMaxBpsFor(SERIE_C_SYMBOL))) {
    captureFailure(
      'Certificado de Aforro derived Séries C/D/E rate failed the sanity check',
      'sanity-check',
      { cdeBaseRateBps, effectiveMonth, maxBps: sanityMaxBpsFor(SERIE_C_SYMBOL) },
    );
    return { crossChecks: {}, outcome: 'sanity-failed', written };
  }

  const context = { cdeBaseRateBps, effectiveMonth };
  const writeDerived = async (symbol: string, stage: string, source?: string) => {
    try {
      if (await writeRate(store, symbol, effectiveMonth, cdeBaseRateBps, source)) written.push(symbol);
    } catch (error) {
      Sentry.captureException(error, { tags: { job: JOB_NAME, series: symbol, stage } });
      logger.warn({ ...context, error, symbol }, 'Certificado de Aforro rate upsert failed');
    }
  };

  // The rate written here is pure arithmetic on Série F's confirmed figure, so the PDF cross-check
  // gates the write only when it actively DISAGREES. A check that merely could not run withholds
  // nothing — see CrossCheckStatus.
  const crossChecks: Partial<Record<CrossCheckedSeries, CrossCheckStatus>> = {};
  for (const series of CROSS_CHECKED_SERIES) {
    const status = await runCrossCheck(html, series, targetMonth, cdeBaseRateTenthBps, context, {
      convertPdfToImage,
      extractPdfText,
      fetch: fetchImpl,
      ocr,
    });
    crossChecks[series] = status;
    if (status === 'disagreed') continue;

    await writeDerived(`CA-SERIE-${series}`, 'upsert');
  }

  // Série C has no publication of its own, so it inherits Série D's *derivation* — which is the
  // same arithmetic, not D's row. It is therefore withheld only when D's table actively disagreed
  // (real evidence the derivation is wrong), not when D's check simply couldn't run.
  if (crossChecks.D !== 'disagreed') await writeDerived(SERIE_C_SYMBOL, 'upsert-derived-from-d', RATE_SOURCE_C_NO_OWN_CROSSCHECK);

  return { crossChecks, outcome: 'completed', written };
};
