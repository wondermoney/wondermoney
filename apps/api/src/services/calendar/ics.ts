/**
 * A minimal RFC 5545 writer for a read-only, all-day calendar feed.
 *
 * Only what a calendar subscription needs: a VCALENDAR envelope, one VEVENT per day, and the
 * RFC 7986 refresh hints. Kept free of domain knowledge so it can be tested on its own — the
 * feed service supplies the text and the dates.
 *
 * The two rules that break real calendar clients are line endings and text escaping: every line
 * ends CRLF, and a comma, semicolon, backslash or newline inside a text value must be escaped.
 * Lines longer than 75 octets are folded, without splitting a UTF-8 sequence.
 */

const CRLF = '\r\n';
/** RFC 5545 §3.1: content lines SHOULD be no longer than 75 octets, excluding the line break. */
const MAX_LINE_OCTETS = 75;
const DEFAULT_PROD_ID = '-//WonderMoney//Bills calendar//EN';
const DEFAULT_REFRESH_INTERVAL_HOURS = 12;

export interface IcsCalendarInput {
  calendarName: string;
  description?: string;
  events: readonly IcsEvent[];
  /** The generation time, written as DTSTAMP. */
  now: Date;
  prodId?: string;
  /** Advertised in REFRESH-INTERVAL and X-PUBLISHED-TTL; clients are free to ignore it. */
  refreshIntervalHours?: number;
}

export interface IcsEvent {
  /** The day the event starts, read in UTC. The event is all-day and ends the next day. */
  date: Date;
  description?: string;
  summary: string;
  /** Stable across requests: the same series on the same day keeps the same UID. */
  uid: string;
}

/** Escape a TEXT value per RFC 5545 §3.3.11. */
export function escapeIcsText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line at 75 octets, continuing with a single leading space.
 *
 * Counts UTF-8 bytes rather than characters, so a name full of accented letters folds at the
 * same width a client reads.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;

  const parts: string[] = [];
  let current = '';
  let currentOctets = 0;
  for (const character of line) {
    const octets = encoder.encode(character).length;
    // A continuation line spends one of its 75 octets on the leading space.
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = character;
      currentOctets = octets;
    } else {
      current += character;
      currentOctets += octets;
    }
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

/** `YYYYMMDD`, the DATE value type of an all-day event. */
export function formatIcsDate(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('');
}

/** `YYYYMMDDTHHMMSSZ`, the UTC DATE-TIME value type. */
export function formatIcsDateTime(date: Date): string {
  return [
    formatIcsDate(date),
    'T',
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
    String(date.getUTCSeconds()).padStart(2, '0'),
    'Z',
  ].join('');
}

export function renderIcsCalendar(input: IcsCalendarInput): string {
  const refreshHours = input.refreshIntervalHours ?? DEFAULT_REFRESH_INTERVAL_HOURS;
  const duration = `PT${refreshHours}H`;
  const stamp = formatIcsDateTime(input.now);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${input.prodId ?? DEFAULT_PROD_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${escapeIcsText(input.calendarName)}`,
    `X-WR-CALNAME:${escapeIcsText(input.calendarName)}`,
    ...(input.description ? [`X-WR-CALDESC:${escapeIcsText(input.description)}`] : []),
    `REFRESH-INTERVAL;VALUE=DURATION:${duration}`,
    `X-PUBLISHED-TTL:${duration}`,
  ];

  for (const event of input.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${formatIcsDate(event.date)}`,
      `DTEND;VALUE=DATE:${formatIcsDate(addUtcDays(event.date, 1))}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
      ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
      // A bill is a reminder, not a busy block: it must not hide the day in a calendar.
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}
