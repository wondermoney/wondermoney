import { describe, expect, it } from 'vitest';

import { escapeIcsText, foldIcsLine, formatIcsDate, formatIcsDateTime, renderIcsCalendar } from '../ics';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('escapeIcsText', () => {
  it('escapes backslashes, semicolons, commas and newlines per RFC 5545', () => {
    expect(escapeIcsText('Rent, water; gas\\line\nnext\r\nline')).toBe('Rent\\, water\\; gas\\\\line\\nnext\\nline');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeIcsText('Electricity — 45,00 €')).toBe('Electricity — 45\\,00 €');
  });
});

describe('foldIcsLine', () => {
  it('leaves a line of at most 75 octets unfolded', () => {
    const line = 'A'.repeat(75);
    expect(foldIcsLine(line)).toBe(line);
  });

  it('folds longer lines with a leading space and keeps every line within 75 octets', () => {
    const folded = foldIcsLine('B'.repeat(200));
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(lines.slice(1).every((line) => line.startsWith(' '))).toBe(true);
    expect(folded.replaceAll('\r\n ', '')).toBe('B'.repeat(200));
  });

  it('never splits a multi-byte character', () => {
    const folded = foldIcsLine('€'.repeat(60));
    for (const line of folded.split('\r\n')) {
      expect(line).not.toContain('\uFFFD');
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replaceAll('\r\n ', '')).toBe('€'.repeat(60));
  });
});

describe('date formatting', () => {
  it('writes an all-day value date in UTC', () => {
    expect(formatIcsDate(day('2026-03-05'))).toBe('20260305');
  });

  it('writes a UTC timestamp for DTSTAMP', () => {
    expect(formatIcsDateTime(new Date('2026-03-05T14:07:09.000Z'))).toBe('20260305T140709Z');
  });
});

describe('renderIcsCalendar', () => {
  const input = {
    calendarName: 'WonderMoney bills',
    description: 'Upcoming bills',
    events: [
      {
        date: day('2026-03-05'),
        description: 'Recurring payment: €45.00',
        summary: 'Electricity - €45.00',
        uid: 'wm-bill-1-20260305@wonder.money',
      },
    ],
    now: new Date('2026-03-01T09:00:00.000Z'),
  };

  it('wraps the events in a valid VCALENDAR envelope', () => {
    const ics = renderIcsCalendar(input);

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//WonderMoney//Bills calendar//EN');
    expect(ics).toContain('CALSCALE:GREGORIAN');
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT12H');
    expect(ics).toContain('X-PUBLISHED-TTL:PT12H');
  });

  it('writes one all-day VEVENT with a stable UID and a generation stamp', () => {
    const ics = renderIcsCalendar(input);

    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:wm-bill-1-20260305@wonder.money');
    expect(ics).toContain('DTSTAMP:20260301T090000Z');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260305');
    expect(ics).toContain('DTEND;VALUE=DATE:20260306');
    expect(ics).toContain('SUMMARY:Electricity - €45.00');
    expect(ics).toContain('DESCRIPTION:Recurring payment: €45.00');
    expect(ics).toContain('TRANSP:TRANSPARENT');
  });

  it('uses CRLF line endings throughout', () => {
    const ics = renderIcsCalendar(input);

    expect(ics).not.toMatch(/[^\r]\n/);
    for (const line of ics.split('\r\n').filter(Boolean)) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('keeps the UID stable when the feed is generated again later', () => {
    const first = renderIcsCalendar(input);
    const second = renderIcsCalendar({ ...input, now: new Date('2026-03-02T10:00:00.000Z') });

    expect(first).toContain('UID:wm-bill-1-20260305@wonder.money');
    expect(second).toContain('UID:wm-bill-1-20260305@wonder.money');
    expect(second).not.toContain('DTSTAMP:20260301T090000Z');
  });
});
