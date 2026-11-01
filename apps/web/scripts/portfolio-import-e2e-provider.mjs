import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFixtureTarget, loadFixtureIdentities } from './portfolio-import-e2e-fixtures.mjs';

assertFixtureTarget();
process.env['EODHD_API_KEY'] ||= 'WM_E2E_FIXTURE_ONLY_NOT_A_REAL_PROVIDER_KEY';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../api');
const requireApi = createRequire(path.join(apiRoot, 'package.json'));
const { Eodhd } = requireApi('@wondermoney/shared');
const identities = await loadFixtureIdentities();
const byQuery = new Map();
for (const asset of identities) {
  const result = {
    Code: asset.symbol,
    Currency: asset.currency,
    Exchange: asset.exchange,
    ISIN: asset.isin,
    Name: asset.name,
    Type: asset.type === 'ETF' ? 'ETF' : 'Common Stock',
  };
  for (const key of [asset.isin, asset.symbol, asset.name]) {
    if (key) byQuery.set(key.trim().toUpperCase(), result);
  }
}

Eodhd.prototype.search = async function fixtureSearch(query) {
  const key = String(query).trim().toUpperCase();
  if (key === 'EUR.USD') return [];
  const result = byQuery.get(key);
  if (!result) throw new Error(`E2E provider fixture has no result for query: ${query}`);
  return [result];
};

for (const method of ['getEndOfDayPrices', 'getQuote', 'getDividends', 'getSplits', 'getScreener']) {
  Eodhd.prototype[method] = async function providerMethodUnavailable() {
    throw new Error(`E2E provider fixture does not implement Eodhd.${method}; remote provider access is blocked.`);
  };
}

console.log(`Installed isolated EODHD search fixture for ${identities.length} bundled security identities; non-search provider calls are blocked.`);
