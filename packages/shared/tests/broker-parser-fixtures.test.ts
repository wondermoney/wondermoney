import { describe, expect, it } from 'vitest';
import degiroParser from '../lib/csv/parsers/brokers/degiro';
import ibkrParser from '../lib/csv/parsers/brokers/ibkr';
import trading212Parser from '../lib/csv/parsers/brokers/trading212';
import { FinancialTransactionType } from '../lib/csv/parsers/brokers/types';

describe('broker parser fixtures', () => {
  it('preserves DEGIRO BUY/SELL semantics', () => {
    const [buy] = degiroParser([
      ['01-01-2024','10:00','Apple Inc','IE00B4L5Y983','EAM','XAMS','2','100','USD','-200','USD','-200','','','', '', '', '', 'ext-1'],
      ['01-01-2024','10:00','Apple Inc','IE00B4L5Y983','EAM','XAMS','2','100','USD','200','USD','200','','','', '', '', '', 'ext-2'],
    ]);

    expect(buy.financialTransactionType).toBe(FinancialTransactionType.BUY);
    expect(buy.quantity).toBe(2);
    expect(buy.totalPrice).toBe(200);
    expect(buy.isin).toBe('IE00B4L5Y983');
    expect(buy.brokerTicker).toBeUndefined();
    expect(buy.brokerExchange).toBe('XAMS');
    expect(buy.brokerAssetName).toBe('Apple Inc');
  });

  it('preserves current ikbr parser semantics', () => {
    const [row] = ibkrParser([
      Array.from({ length: 53 }, (_, index) => '') as string[],
    ].map((r) => {
      r[37] = '20240101';
      r[5] = 'AAPL';
      r[6] = 'Apple Inc';
      r[12] = 'NASDAQ';
      r[41] = '3';
      r[42] = '10';
      r[3] = 'USD';
      r[44] = '-30';
      r[25] = 'ext-ibkr';
      r[45] = '1.5';
      r[52] = 'USD';
      return r;
    }) as string[][]);

    expect(row.financialTransactionType).toBe(FinancialTransactionType.BUY);
    expect(row.quantity).toBe(3);
    expect(row.totalPrice).toBe(-30);
    expect(row.externalTransactionId).toBe('ext-ibkr');
    expect(row.isin).toBeUndefined();
  });

  it('preserves Trading212 BUY/SELL and deposit semantics', () => {
    const [buy, deposit] = trading212Parser([
      ['Market buy','2024-01-01 10:00:00','ISIN1','AAPL','Apple Inc','2','100','USD','1','', '200', '', '', '', 'ext-3', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['Deposit','2024-01-01 10:00:00','','','','1','100','USD','1','', '100', '', '', '', 'ext-4', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]);

    expect(buy.financialTransactionType).toBe(FinancialTransactionType.BUY);
    expect(buy.quantity).toBe(2);
    expect(deposit.financialTransactionType).toBe(FinancialTransactionType.DEPOSIT);
    expect(deposit.quantity).toBe(1);
    expect(buy.isin).toBe('ISIN1');
  });
});
