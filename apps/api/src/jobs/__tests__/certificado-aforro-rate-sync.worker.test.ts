import { knex as knexFactory } from '@mikro-orm/postgresql';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@sentry/node', () => sentry);

import {
  CERTIFICADO_AFORRO_RATE_SYNC_CRON,
  CERTIFICADO_AFORRO_RATE_SYNC_QUEUE,
  ensureCertificadoAforroRateSyncQueue,
  scheduleCertificadoAforroRateSyncAutoJob,
} from '@app/jobs/certificado-aforro-rate-sync.queue';
import {
  assertCapOffsetIdentity,
  buildAnnouncementUrl,
  buildFallbackPdfUrl,
  buildRateUpsertQuery,
  type CertificadoAforroRateSyncDeps,
  crossCheckGrossRates,
  extractPdfLink,
  extractSerieFRateTenthBps,
  handleCertificadoAforroRateSyncAutoJob,
  type RateSyncStore,
  tenthBpsToBps,
} from '@app/jobs/certificado-aforro-rate-sync.worker';
import { CERTIFICADO_AFORRO_SERIES_CONSTANTS } from '@service/portfolio/certificado-aforro-calculation.service';

import { pgBossJob } from '../../__tests__/__helpers__/pgboss-job';

/**
 * Verbatim excerpt of the real https://www.igcp.pt/pt/noticias/...-em-agosto-de-2026 page
 * (fetched live 2026-08-06), trimmed to the parts this worker reads.
 */
const AUGUST_2026_HTML = `
<h1 class="page-title">Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em agosto de 2026</h1>
<div class="content_body alignwide">
<p class="text-align-justify">A taxa de juro bruta para novas subscrições de Certificados de Aforro, Série F, em agosto de 2026 foi fixada em 2,474%.</p>
<p class="text-align-justify">&nbsp;</p>
<p class="text-align-justify"><br>» <a href="/sites/default/files/2026-07/Taxa_Anual_F%2BPP_0.pdf" target="_blank">Informação de taxas de juro dos Certificados de Aforro - Série F</a></p>
<p class="text-align-justify">» <a href="/sites/default/files/2026-07/Taxa_Anual_E%2BPP.pdf" target="_blank">Informação de taxas de juro dos Certificados de Aforro - Série E</a></p>
<p class="text-align-justify">» <a href="/sites/default/files/2026-07/Taxa_Anual_D%2BPP.pdf" target="_blank">Informação de taxas de juro dos Certificados de Aforro - Série D</a></p>
<p class="text-align-justify">» <a href="/sites/default/files/2026-07/Taxa_Anual_B%2BPP.pdf" target="_blank">Informação de taxas de juro dos Certificados de Aforro - Série B</a></p>
</div>`;

const NOW = () => new Date(Date.UTC(2026, 7, 6));
const AUGUST_2026 = new Date(Date.UTC(2026, 7, 1));

/**
 * The real August-2026 figures from IGCP's Série D / Série E tables. They are premium-inclusive,
 * and they are gaps over the C/D/E base of 3.474% (= F's published 2.474% + the 1.00pp formula
 * offset), NOT over F's raw 2.474%:
 *   D 4,474% - 3,474% = +1.00pp  (2016/2017 cohorts, at/near their 10y maturity)
 *   E 4,474% - 3,474% = +1.00pp  (2017 - Aug 2021 cohorts, E's year 6-10 bracket)
 *   E 3,974% - 3,474% = +0.50pp  (Sep 2021 - 2023 cohorts, E's year 2-5 bracket)
 * Against F's raw figure these would imply +2.00pp / +1.50pp, which do not exist in Série E's
 * schedule at all (it tops out at +1.0pp) — that mismatch is what exposed the missing offset.
 */
const REAL_GROSS_RATES = { D: [4.474], E: [4.474, 3.974] };

/** F's published figure and the C/D/E base derived from it, in whole bps, for August 2026. */
const SERIE_F_BPS = 247;
const SERIE_CDE_BPS = 347;

const ASSET_KEYS: Record<string, number> = { 'CA-SERIE-C': 11, 'CA-SERIE-D': 12, 'CA-SERIE-E': 13, 'CA-SERIE-F': 14 };

interface Harness {
  deps: CertificadoAforroRateSyncDeps;
  ocr: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
}

