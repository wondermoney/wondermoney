import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@sentry/node', () => sentry);

import {
  handleCertificadoAforroRateSyncAutoJob,
  parseGrossRatesFromTableText,
  readSeriesGrossRatesTenthBps,
} from '@app/jobs/certificado-aforro-rate-sync.worker';
import { extractPDFTextLayer } from '@utils/documents';

import { pgBossJob } from '../../__tests__/__helpers__/pgboss-job';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * The real files IGCP linked from the August-2026 announcement page, downloaded 2026-08-24 from
 * `https://www.igcp.pt/sites/default/files/2026-07/Taxa_Anual_<D|E>%2BPP.pdf`.
 *
 * These are committed deliberately. The vision-OCR path they replace was never exercised by CI —
 * every test injected `deps.ocr` — which is exactly why a systematic misread of these tables ran
 * unnoticed in production for two weeks (API-WC / API-WD). Parsing the genuine bytes is the only
 * assertion that would have caught it.
 */
const FIXTURE_PDF: Record<'D' | 'E', string> = {
  D: path.join(FIXTURES, 'igcp-taxa-anual-D-agosto-2026.pdf'),
  E: path.join(FIXTURES, 'igcp-taxa-anual-E-agosto-2026.pdf'),
};

const AUGUST_2026 = new Date(Date.UTC(2026, 7, 1));
const JUNE_2026 = new Date(Date.UTC(2026, 5, 1));

/** C/D/E's August-2026 base: Série F's published 2,474% + the 1.00pp formula offset. */
const CDE_BASE_TENTH_BPS = 3474;

async function fixtureText(series: 'D' | 'E') {
  return extractPDFTextLayer(await readFixture(series));
}

function readFixture(series: 'D' | 'E') {
  return readFile(FIXTURE_PDF[series]);
}

describe('IGCP rate-table text layer', () => {
  it.each(['D', 'E'] as const)('extracts a readable text layer from the real Série %s PDF', async (series) => {
    const text = await fixtureText(series);

    expect(text).toContain(`SÉRIE ${series}`);
    // Accents must survive — the month names the row filter keys on depend on it.
    expect(text).toContain('Prémio de Permanência');
    expect(text).toContain('trimestre corrente de contagem de juros');
  });
});

describe('parseGrossRatesFromTableText', () => {
  /**
   * The bug behind API-WC/API-WD. Each table lists every cohort's rate for *its own* current
   * quarterly interest period, and those quarters start in three different months. Only the
   * rows whose quarter began in the target month may be compared against that month's base rate.
   */
  it('sees three quarter vintages in the real Série E table and keeps only the target month', async () => {
    const parsed = parseGrossRatesFromTableText(await fixtureText('E'), AUGUST_2026);

    expect(parsed.totalRows).toBe(24);
    // 8 rows per vintage: junho (4,215 x5 + 3,715 x3), julho (4,356 x5 + 3,856 x3), agosto below.
    expect(parsed.matched).toEqual([4474, 4474, 4474, 4474, 4474, 3974, 3974, 3974]);
  });

  it('keeps only the target month in the real Série D table', async () => {
    const parsed = parseGrossRatesFromTableText(await fixtureText('D'), AUGUST_2026);

    expect(parsed.totalRows).toBe(6);
    expect(parsed.matched).toEqual([4474, 4474]);
  });

  it.each(['D', 'E'] as const)(
    "resolves every Série %s August row onto a documented premium bracket, so the cross-check passes",
    async (series) => {
      const { matched } = parseGrossRatesFromTableText(await fixtureText(series), AUGUST_2026);
      const premia = [...new Set(matched.map((rate) => rate - CDE_BASE_TENTH_BPS))].sort((a, b) => a - b);

      // +0.50pp (E's year 2-5) and +1.00pp (year 6-10). D's cohorts are all in the +1.00pp bracket.
      expect(premia).toEqual(series === 'E' ? [500, 1000] : [1000]);
    },
  );

  it('rejects the rows the vision model was returning instead — they are other months, not misreads', async () => {
    const { matched } = parseGrossRatesFromTableText(await fixtureText('E'), AUGUST_2026);

    // 4,215% is a *June*-quarter row. It is what OCR kept handing back, and 4.215 - 3.474 = 0.741pp
    // is the exact `reason` string both Sentry issues reported.
    expect(matched).not.toContain(4215);
    expect(matched).not.toContain(4356);
  });

  it('matches nothing when the table predates the target month, rather than falling back to a stale row', async () => {
    // June's quarters exist in this table, so a June target legitimately matches; a month IGCP has
    // not published yet must come back empty so the caller can treat the check as unavailable.
    expect(parseGrossRatesFromTableText(await fixtureText('D'), JUNE_2026).matched).toEqual([4215, 4215]);
    expect(parseGrossRatesFromTableText(await fixtureText('D'), new Date(Date.UTC(2026, 8, 1))).matched).toEqual([]);
  });

  it('returns no rows for text that is not a rate table', () => {
    expect(parseGrossRatesFromTableText('', AUGUST_2026)).toEqual({ matched: [], totalRows: 0 });
    expect(parseGrossRatesFromTableText('Taxa de Juro Anual', AUGUST_2026)).toEqual({ matched: [], totalRows: 0 });
  });
});

