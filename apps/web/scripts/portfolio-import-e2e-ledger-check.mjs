#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(webRoot, 'cypress/fixtures/portfolio-import');
const read = (name) => fs.readFileSync(path.join(fixtureRoot, name), 'utf8');
const rows = (csv) => {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const columns = header.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((value, index) => [columns[index], value])));
};

const decimalUnits = (value, scale) => {
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  assert.ok(match, `invalid decimal value: ${text}`);
  const fraction = match[3] ?? '';
  assert.ok(fraction.length <= scale, `decimal exceeds scale ${scale}: ${text}`);
  const units = BigInt(match[2]) * 10n ** BigInt(scale) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
  return match[1] === '-' ? -units : units;
};

const fixedDecimal = (units, scale) => {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const base = 10n ** BigInt(scale);
  return `${negative ? '-' : ''}${absolute / base}.${(absolute % base).toString().padStart(scale, '0')}`;
};

export function originalIbkrStoredFeeLedger(sourceRows) {
  const stocks = sourceRows.filter((row) => row.AssetClass === 'STK');
  const rejected = stocks.filter((row) => row.TransactionID === 'TEST-TRANSACTIONID-007');
  assert.equal(rejected.length, 1, 'the fixture must contain exactly the known rejected AMD sale');
  assert.deepEqual(
    [rejected[0].Symbol, rejected[0].TradeDate, rejected[0].Quantity],
    ['AMD', '20240124', '-6'],
  );
  const accepted = stocks.filter((row) => row !== rejected[0]);
  assert.equal(accepted.length, 30, 'only the identified oversell is excluded from stock fees');

  const rawScale = 12;
  const storedScale = 4;
  let rawFeeUnits = 0n;
  let storedFeeUnits = 0n;
  for (const row of accepted) {
    const raw = decimalUnits(row.IBCommission, rawScale);
    rawFeeUnits += raw < 0n ? -raw : raw;
    const absolute = raw < 0n ? -raw : raw;
    const divisor = 10n ** BigInt(rawScale - storedScale);
    // PostgreSQL numeric(18,4) rounds each assigned row to scale 4, half away from zero.
    storedFeeUnits += (absolute + divisor / 2n) / divisor;
  }
  const globalDivisor = 10n ** BigInt(rawScale - storedScale);
  const globallyRoundedUnits = (rawFeeUnits + globalDivisor / 2n) / globalDivisor;
  return {
    acceptedRows: accepted.length,
    perRowStoredTotal: fixedDecimal(storedFeeUnits, storedScale),
    rawNominalMixedCurrencyTotal: fixedDecimal(rawFeeUnits, rawScale),
    globallyRoundedTotal: fixedDecimal(globallyRoundedUnits, storedScale),
  };
}

export function checkOriginalIbkrStoredFeeLedger() {
  const fixture = read('ibkr-flex-query.csv.base64').replace(/\s+/g, '');
  const sourceRows = rows(Buffer.from(fixture, 'base64').toString('utf8'));
  const ledger = originalIbkrStoredFeeLedger(sourceRows);
  assert.deepEqual(ledger, {
    acceptedRows: 30,
    perRowStoredTotal: '22.5457',
    rawNominalMixedCurrencyTotal: '22.545189575000',
    globallyRoundedTotal: '22.5452',
  });
  return ledger;
}