function htmlResponse(body: string) {
  return { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), ok: true, status: 200, text: () => Promise.resolve(body) };
}

function makeHarness(
  options: {
    html?: string;
    missingAssets?: string[];
    ocrAnswer?: (series: string) => string;
    pageResponse?: () => unknown;
    pdfResponse?: () => unknown;
  } = {},
): Harness {
  const upsert = vi.fn().mockResolvedValue(undefined);
  const ocr = vi.fn((input: { images: string[]; prompt: string }) =>
    Promise.resolve({
      answer: (options.ocrAnswer ?? ((series: string) => JSON.stringify({ grossRatesPercent: REAL_GROSS_RATES[series as 'D' | 'E'], uncertain: false })))(
        /SÉRIE (\w)/.exec(input.prompt)?.[1] ?? 'D',
      ),
    }),
  );

  const store: RateSyncStore = {
    findFinancialAssetKey: (symbol) =>
      Promise.resolve(options.missingAssets?.includes(symbol) ? undefined : ASSET_KEYS[symbol]),
    upsertRatePeriod: upsert,
  };

  const fetchImpl = vi.fn((url: string) =>
    Promise.resolve(
      url.endsWith('.pdf')
        ? (options.pdfResponse?.() ?? pdfResponse())
        : (options.pageResponse?.() ?? htmlResponse(options.html ?? AUGUST_2026_HTML)),
    ),
  );

  return {
    deps: {
      convertPdfToImage: () => Promise.resolve(['base64-png']),
      fetch: fetchImpl as unknown as typeof fetch,
      now: NOW,
      ocr: ocr as unknown as NonNullable<CertificadoAforroRateSyncDeps['ocr']>,
      store,
    },
    ocr,
    upsert,
  };
}

function notFoundResponse() {
  return { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), ok: false, status: 404, text: () => Promise.resolve('') };
}

function pdfResponse() {
  return { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)), ok: true, status: 200, text: () => Promise.resolve('') };
}

/** Collapses the dry-run store's calls into `{ symbol: baseRateBps }` via the fake asset keys. */
function writtenRates(upsert: ReturnType<typeof vi.fn>): Record<string, number> {
  const bySymbol: Record<string, number> = {};
  for (const [input] of upsert.mock.calls as [{ baseRateBps: number; financialAssetKey: number }][]) {
    const symbol = Object.entries(ASSET_KEYS).find(([, key]) => key === input.financialAssetKey)?.[0];
    if (symbol) bySymbol[symbol] = input.baseRateBps;
  }
  return bySymbol;
}

const JOB = pgBossJob<Record<string, never>>({});

beforeEach(() => {
  sentry.captureException.mockReset();
  sentry.captureMessage.mockReset();
});

describe('certificado-aforro-rate-sync queue', () => {
  it('creates an exclusive, no-retry queue and schedules it daily in UTC', async () => {
    const boss = { createQueue: vi.fn().mockResolvedValue(undefined), schedule: vi.fn().mockResolvedValue(undefined) };

    await ensureCertificadoAforroRateSyncQueue(boss);
    await scheduleCertificadoAforroRateSyncAutoJob(boss);

    // objectContaining: 'exclusive' + no retries is the invariant (one rate sync at a time, never
    // re-run automatically). Orthogonal options such as an expiry or a dead-letter target must not
    // fail this test.
    expect(boss.createQueue).toHaveBeenCalledWith(
      CERTIFICADO_AFORRO_RATE_SYNC_QUEUE,
      expect.objectContaining({ policy: 'exclusive', retryLimit: 0 }),
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      CERTIFICADO_AFORRO_RATE_SYNC_QUEUE,
      CERTIFICADO_AFORRO_RATE_SYNC_CRON,
      {},
      { key: CERTIFICADO_AFORRO_RATE_SYNC_QUEUE, singletonKey: CERTIFICADO_AFORRO_RATE_SYNC_QUEUE, tz: 'UTC' },
    );
  });
});

