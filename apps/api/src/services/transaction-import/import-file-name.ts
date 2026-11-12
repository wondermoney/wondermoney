/** The longest name an import keeps, in characters (the column is `varchar(255)`). */
export const IMPORT_FILE_NAME_MAX_LENGTH = 255;
/** An extension longer than this is part of the name, not an extension worth keeping. */
const MAX_EXTENSION_LENGTH = 16;
const ELLIPSIS = '…';

/** Characters as Postgres counts them for `varchar(n)`. */
const codePoints = (value: string) => Array.from(value).length;

/**
 * The name of an imported file as its session keeps it for the person's history: the last path
 * segment of what the client sent, in one Unicode spelling (NFC), without control characters or
 * bidirectional controls (a right-to-left override, U+202E, can make `invoice<U+202E>vsc.exe` read
 * as `invoiceexe.csv`), with runs of whitespace as one space. A name over
 * {@link IMPORT_FILE_NAME_MAX_LENGTH} characters is cut short with an ellipsis before its
 * extension, never inside a character (nor between an emoji and its modifiers). Undefined when
 * nothing readable is left.
 *
 * The name is only ever shown back to its owner; it never builds a storage key or a path.
 */
export function importFileName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const base = raw.split(/[\\/]/u).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(/[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, (character) => (/\s/u.test(character) ? ' ' : ''))
    .replace(/\s+/gu, ' ')
    .trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return undefined;
  if (codePoints(cleaned) <= IMPORT_FILE_NAME_MAX_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && codePoints(cleaned.slice(dot)) <= MAX_EXTENSION_LENGTH ? cleaned.slice(dot) : '';
  // Whole characters as a reader sees them (an emoji with its modifiers, a letter with its accent).
  const room = IMPORT_FILE_NAME_MAX_LENGTH - codePoints(extension) - 1;
  let stem = '';
  let length = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(cleaned)) {
    length += codePoints(segment);
    if (length > room) break;
    stem += segment;
  }
  return `${stem}${ELLIPSIS}${extension}`;
}
