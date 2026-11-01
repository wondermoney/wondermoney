import { describe, expect, it } from 'vitest';

import { applyPortfolioCsvLayout, normalizeCsvHeader, parseRawCsvRowsForLayout } from '../portfolio-csv-layout.utils';

describe('portfolio csv layout utils', () => {
  it('normalizes headers', () => {
    expect(normalizeCsvHeader(' Transaction-Date__ ')).toBe('transaction date');
  });

  it('parses raw csv rows for layout detection', () => {
    expect(parseRawCsvRowsForLayout('\ufeffa,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps ragged and blank rows so a broker preamble and footer can be located', () => {
    const csv = '\ufeffStatement,Broker\n\nDate,Ticker,Qty\n2026-01-02,"VWCE, Acc",3\nTotal\n';

    expect(parseRawCsvRowsForLayout(csv)).toEqual([
      ['Statement', 'Broker'],
      [''],
      ['Date', 'Ticker', 'Qty'],
      ['2026-01-02', 'VWCE, Acc', '3'],
      ['Total'],
    ]);
  });

  it('applies layout with non-first header row and footer count', () => {
    expect(applyPortfolioCsvLayout([['skip'], ['Asset', 'Date'], ['ACME', '2024-01-01'], ['footer']], { dataStartRowIndex: 2, footerRowCount: 1, headerRowIndex: 1 })).toEqual([{ Asset: 'ACME', Date: '2024-01-01' }]);
  });

  it('filters footer matcher rows before row normalization while preserving footer count cutoffs', () => {
    expect(applyPortfolioCsvLayout([['skip'], ['Asset', 'Date'], ['Total', '2'], ['ACME', '2024-01-01'], ['Disclaimer about totals'], ['footer']], { dataStartRowIndex: 2, footerMatchers: ['total', 'disclaimer'], footerRowCount: 1, headerRowIndex: 1 })).toEqual([{ Asset: 'ACME', Date: '2024-01-01' }]);
  });

  it('throws for missing header row', () => {
    expect(() => applyPortfolioCsvLayout([], { dataStartRowIndex: 1, headerRowIndex: 0 })).toThrow('header row');
  });

  it('throws when data starts before or at header', () => {
    expect(() => applyPortfolioCsvLayout([['Date'], ['2024-01-01']], { dataStartRowIndex: 0, headerRowIndex: 0 })).toThrow('must be after headerRowIndex');
    expect(() => applyPortfolioCsvLayout([['Date'], ['2024-01-01']], { dataStartRowIndex: -1, headerRowIndex: 0 })).toThrow('must be after headerRowIndex');
  });

  it('fills missing cells with empty strings and filters blank rows', () => {
    expect(applyPortfolioCsvLayout([['Asset', 'Date', 'Qty'], ['ACME', '2024-01-01'], ['', '', ''], ['BETA', '2024-01-02', '5']], { dataStartRowIndex: 1, headerRowIndex: 0 })).toEqual([{ Asset: 'ACME', Date: '2024-01-01', Qty: '' }, { Asset: 'BETA', Date: '2024-01-02', Qty: '5' }]);
  });
});