describe('IGCP page/link addressing', () => {
  it('builds the live announcement URL for the target month', () => {
    expect(buildAnnouncementUrl(AUGUST_2026)).toBe(
      'https://www.igcp.pt/pt/noticias/taxas-de-juro-dos-certificados-de-aforro-das-series-b-d-e-e-f-em-agosto-de-2026',
    );
    expect(buildAnnouncementUrl(new Date(Date.UTC(2026, 2, 1)))).toContain('em-março-de-2026');
  });

  it('scrapes each series PDF link from the page, tolerating the re-upload suffix', () => {
    expect(extractPdfLink(AUGUST_2026_HTML, 'D')).toBe('https://www.igcp.pt/sites/default/files/2026-07/Taxa_Anual_D%2BPP.pdf');
    expect(extractPdfLink(AUGUST_2026_HTML, 'E')).toBe('https://www.igcp.pt/sites/default/files/2026-07/Taxa_Anual_E%2BPP.pdf');
    expect(extractPdfLink('<a href="/f/Taxa_Anual_D+PP_2.pdf">x</a>', 'D')).toBe('https://www.igcp.pt/f/Taxa_Anual_D+PP_2.pdf');
    expect(extractPdfLink('<p>no links here</p>', 'D')).toBeNull();
  });

  it('falls back to the prior-month folder pattern when no link is found', () => {
    expect(buildFallbackPdfUrl('E', AUGUST_2026)).toBe('https://www.igcp.pt/sites/default/files/2026-07/Taxa_Anual_E%2BPP.pdf');
    expect(buildFallbackPdfUrl('D', new Date(Date.UTC(2026, 0, 1)))).toBe(
      'https://www.igcp.pt/sites/default/files/2025-12/Taxa_Anual_D%2BPP.pdf',
    );
  });
});

describe('Série F HTML extraction', () => {
  it('extracts the published rate at full published precision', () => {
    expect(extractSerieFRateTenthBps(AUGUST_2026_HTML, AUGUST_2026)).toBe(2474);
  });

  it('tolerates HTML entities and non-breaking spaces in the sentence', () => {
    const html = 'S&eacute;rie F,&nbsp;em mar&ccedil;o de 2026 foi fixada em 2,195 %';
    expect(extractSerieFRateTenthBps(html, new Date(Date.UTC(2026, 2, 1)))).toBe(2195);
  });

  it('returns null (no throw) when the sentence is absent or names another month', () => {
    expect(extractSerieFRateTenthBps('<p>nothing to see</p>', AUGUST_2026)).toBeNull();
    expect(extractSerieFRateTenthBps(AUGUST_2026_HTML, new Date(Date.UTC(2026, 8, 1)))).toBeNull();
  });

  it('rounds tenths of a basis point half-up rather than truncating', () => {
    // 2,474% -> 247.4bp -> 247; 2,356% -> 235.6bp -> 236 (truncation would bias every month down).
    expect(tenthBpsToBps(2474)).toBe(247);
    expect(tenthBpsToBps(2356)).toBe(236);
  });
});

describe('Séries C/D/E base-rate derivation', () => {
  it("holds C/D/E's caps exactly 1.00pp above Série F's, which is what makes the offset exact when capped", () => {
    // min(x, 250) + 100 === min(x + 100, 350) only because the cap gap equals the formula gap.
    expect(assertCapOffsetIdentity()).toEqual({ ok: true });
    expect(CERTIFICADO_AFORRO_SERIES_CONSTANTS['CA-SERIE-F']?.capBps).toBe(250);
    for (const symbol of ['CA-SERIE-C', 'CA-SERIE-D', 'CA-SERIE-E']) {
      expect(CERTIFICADO_AFORRO_SERIES_CONSTANTS[symbol]?.capBps).toBe(350);
    }
  });
});

describe('D/E cross-check', () => {
  it("accepts the real Série E table against the derived C/D/E base, landing on E's documented brackets", () => {
    // E's schedule is +0.5pp (yr 2-5) and +1.0pp (yr 6-10). Against the 3.474% derived base the
    // two published rates resolve to exactly those two brackets.
    expect(4474 - 3474).toBe(1000); // +1.00pp -> year 6-10
    expect(3974 - 3474).toBe(500); //  +0.50pp -> year 2-5
    expect(crossCheckGrossRates([4474, 3974], 3474).ok).toBe(true);
  });

  it('accepts a zero premium (a first-year cohort)', () => {
    expect(crossCheckGrossRates([3474], 3474).ok).toBe(true);
  });

  it('rejects a rate below the base rate, an implausible premium, or a non-0.25pp step', () => {
    expect(crossCheckGrossRates([3000], 3474).ok).toBe(false);
    expect(crossCheckGrossRates([9474], 3474).ok).toBe(false);
    expect(crossCheckGrossRates([4574], 3474).ok).toBe(false);
  });

  it('cannot by itself catch a whole-percentage-point offset error — hence the explicit derivation', () => {
    // Documented limitation: 100bps is 4 x 0.25pp, so omitting the formula offset still "passes".
    // This test pins that blind spot so nobody mistakes the cross-check for a formula guard.
    expect(crossCheckGrossRates([4474, 3974], 2474).ok).toBe(true);
  });
});

