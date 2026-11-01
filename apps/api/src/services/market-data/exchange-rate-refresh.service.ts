import { DI } from '@app/database/di';
import { sqlQuery, toDate } from '@app/database/sql';
import { Currency } from '@entity/Currency';

const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'JPY', 'GBP', 'AUD', 'CAD', 'CHF', 'SEK', 'NOK', 'BRL', 'DKK'] as const;
const HISTORY_GAP_DAYS = 3;
const BATCH_SIZE = 1000;

interface EcbSeries { date: string; rates: Record<string, number> }
interface ExchangeRateRow { date: Date; from_currency_key: number; rate: number; to_currency_key: number }
type Mode = 'daily' | 'full-history';

function buildRows(series: EcbSeries[], currencyKeyMap: Map<string, number>): ExchangeRateRow[] {
  const eurKey = currencyKeyMap.get('EUR'); if (!eurKey) return [];
  const rows: ExchangeRateRow[] = [];
  for (const day of series) {
    const currencies = SUPPORTED_CURRENCIES.filter((code) => code === 'EUR' || day.rates[code] !== undefined).filter((code) => currencyKeyMap.has(code));
    for (const toCode of currencies) { if (toCode === 'EUR') continue; const rate = day.rates[toCode]; const toCurrencyKey = currencyKeyMap.get(toCode); if (rate === undefined || toCurrencyKey === undefined) continue; rows.push({ date: new Date(`${day.date}T00:00:00Z`), from_currency_key: eurKey, rate, to_currency_key: toCurrencyKey }); }
    for (const fromCode of currencies) { if (fromCode === 'EUR') continue; const fromRate = day.rates[fromCode]; const fromCurrencyKey = currencyKeyMap.get(fromCode); if (fromRate === undefined || fromCurrencyKey === undefined) continue; rows.push({ date: new Date(`${day.date}T00:00:00Z`), from_currency_key: fromCurrencyKey, rate: 1 / fromRate, to_currency_key: eurKey }); for (const toCode of currencies) { if (fromCode === toCode || toCode === 'EUR') continue; const toRate = day.rates[toCode]; const toCurrencyKey = currencyKeyMap.get(toCode); if (toRate === undefined || toCurrencyKey === undefined) continue; rows.push({ date: new Date(`${day.date}T00:00:00Z`), from_currency_key: fromCurrencyKey, rate: toRate / fromRate, to_currency_key: toCurrencyKey }); } }
  }
  return rows;
}
function differenceInDaysUtc(later: Date, earlier: Date) { return Math.floor((toDateOnly(later).getTime() - toDateOnly(earlier).getTime()) / 86_400_000); }

async function fetchExchangeRates(mode: Mode): Promise<EcbSeries[]> { return parseEcbXml(await fetchXml(mode === 'full-history' ? 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml' : 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml')); }
/**
 * The ECB feed had no timeout: `fetch` with no signal waits forever, and this runs on a
 * `batchSize: 1` queue, so a stalled socket held the exchange-rate slot indefinitely
 * while multi-currency balances quietly went stale. The full-history XML is ~1 MB, so the
 * budget is generous by the standards of a rate feed and still bounded.
 */
const ECB_FETCH_TIMEOUT_MS = 30_000;
async function fetchXml(url: string): Promise<string> { const response = await fetch(url, { signal: AbortSignal.timeout(ECB_FETCH_TIMEOUT_MS) }) as unknown as { ok: boolean; status: number; text: () => Promise<string> }; if (!response.ok) throw new Error(`ECB fetch failed: ${response.status}`); const text: string = await response.text(); return text; }
async function getLastExchangeRateDate() { const row = await sqlQuery(DI.em).selectFrom('exchange_rate').select('date').orderBy('date', 'desc').limit(1).executeTakeFirst(); return row?.date == null ? null : toDate(row.date as Date | string); }
async function insertRows(rows: ExchangeRateRow[]) { let inserted = 0; let skipped = 0; const db = sqlQuery(DI.em); for (let i = 0; i < rows.length; i += BATCH_SIZE) { const batch = rows.slice(i, i + BATCH_SIZE); const result = await db.insertInto('exchange_rate').values(batch.map((row) => ({ ...row }))).onConflict((conflict) => conflict.columns(['from_currency_key', 'to_currency_key', 'date']).doNothing()).returning(['exchange_rate_key']).execute(); inserted += result.length; skipped += batch.length - result.length; } return { inserted, skipped }; }

function parseEcbXml(xml: string): EcbSeries[] { const series: EcbSeries[] = []; for (const match of xml.matchAll(/<Cube\s+time=(['"])([^'"]+)\1>([\s\S]*?)<\/Cube>/g)) { const rates: Record<string, number> = {}; for (const rateMatch of (match[3] ?? '').matchAll(/<Cube\s+currency=(['"])([A-Z]{3})\1\s+rate=(['"])([0-9.]+)\3\s*\/>/g)) { const currency = rateMatch[2]; const rate = rateMatch[4]; if (!currency || !rate) continue; rates[currency] = Number(rate); } const date = match[2]; if (!date) continue; series.push({ date, rates }); } return series; }

function toDateOnly(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())); }

export default {
  buildRows,
  fetchExchangeRates,
  parseEcbXml,
  async refreshExchangeRates() {
    const lastDate = await getLastExchangeRateDate();
    const mode: Mode = !lastDate || differenceInDaysUtc(new Date(), lastDate) > HISTORY_GAP_DAYS ? 'full-history' : 'daily';
    const series = await fetchExchangeRates(mode);
    if (series.length === 0) throw new Error('ECB exchange rate response contained no parsable rows');
    const currencies = await DI.em.find(Currency, { code: { $in: [...SUPPORTED_CURRENCIES] } });
    const currencyKeyMap = new Map(currencies.map((currency) => [currency.code, currency.currencyKey] as const));
    const rows = buildRows(series, currencyKeyMap);
    if (rows.length === 0) throw new Error('ECB exchange rate response contained no parsable rows');
    const { inserted, skipped } = await insertRows(rows);
    return { failed: 0, inserted, mode, skipped, totalRows: rows.length };
  },
  SUPPORTED_CURRENCIES,
};