function runLedgerChecks() {

const originalBase64 = read('ibkr-flex-query.csv.base64').replace(/\s+/g, '');
assert.equal(
  createHash('sha256').update(read('ibkr-flex-query.csv.base64')).digest('hex'),
  'bd3e4d2d9fbcd7836b9b45b8cf3820ec825edcad5949efe263fb8de0b079c837',
  'original IBKR regression fixture must remain byte-for-byte unchanged',
);
const original = rows(Buffer.from(originalBase64, 'base64').toString('utf8'));
assert.ok(original.every((row) => row.CurrencyPrimary.trim()), 'every original IBKR row, including FX rows, must have a valid CurrencyPrimary');
const stockRows = original.filter((row) => row.AssetClass === 'STK');
const fxRows = original.filter((row) => row.AssetClass === 'CASH');
assert.equal(stockRows.length, 31);
assert.equal(fxRows.length, 46);
const amdRows = stockRows.filter((row) => row.Symbol === 'AMD').sort((a, b) => a.TradeDate.localeCompare(b.TradeDate));
assert.deepEqual(amdRows.map((row) => [row.TradeDate, Number(row.Quantity)]), [
  ['20240102', 4],
  ['20240124', -6],
  ['20241030', 4],
  ['20241218', 4],
]);
let amdShares = 0;
let accepted = 0;
const rejected = [];
for (const row of amdRows) {
  const quantity = Number(row.Quantity);
  if (amdShares + quantity < 0) rejected.push(row);
  else {
    amdShares += quantity;
    accepted += 1;
  }
}
assert.equal(rejected.length, 1);
assert.equal(rejected[0].TradeDate, '20240124');
assert.equal(rejected[0].Quantity, '-6');
assert.equal(amdShares, 12);
assert.equal(accepted, 3);

const synthetic = rows(read('ibkr-complete-synthetic.csv'));
assert.equal(synthetic.length, 6);
assert.ok(synthetic.every((row) => row.CurrencyPrimary.trim()), 'every synthetic row, including unsupported FX rows, must have a valid CurrencyPrimary');
assert.equal(synthetic.filter((row) => row.AssetClass === 'STK').length, 5);
assert.equal(synthetic.filter((row) => row.Symbol === 'EUR.USD').length, 1);
assert.equal(synthetic.find((row) => row.Symbol === 'EUR.USD').CurrencyPrimary, 'USD');
const spy = synthetic.filter((row) => row.Symbol === 'SPYL');
let spyQuantity = 0;
const lots = [];
let realizedGainEur = 0;
for (const row of spy) {
  const quantity = Number(row.Quantity);
  const price = Number(row.TradePrice);
  const fee = Number(row.IBCommission);
  if (quantity > 0) {
    spyQuantity += quantity;
    lots.push({ fee, price, quantity });
    continue;
  }
  let sellQuantity = -quantity;
  let allocatedBuyFees = 0;
  let grossGain = 0;
  while (sellQuantity > 0) {
    const lot = lots[0];
    assert.ok(lot, 'synthetic ledger must buy before it sells');
    const matched = Math.min(sellQuantity, lot.quantity);
    grossGain += matched * (price - lot.price);
    allocatedBuyFees += matched * lot.fee / lot.quantity;
    lot.quantity -= matched;
    spyQuantity -= matched;
    sellQuantity -= matched;
    if (lot.quantity === 0) lots.shift();
  }
  realizedGainEur += grossGain - allocatedBuyFees - fee;
}
assert.equal(spyQuantity, 0.75);
assert.ok(Math.abs(realizedGainEur - 139.66) < 1e-9);
assert.equal(synthetic.filter((row) => row.Symbol === 'AMD').reduce((sum, row) => sum + Number(row.Quantity), 0), 0.5);
assert.equal(synthetic.filter((row) => row.CurrencyPrimary === 'EUR').reduce((sum, row) => sum + Number(row.IBCommission || 0), 0), 0.4);
assert.equal(synthetic.filter((row) => row.CurrencyPrimary === 'USD').reduce((sum, row) => sum + Number(row.IBCommission || 0), 0), 0.1);
assert.equal(synthetic.filter((row) => row.AssetClass === 'STK').some((row) => !Number.isInteger(Number(row.Quantity))), true);
console.log('Portfolio import fixtures: original partial ledger and synthetic complete ledger verified.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkOriginalIbkrStoredFeeLedger();
  runLedgerChecks();
}