describe('rate upsert SQL', () => {
  it('never overwrites a MANUAL_OVERRIDE row', () => {
    const knex = knexFactory({ client: 'pg' });
    const sql = buildRateUpsertQuery(
      knex,
      { baseRateBps: 247, effectiveMonth: '2026-08-01', financialAssetKey: 42 },
      new Date(Date.UTC(2026, 7, 6)),
    ).toQuery();

    expect(sql).toContain('on conflict ("financial_asset_key", "effective_month") do update');
    expect(sql).toContain(`where "certificado_aforro_rate_period"."source" != 'MANUAL_OVERRIDE'`);
    expect(sql).toContain(`"base_rate_bps" = 247`);
  });

  it('defaults the provenance to a real scrape', () => {
    const knex = knexFactory({ client: 'pg' });
    const sql = buildRateUpsertQuery(
      knex,
      { baseRateBps: 247, effectiveMonth: '2026-08-01', financialAssetKey: 42 },
      new Date(Date.UTC(2026, 7, 6)),
    ).toQuery();

    expect(sql).toContain(`'IGCP_PDF_SCRAPE'`);
  });

  it('carries a caller-supplied provenance onto both insert and update (RAD-597)', () => {
    // The merge matters as much as the insert: a Série C row written before the
    // label existed keeps its old, false `IGCP_PDF_SCRAPE` for as long as the
    // update does not touch the column.
    const knex = knexFactory({ client: 'pg' });
    const sql = buildRateUpsertQuery(
      knex,
      { baseRateBps: 347, effectiveMonth: '2026-08-01', financialAssetKey: 43, source: 'IGCP_DERIVED_NO_SERIES_CROSSCHECK' },
      new Date(Date.UTC(2026, 7, 6)),
    ).toQuery();

    expect(sql).not.toContain(`'IGCP_PDF_SCRAPE'`);
    expect(sql.match(/IGCP_DERIVED_NO_SERIES_CROSSCHECK/gu)?.length).toBe(2);
  });
});

