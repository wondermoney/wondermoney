#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '../..');
const apiRoot = path.join(repoRoot, 'apps/api');
const requireApi = createRequire(path.join(apiRoot, 'package.json'));
const disposableContainerName = 'wm-e2e-pg-55459';

function inspectDisposableContainer() {
  const result = spawnSync('docker', ['inspect', '--format', '{{json .}}', disposableContainerName], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not verify the designated disposable Postgres container.');
  return result.stdout.trim();
}

function assertFixtureTarget({ env = process.env, inspect = inspectDisposableContainer } = {}) {
  if (env['WM_E2E_FIXTURES'] !== '1' || env['NODE_ENV'] === 'production') {
    throw new Error('Fixture operation requires WM_E2E_FIXTURES=1 and NODE_ENV other than production.');
  }
  if (env['DB_HOST'] !== '127.0.0.1' || env['DB_PORT'] !== '55459' || env['DB_DATABASE'] !== 'wm_issue59_e2e') {
    throw new Error('Fixture operation is restricted to 127.0.0.1:55459/wm_issue59_e2e.');
  }
  if (env['DATABASE_URL']) throw new Error('DATABASE_URL is forbidden; use the explicit loopback DB_* settings.');

  const expectedContainerId = env['WM_E2E_DB_CONTAINER_ID'];
  if (!expectedContainerId || !/^[a-f0-9]{64}$/.test(expectedContainerId)) {
    throw new Error('WM_E2E_DB_CONTAINER_ID must contain the full ID of the newly created disposable Postgres container.');
  }

  let container;
  try {
    container = JSON.parse(inspect());
  } catch {
    throw new Error('Could not parse Docker inspection for the designated disposable Postgres container.');
  }

  const labels = container?.Config?.Labels;
  const portBindings = container?.HostConfig?.PortBindings;
  const postgresBindings = portBindings?.['5432/tcp'];
  const hasExactLoopbackBinding =
    portBindings != null &&
    typeof portBindings === 'object' &&
    !Array.isArray(portBindings) &&
    Object.keys(portBindings).length === 1 &&
    Array.isArray(postgresBindings) &&
    postgresBindings.length === 1 &&
    postgresBindings[0]?.HostIp === '127.0.0.1' &&
    postgresBindings[0]?.HostPort === '55459';

  if (
    container?.Id !== expectedContainerId ||
    container?.Name !== `/${disposableContainerName}` ||
    container?.Config?.Image !== 'postgres:17-alpine' ||
    labels?.['opencode.owner'] !== 'issue59' ||
    labels?.['opencode.disposable'] !== 'true' ||
    !hasExactLoopbackBinding
  ) {
    throw new Error('Docker target does not match the provisioned issue-59 disposable database.');
  }
}

async function loadFixtureIdentities() {
  const shared = requireApi('@wondermoney/shared');
  const parseCsv = requireApi('csv-parse/sync').parse;
  const degiroB64 = fs.readFileSync(path.join(webRoot, 'cypress/fixtures/portfolio-import/degiro-transactions.xlsx.base64'), 'utf8').trim();
  const ibkrB64 = fs.readFileSync(path.join(webRoot, 'cypress/fixtures/portfolio-import/ibkr-flex-query.csv.base64'), 'utf8').trim();

  const degiroRows = await shared.csv.parseExcel(Buffer.from(degiroB64, 'base64'));
  const headers = degiroRows[0];
  const dIndex = Object.fromEntries(['ISIN', 'Product', 'Venue'].map((header) => [header, headers.indexOf(header)]));
  if (Object.values(dIndex).some((index) => index < 0)) throw new Error('Bundled DEGIRO fixture is missing identity columns.');
  const identities = new Map();
  for (const row of degiroRows.slice(1)) {
    const isin = String(row[dIndex['ISIN']] ?? '').trim();
    if (!isin) continue;
    identities.set(isin, { isin, name: String(row[dIndex['Product']]).trim(), currency: 'EUR', exchange: String(row[dIndex['Venue']]).trim(), symbol: isin, type: 'ETF' });
  }

  const csvRows = parseCsv(Buffer.from(ibkrB64, 'base64').toString('utf8'), { columns: true, skip_empty_lines: true, bom: true });
  for (const row of csvRows) {
    const isin = String(row['ISIN'] ?? '').trim();
    if (row['AssetClass'] !== 'STK' || !isin) continue;
    identities.set(isin, { isin, name: String(row['Description']).trim(), currency: String(row['CurrencyPrimary']).trim(), exchange: String(row['ListingExchange']).trim(), symbol: String(row['Symbol']).trim(), type: row['SubCategory'] === 'ETF' ? 'ETF' : 'Stock' });
  }
  return [...identities.values()];
}

function currencyOrThrow(currencies, code) {
  const currency = currencies.get(code);
  if (!currency) throw new Error(`Seeded currency lookup missing fixture currency ${code}.`);
  return currency;
}

async function seedCatalog() {
  assertFixtureTarget();
  const { Pool } = requireApi('pg');
  const identities = await loadFixtureIdentities();
  const pool = new Pool({ host: '127.0.0.1', port: 55459, database: 'wm_issue59_e2e', user: process.env['DB_USERNAME'], password: process.env['DB_PASSWORD'] });
  try {
    const client = await pool.connect();
    try {
      const target = await client.query('SELECT current_database() AS database, current_user AS username');
      if (target.rows[0]?.database !== 'wm_issue59_e2e' || target.rows[0]?.username !== process.env['DB_USERNAME']) {
        throw new Error('Connected Postgres database/user do not match the explicitly configured fixture target.');
      }
      await client.query('BEGIN');
      const currencyRows = await client.query("SELECT currency_key, code FROM currency WHERE code IN ('EUR', 'USD')");
      const currencies = new Map(currencyRows.rows.map((row) => [row.code, row.currency_key]));
      const typeRows = await client.query("SELECT financial_asset_type_key, name FROM financial_asset_type WHERE name IN ('Stock', 'ETF')");
      const types = new Map(typeRows.rows.map((row) => [row.name, row.financial_asset_type_key]));
      if (!types.has('Stock') || !types.has('ETF')) throw new Error('Standard seed data is missing Stock/ETF asset types.');

      for (const identity of identities) {
        const currencyKey = currencyOrThrow(currencies, identity.currency);
        const exchangeRows = await client.query(
          `SELECT e.financial_asset_exchange_key
           FROM financial_asset_exchange e
           LEFT JOIN financial_asset_exchange_aliases p ON p.financial_asset_exchange_key = e.financial_asset_exchange_key
           LEFT JOIN financial_asset_exchange_alias a ON a.financial_asset_exchange_alias_key = p.financial_asset_exchange_alias_key
           WHERE e.acronym = $1 OR e.name = $1 OR a.name = $1
           ORDER BY (e.acronym = $1) DESC, (a.name = $1) DESC LIMIT 1`,
          [identity.exchange],
        );
        const exchangeKey = exchangeRows.rows[0]?.financial_asset_exchange_key ?? null;
        await client.query(
          `INSERT INTO financial_asset (name, symbol, isin, currency_key, financial_asset_exchange_key, financial_asset_type_key, is_actively_trading, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, true, now(), now())
           ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name, isin = EXCLUDED.isin, currency_key = EXCLUDED.currency_key,
             financial_asset_exchange_key = EXCLUDED.financial_asset_exchange_key, financial_asset_type_key = EXCLUDED.financial_asset_type_key,
             deleted_at = NULL, updated_at = now()`,
          [identity.name, identity.symbol, identity.isin, currencyKey, exchangeKey, types.get(identity.type) ?? types.get('Stock')],
        );
      }
      await client.query('COMMIT');
      console.log(`Seeded ${identities.length} security identities derived from the bundled broker exports.`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[2] === 'seed') {
  seedCatalog().catch((error) => { console.error(error); process.exitCode = 1; });
}

export { assertFixtureTarget, loadFixtureIdentities };
