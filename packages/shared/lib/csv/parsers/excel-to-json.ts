import * as XLSX from 'xlsx';
import type { Readable } from 'stream';

const parseExcel = (file: Buffer | Uint8Array | Blob | string | Readable) =>
  new Promise((resolve, reject) => {
    const parsingOpts: XLSX.ParsingOptions = {
      cellDates: true,
      type: 'buffer',
    };
    const workBook = XLSX.read(file, parsingOpts);
    const firstSheetName = workBook.SheetNames[0];
    if (!firstSheetName) {
      return reject(new Error('No sheet found in the file'));
    }
    const firstSheet = workBook.Sheets[firstSheetName];
    if (!firstSheet) {
      return reject(new Error('No sheet found in the file'));
    }
    if (isTypedFromText(workBook, file)) retypeTextDates(firstSheet);
    const conversionOpts: XLSX.Sheet2JSONOpts = {
      header: 1,
      range: 0,
      defval: null,
    };
    const jsonData = XLSX.utils.sheet_to_json(firstSheet, conversionOpts);
    if (!jsonData || jsonData.length === 0) {
      return reject(new Error('No data found in the file'));
    }
    return resolve(jsonData);
  });

export default parseExcel;

/*
 * Text-cell dates, kept as SheetJS 0.18 read them.
 *
 * In delimited text and HTML tables (the "xls" some banks export), every cell
 * is text and SheetJS guesses which ones are dates. 0.20 rewrote that guess:
 * in HTML it reads "01-09-2026" as year-month-day and lands in 1907, and in
 * both it now leaves "30.09.2026" as text, turns "2026-09-30T10:00:00Z" and
 * "12:30" into dates and "#N/A" into an empty cell. Binary formats (xlsx, xls,
 * ods) store real date serials and read the same in both versions.
 *
 * So for text input, every cell SheetJS left as text, a date or an error is
 * re-read from its source text (`w`) with 0.18's rule, which keeps imports of
 * the same file unchanged. Numbers and booleans are decided the same way by
 * both versions and are left alone.
 */

/**
 * HTML tables, and delimited text: SheetJS names no book type for CSV, nor for
 * BIFF and Lotus files, which these first bytes tell apart.
 */
function isTypedFromText(workBook: XLSX.WorkBook, file: unknown) {
  if (workBook.bookType === 'html') return true;
  if (workBook.bookType !== undefined || !(file instanceof Uint8Array))
    return false;
  const ole =
    file[0] === 0xd0 &&
    file[1] === 0xcf &&
    file[2] === 0x11 &&
    file[3] === 0xe0;
  const biff = file[0] === 0x09 && file[3] === 0x00; // BIFF2-4 BOF record
  const lotus = file[0] === 0x00;
  return !(ole || biff || lotus);
}

function retypeTextDates(sheet: XLSX.WorkSheet) {
  for (const [address, cell] of Object.entries(sheet) as [
    string,
    XLSX.CellObject,
  ][]) {
    if (address.startsWith('!') || typeof cell.w !== 'string') continue;
    if (cell.t !== 's' && cell.t !== 'd' && cell.t !== 'e') continue;
    // A number that stayed text was marked as text by the file (HTML data-t).
    if (cell.t === 's' && isNumericText(cell.w)) continue;
    const date = legacyTextDate(cell.w);
    if (date) {
      cell.t = 'd';
      // sheet_to_json hands dates back in local time (utc_to_local), so store
      // the UTC date with the same wall-clock fields; 0.18 returned `date`.
      cell.v = new Date(
        Date.UTC(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          date.getHours(),
          date.getMinutes(),
          date.getSeconds(),
          date.getMilliseconds(),
        ),
      );
    } else if (cell.t !== 's') {
      cell.t = 's';
      cell.v = cell.w;
      // A date format on a text cell makes sheet_to_json read it as a serial.
      delete cell.z;
    }
  }
}

/** SheetJS's `fuzzynum` test, as 0.20 runs it (without 0.18's slow regex). */
function isNumericText(text: string) {
  const plain = Number(text);
  if (!Number.isNaN(plain)) return Number.isFinite(plain);
  if (!/\d/.test(text)) return false;
  const stripped = text.replace(/(\d),(\d)/g, '$1$2').replace(/[$%]/g, '');
  return (
    !Number.isNaN(Number(stripped)) ||
    !Number.isNaN(Number(stripped.replace(/[(]([^()]*)[)]/, '$1')))
  );
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * SheetJS 0.18.5's `fuzzydate` and `parseDate`: the text as `new Date` reads
 * it, when it looks like a date.
 */
function legacyTextDate(text: string): Date | undefined {
  const date = new Date(text);
  const year = date.getFullYear() - 1900;
  const month = date.getMonth();
  const day = date.getDate();
  if (Number.isNaN(day)) return undefined;
  let lower = text.toLowerCase();
  if (/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/.test(lower)) {
    lower = lower
      .replace(/[^a-z]/g, '')
      .replace(/([^a-z]|^)[ap]m?([^a-z]|$)/, '');
    if (lower.length > 3 && !MONTHS.includes(lower)) return undefined;
  } else if (/[a-z]/.test(lower)) return undefined;
  if (year < 0 || year > 8099) return undefined;
  if ((month > 0 || day > 1) && year !== 101) return date;
  if (/[^-0-9:,/\\]/.test(text)) return undefined;
  return date;
}