describe('handleCertificadoAforroRateSyncAutoJob', () => {
  it('writes F, D, E and C when the page and both PDF cross-checks agree', async () => {
    const { deps, upsert } = makeHarness();

    const result = await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

    expect(result.outcome).toBe('completed');
    expect(result.written).toEqual(['CA-SERIE-F', 'CA-SERIE-D', 'CA-SERIE-E', 'CA-SERIE-C']);

    // RAD-597: Série C is the only series with no published table to check
    // against, so its rows say so. F/D/E are cross-checked and stay unlabelled.
    const calls = upsert.mock.calls.map((c) => c[0] as { financialAssetKey: number; source?: string });
    const sourced = calls.filter((c) => c.source !== undefined);
    expect(sourced).toHaveLength(1);
    expect(sourced[0]?.source).toBe('IGCP_DERIVED_NO_SERIES_CROSSCHECK');
    // F stores the published Euribor-3M figure; C/D/E store it + the 1.00pp formula offset.
    expect(writtenRates(upsert)).toEqual({
      'CA-SERIE-C': SERIE_CDE_BPS,
      'CA-SERIE-D': SERIE_CDE_BPS,
      'CA-SERIE-E': SERIE_CDE_BPS,
      'CA-SERIE-F': SERIE_F_BPS,
    });
    for (const call of upsert.mock.calls) {
      expect(call[0]).toMatchObject({ effectiveMonth: '2026-08-01' });
    }
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('never writes Séries C/D/E at Série F\'s raw published figure (the +1.00pp offset bug)', async () => {
    const { deps, upsert } = makeHarness();

    await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

    for (const [symbol, rate] of Object.entries(writtenRates(upsert))) {
      if (symbol === 'CA-SERIE-F') continue;
      expect(rate).not.toBe(SERIE_F_BPS);
      expect(rate - SERIE_F_BPS).toBe(100);
    }
  });

  it('treats a 404 as not-yet-published: no writes, no Sentry noise', async () => {
    const { deps, upsert } = makeHarness({ pageResponse: notFoundResponse });

    const result = await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

    expect(result).toEqual({ crossChecks: {}, outcome: 'not-published', written: [] });
    expect(upsert).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('alerts and writes nothing when the page fetch fails for any other reason', async () => {
    const { deps, upsert } = makeHarness({
      pageResponse: () => ({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), ok: false, status: 503, text: () => Promise.resolve('') }),
    });

    const result = await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

    expect(result).toEqual({ crossChecks: {}, outcome: 'fetch-failed', written: [] });
    expect(upsert).not.toHaveBeenCalled();
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.anything(),
      { tags: { job: 'certificado-aforro-rate-sync', stage: 'fetch-page' } },
    );
  });

  it('alerts and writes nothing when a published page has no Série F sentence', async () => {
    const { deps, upsert } = makeHarness({ html: '<h1>Taxas de Juro dos Certificados de Aforro</h1>' });

    const result = await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

    expect(result.outcome).toBe('parse-failed');
    expect(upsert).not.toHaveBeenCalled();
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('Série F rate sentence not found'),
      expect.objectContaining({
        tags: { job: 'certificado-aforro-rate-sync', series: 'CA-SERIE-F', stage: 'parse-serie-f' },
      }),
    );
  });

  // Série F's sanity ceiling is its own 2.50% legal cap, not a generic band — IGCP's published
  // figure is already clamped to it, so anything above means we parsed the wrong number. This
  // matters because F is the only series with no independent cross-check of its own.
  it.each([
    ['a wildly misplaced decimal', '24,740%'],
    ['a figure just above Série F\'s 2.50% cap', '2,600%'],
  ])('alerts and writes nothing for %s', async (_label, published) => {
    const { deps, upsert } = makeHarness({ html: `Série F, em agosto de 2026 foi fixada em ${published}` });

    const result = await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

    expect(result.outcome).toBe('sanity-failed');
    expect(upsert).not.toHaveBeenCalled();
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('sanity check failed'),
      expect.objectContaining({
        tags: { job: 'certificado-aforro-rate-sync', series: 'CA-SERIE-F', stage: 'sanity-check' },
      }),
    );
  });

  it("still derives C/D/E correctly when Série F's figure is pinned at F's 2.50% cap", async () => {
    // Euribor 3M >= 2.50% => F publishes its capped 2,500%. C/D/E's true capped base is
    // min(Euribor + 100bps, 350bps) = 350bps, which is exactly 250 + 100 — the caps differ by the
    // same 100bps as the formulas, so no special-casing is needed.
    const { deps, upsert } = makeHarness({
      html: 'Série F, em agosto de 2026 foi fixada em 2,500%',
      ocrAnswer: (series) => JSON.stringify({ grossRatesPercent: series === 'D' ? [4.5] : [4.5, 4], uncertain: false }),
    });

    const result = await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

    expect(result.outcome).toBe('completed');
    expect(writtenRates(upsert)).toEqual({
      'CA-SERIE-C': 350,
      'CA-SERIE-D': 350,
      'CA-SERIE-E': 350,
      'CA-SERIE-F': 250,
    });
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  // --- cross-check UNAVAILABLE: the safety net didn't run, which is not evidence against the
  // arithmetically-derived rate. C/D/E are still written, with a distinct Sentry stage. ---
  describe.each([
    ['an UNCERTAIN OCR response', () => JSON.stringify({ grossRatesPercent: [], uncertain: true })],
    ['a bare UNCERTAIN string (schema-less refusal)', () => 'UNCERTAIN'],
    ['a non-numeric OCR answer', () => JSON.stringify({ grossRatesPercent: ['4,474%'], uncertain: false })],
    ['no answer at all', () => ''],
  ])('when the cross-check cannot run because of %s', (_label, ocrAnswer) => {
    it('still writes the derived C/D/E rate, but alerts that it went unverified', async () => {
      const { deps, upsert } = makeHarness({ ocrAnswer });

      const result = await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

      expect(result.crossChecks).toEqual({ D: 'unavailable', E: 'unavailable' });
      expect(result.written).toEqual(['CA-SERIE-F', 'CA-SERIE-D', 'CA-SERIE-E', 'CA-SERIE-C']);
      expect(writtenRates(upsert)).toEqual({
        'CA-SERIE-C': SERIE_CDE_BPS,
        'CA-SERIE-D': SERIE_CDE_BPS,
        'CA-SERIE-E': SERIE_CDE_BPS,
        'CA-SERIE-F': SERIE_F_BPS,
      });
      // One alert per series whose safety net didn't run, tagged so alert routing can tell this
      // apart from a genuine disagreement.
      expect(sentry.captureException).toHaveBeenCalledTimes(2);
      expect(sentry.captureException).toHaveBeenCalledWith(
        expect.anything(),
        { tags: { job: 'certificado-aforro-rate-sync', series: 'CA-SERIE-D', stage: 'cross-check-unavailable' } },
      );
      expect(sentry.captureMessage).not.toHaveBeenCalled();
    });
  });

  it('still writes C/D/E when the PDF itself cannot be fetched', async () => {
    const { deps } = makeHarness({ pdfResponse: notFoundResponse });

    const result = await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

    expect(result.crossChecks).toEqual({ D: 'unavailable', E: 'unavailable' });
    expect(result.written).toEqual(['CA-SERIE-F', 'CA-SERIE-D', 'CA-SERIE-E', 'CA-SERIE-C']);
  });

  // --- cross-check DISAGREED: real evidence the derivation may be wrong, so withhold. ---
  it('does not write D or C when D\'s table genuinely disagrees with the derived base rate', async () => {
    const { deps, upsert } = makeHarness({
      ocrAnswer: (series) =>
        JSON.stringify({ grossRatesPercent: series === 'D' ? [4.512] : REAL_GROSS_RATES.E, uncertain: false }),
    });

    const result = await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

    expect(result.crossChecks).toEqual({ D: 'disagreed', E: 'passed' });
    expect(result.written).toEqual(['CA-SERIE-F', 'CA-SERIE-E']);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('cross-check disagreed for CA-SERIE-D'),
      expect.objectContaining({
        tags: { job: 'certificado-aforro-rate-sync', series: 'CA-SERIE-D', stage: 'cross-check-mismatch' },
      }),
    );
  });

  it('withholds Série C only when Série D disagreed, never merely because D was unavailable', async () => {
    const disagreed = makeHarness({
      ocrAnswer: (series) =>
        JSON.stringify({ grossRatesPercent: series === 'D' ? [4.512] : REAL_GROSS_RATES.E, uncertain: false }),
    });
    const unavailable = makeHarness({
      ocrAnswer: (series) =>
        series === 'D' ? 'UNCERTAIN' : JSON.stringify({ grossRatesPercent: REAL_GROSS_RATES.E, uncertain: false }),
    });

    const whenDisagreed = await handleCertificadoAforroRateSyncAutoJob(JOB, disagreed.deps);
    const whenUnavailable = await handleCertificadoAforroRateSyncAutoJob(JOB, unavailable.deps);

    expect(whenDisagreed.written).not.toContain('CA-SERIE-C');
    expect(whenUnavailable.written).toContain('CA-SERIE-C');
    expect(whenUnavailable.written).toContain('CA-SERIE-D');
  });

  it('alerts instead of writing when a series has no FinancialAsset row', async () => {
    const { deps, upsert } = makeHarness({ missingAssets: ['CA-SERIE-E'] });

    const result = await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

    expect(result.written).toEqual(['CA-SERIE-F', 'CA-SERIE-D', 'CA-SERIE-C']);
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('FinancialAsset row missing for CA-SERIE-E'),
      expect.objectContaining({
        tags: { job: 'certificado-aforro-rate-sync', series: 'CA-SERIE-E', stage: 'lookup' },
      }),
    );
  });

  it('alerts and keeps going when an upsert throws', async () => {
    const { deps, upsert } = makeHarness();
    upsert.mockRejectedValueOnce(new Error('db down'));

    const result = await handleCertificadoAforroRateSyncAutoJob(JOB, deps);

    expect(result.written).toEqual(['CA-SERIE-D', 'CA-SERIE-E', 'CA-SERIE-C']);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
