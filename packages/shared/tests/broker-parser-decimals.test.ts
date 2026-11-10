import { describe, expect, it } from 'vitest';

import coinbaseParser from '../lib/csv/parsers/brokers/coinbase';
import degiroParser from '../lib/csv/parsers/brokers/degiro';
import ibkrParser from '../lib/csv/parsers/brokers/ibkr';
import trading212Parser from '../lib/csv/parsers/brokers/trading212';

/*
 * Number.parseFloat stops at the first comma: "100,50" became 100. Each parser reads numbers in
 * the format its broker exports, and rejects a value it cannot read instead of guessing.
 */

// DEGIRO writes numbers in the account's interface language: "100,50" in pt, es, nl, de...
const degiroRow = (values: { quantity: string; price: string; local: string; total: string; rate: string }) => [
  '01-01-2024', '10:00', 'Apple Inc', 'US0378331005', 'NDQ', 'XNAS',
  values.quantity, values.price, 'USD', values.local, 'USD', values.total, 'EUR', values.rate,
  '', '', '', '', 'ext-1',
];

describe('DEGIRO decimals', () => {
  it('reads a comma-decimal export', () => {
    const [buy] = degiroParser([
      degiroRow({ quantity: '2', price: '100,50', local: '-201,00', total: '-183,56', rate: '1,0950' }),
    ]);

    expect(buy?.unitPrice).toBe(100.5);
    expect(buy?.totalLocalPrice).toBe(201);
    expect(buy?.totalPrice).toBe(183.56);
    expect(buy?.exchangeRate).toBe(1.095);
    expect(buy?.quantity).toBe(2);
  });

  it('reads a dot-decimal export', () => {
    const [buy] = degiroParser([
      degiroRow({ quantity: '2', price: '100.50', local: '-201.00', total: '-183.56', rate: '1.0950' }),
    ]);

    expect(buy?.unitPrice).toBe(100.5);
    expect(buy?.totalPrice).toBe(183.56);
    expect(buy?.exchangeRate).toBe(1.095);
  });

  it('settles a three-decimal price from the rest of the file', () => {
    const rows = [
      degiroRow({ quantity: '10', price: '1,234', local: '-12,34', total: '-12,34', rate: '' }),
      degiroRow({ quantity: '1', price: '1.234', local: '-1.234,00', total: '-1.234,00', rate: '' }),
    ];

    const [first, second] = degiroParser(rows);

    expect(first?.unitPrice).toBe(1.234);
    expect(second?.unitPrice).toBe(1234);
  });

  it('takes an explicit separator', () => {
    const [buy] = degiroParser(
      [degiroRow({ quantity: '1', price: '1,234', local: '-1,234', total: '-1,234', rate: '' })],
      { decimalSeparator: ',' }
    );

    expect(buy?.unitPrice).toBe(1.234);
    expect(buy?.totalPrice).toBe(1.234);
  });

  it('rejects a value it cannot read', () => {
    expect(() =>
      degiroParser([degiroRow({ quantity: '2', price: 'abc', local: '-201,00', total: '-201,00', rate: '' })])
    ).toThrow(/abc/);
  });
});

const ibkrRow = (values: Record<number, string>) => {
  const row = Array.from({ length: 53 }, () => '');
  Object.assign(row, { 37: '20240101', 5: 'AAPL', 3: 'USD', 25: 'ext', 52: 'USD' }, values);
  return row;
};

describe('IBKR decimals', () => {
  it('reads dot decimals, including a three-decimal price', () => {
    const [row] = ibkrParser([ibkrRow({ 41: '1000', 42: '1.234', 44: '-1234.5', 45: '-1.25' })]);

    expect(row?.quantity).toBe(1000);
    expect(row?.unitPrice).toBe(1.234);
    expect(row?.totalPrice).toBe(-1234.5);
    expect(row?.feeAmount).toBe(1.25);
  });

  it('rejects a value it cannot read', () => {
    expect(() => ibkrParser([ibkrRow({ 41: '3', 42: '10,5,1', 44: '-30', 45: '0' })])).toThrow(/10,5,1/);
  });
});

const t212Row = (values: Record<number, string>) => {
  const row = Array.from({ length: 48 }, () => '');
  Object.assign(row, { 1: '2024-01-01 10:00:00', 7: 'USD', 8: '1', 14: 'ext' }, values);
  return row;
};

describe('Trading212 decimals', () => {
  it('reads dot decimals, including a three-decimal quantity', () => {
    const [buy] = trading212Parser([
      t212Row({ 0: 'Market buy', 2: 'ISIN1', 3: 'AAPL', 4: 'Apple', 5: '0.125', 6: '1.234', 10: '0.15', 46: '0.02' }),
    ]);

    expect(buy?.quantity).toBe(0.125);
    expect(buy?.unitPrice).toBe(1.234);
    expect(buy?.totalPrice).toBe(0.15);
    expect(buy?.feeAmount).toBe(0.02);
  });

  it('reads a deposit that has no share count', () => {
    const [deposit] = trading212Parser([t212Row({ 0: 'Deposit', 5: '', 6: '', 8: '', 10: '1000.00' })]);

    expect(deposit?.quantity).toBe(1);
    expect(deposit?.totalPrice).toBe(1000);
  });

  it('rejects a value it cannot read', () => {
    expect(() =>
      trading212Parser([t212Row({ 0: 'Market buy', 5: '2', 6: '1.2.3', 10: '200' })])
    ).toThrow(/1\.2\.3/);
  });
});

const coinbaseFile = (line: string) => [...Array.from({ length: 7 }, () => ['header']), [line]];

describe('Coinbase decimals', () => {
  it('reads dot decimals and currency symbols', () => {
    const [buy] = coinbaseParser(
      coinbaseFile('2024-01-01T10:00:00Z,Buy,BTC,0.00125,EUR,€40000.50,€50.00,€50.00,€0.99,,note')
    );

    expect(buy?.quantity).toBe(0.00125);
    expect(buy?.unitPrice).toBe(40000.5);
    expect(buy?.totalPrice).toBe(50);
    expect(buy?.feeAmount).toBe(0.99);
  });

  it('rejects a value it cannot read', () => {
    expect(() =>
      coinbaseParser(coinbaseFile('2024-01-01T10:00:00Z,Buy,BTC,abc,EUR,1,1,1,0,,note'))
    ).toThrow(/abc/);
  });
});