describe('readSeriesGrossRatesTenthBps', () => {
  function deps(overrides: Partial<Parameters<typeof readSeriesGrossRatesTenthBps>[3]> = {}) {
    return {
      convertPdfToImage: () => Promise.reject(new Error('vision path must not be reached')),
      extractPdfText: extractPDFTextLayer,
      fetch: ((url: string) =>
        Promise.resolve({
          arrayBuffer: async () => {
            const series = /Taxa_Anual_(\w)/.exec(url)?.[1] as 'D' | 'E';
            const buffer = await readFixture(series);
            return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
          },
          ok: true,
          status: 200,
        })) as unknown as typeof fetch,
      ocr: () => Promise.reject(new Error('vision path must not be reached')),
      ...overrides,
    } as Parameters<typeof readSeriesGrossRatesTenthBps>[3];
  }

  it.each(['D', 'E'] as const)('reads Série %s end-to-end from the real PDF without calling the vision model', async (series) => {
    const rates = await readSeriesGrossRatesTenthBps(
      `https://www.igcp.pt/sites/default/files/2026-07/Taxa_Anual_${series}%2BPP.pdf`,
      series,
      AUGUST_2026,
      deps(),
    );

    expect(rates).toEqual(series === 'E' ? [4474, 4474, 4474, 4474, 4474, 3974, 3974, 3974] : [4474, 4474]);
  });

  it('falls back to the vision model when the PDF has no text layer', async () => {
    let visionCalls = 0;

    const rates = await readSeriesGrossRatesTenthBps('https://example.test/Taxa_Anual_D%2BPP.pdf', 'D', AUGUST_2026, {
      ...deps({
        convertPdfToImage: () => Promise.resolve(['base64-png']),
        extractPdfText: () => Promise.resolve(''),
      }),
      ocr: () => {
        visionCalls += 1;
        return Promise.resolve({ answer: JSON.stringify({ grossRatesPercent: [4.474], uncertain: false }) });
      },
    });

    expect(visionCalls).toBe(1);
    expect(rates).toEqual([4474]);
  });

  it('throws rather than guessing when the table parses but holds no row for the target month', async () => {
    await expect(
      readSeriesGrossRatesTenthBps(
        'https://www.igcp.pt/sites/default/files/2026-07/Taxa_Anual_D%2BPP.pdf',
        'D',
        new Date(Date.UTC(2026, 8, 1)),
        deps(),
      ),
    ).rejects.toThrow(/setembro de 2026/);
  });
});

/**
 * The regression test for API-WC / API-WD. Everything below is real: IGCP's August-2026
 * announcement markup and the two PDFs it linked. Nothing about the rate tables is mocked, so a
 * future change that reintroduces cross-quarter row mixing fails here rather than in production.
 */
describe('handleCertificadoAforroRateSyncAutoJob against the real August-2026 IGCP files', () => {
  const AUGUST_2026_HTML = `
<h1 class="page-title">Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em agosto de 2026</h1>
<p>A taxa de juro bruta para novas subscrições de Certificados de Aforro, Série F, em agosto de 2026 foi fixada em 2,474%.</p>
<p>» <a href="/sites/default/files/2026-07/Taxa_Anual_F%2BPP_0.pdf">Série F</a></p>
<p>» <a href="/sites/default/files/2026-07/Taxa_Anual_E%2BPP.pdf">Série E</a></p>
<p>» <a href="/sites/default/files/2026-07/Taxa_Anual_D%2BPP.pdf">Série D</a></p>`;

  const ASSET_KEYS: Record<string, number> = { 'CA-SERIE-C': 11, 'CA-SERIE-D': 12, 'CA-SERIE-E': 13, 'CA-SERIE-F': 14 };

  it('passes both cross-checks and writes F at 247bps and C/D/E at 347bps', async () => {
    sentry.captureMessage.mockReset();
    sentry.captureException.mockReset();
    const upsert = vi.fn().mockResolvedValue(undefined);

    const result = await handleCertificadoAforroRateSyncAutoJob(pgBossJob<Record<string, never>>({}), {
      convertPdfToImage: () => Promise.reject(new Error('vision path must not be reached')),
      extractPdfText: extractPDFTextLayer,
      fetch: ((url: string) =>
        Promise.resolve(
          url.endsWith('.pdf')
            ? {
                arrayBuffer: async () => {
                  const buffer = await readFixture(/Taxa_Anual_(\w)/.exec(url)?.[1] as 'D' | 'E');
                  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
                },
                ok: true,
                status: 200,
              }
            : { ok: true, status: 200, text: () => Promise.resolve(AUGUST_2026_HTML) },
        )) as unknown as typeof fetch,
      now: () => new Date(Date.UTC(2026, 7, 24)),
      ocr: () => Promise.reject(new Error('vision path must not be reached')),
      store: {
        findFinancialAssetKey: (symbol) => Promise.resolve(ASSET_KEYS[symbol]),
        upsertRatePeriod: upsert,
      },
    });

    expect(result.outcome).toBe('completed');
    expect(result.crossChecks).toEqual({ D: 'passed', E: 'passed' });
    expect(result.written).toEqual(['CA-SERIE-F', 'CA-SERIE-D', 'CA-SERIE-E', 'CA-SERIE-C']);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();

    const byKey = Object.fromEntries(
      (upsert.mock.calls as [{ baseRateBps: number; effectiveMonth: string; financialAssetKey: number }][]).map(
        ([input]) => [input.financialAssetKey, input],
      ),
    );
    expect(byKey[ASSET_KEYS['CA-SERIE-F']!]).toMatchObject({ baseRateBps: 247, effectiveMonth: '2026-08-01' });
    for (const symbol of ['CA-SERIE-C', 'CA-SERIE-D', 'CA-SERIE-E']) {
      expect(byKey[ASSET_KEYS[symbol]!]).toMatchObject({ baseRateBps: 347, effectiveMonth: '2026-08-01' });
    }
  });
});
