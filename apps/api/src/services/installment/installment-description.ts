/**
 * Reading "this row is installment 3 of 12" from a bank description.
 *
 * Banks mark installment purchases in the description: `LOJA PARC 03/12`, `Parcela 3/12`,
 * `Prestação 2 de 6`, `cuota 5/18`, or just a bare `3/12`. This parser is the one place that
 * reads those markers, so a new bank format is a new row in its table test.
 *
 * - A marker after a keyword (parc, parcela, prestação, prest, cuota, installment) is **explicit**:
 *   `n/N` or `n de N`, up to 120 installments.
 * - A bare `n/N` is weaker (it can be a calendar date), so it is limited to 48 installments and
 *   reported with `explicit: false`; the suggestion builder asks for more evidence before using it.
 * - Calendar dates are not markers: a token joined to another `/` or digit (`03/12/2026`,
 *   `2026/03`) is ignored, and so is any `n/N` with `n` past `N` (`15/03`).
 *
 * The result never decides anything on its own: it feeds suggestions the user accepts and the
 * matching of a posted row to a plan the user created.
 */

export interface InstallmentMarker {
  /** True when a keyword introduced the marker; false for a bare `n/N`. */
  explicit: boolean;
  installmentCount: number;
  installmentNumber: number;
  /** The description without the marker, trimmed: what names the purchase. */
  stem: string;
}

const MAX_EXPLICIT_COUNT = 120;
const MAX_BARE_COUNT = 48;

const KEYWORD = String.raw`(?:parcela|parc|presta[cç][aã]o|prest|cuota|installment)`;
const EXPLICIT = new RegExp(String.raw`(?<![\p{L}\d])${KEYWORD}\.?\s*(\d{1,3})(?:\s*\/\s*|\s+(?:de|of)\s+)(\d{1,3})(?![\d/])`, 'giu');
const BARE = /(?<![\d/.,])\(?(\d{1,3})\/(\d{1,3})\)?(?![\d/])/gu;

function stemWithout(description: string, index: number, length: number): string {
  return `${description.slice(0, index)} ${description.slice(index + length)}`
    .replace(/\s+/gu, ' ')
    .replace(/^[\s\-–—*,:;/|]+|[\s\-–—*,:;/|]+$/gu, '')
    .trim();
}

function validMarker(number: number, count: number, maxCount: number): boolean {
  return Number.isInteger(number) && Number.isInteger(count) && count >= 2 && count <= maxCount && number >= 1 && number <= count;
}

/** The installment marker in `description`, or null when it has none. */
export function parseInstallmentMarker(description: null | string | undefined): InstallmentMarker | null {
  if (!description) return null;

  for (const match of description.matchAll(EXPLICIT)) {
    const number = Number(match[1]);
    const count = Number(match[2]);
    if (!validMarker(number, count, MAX_EXPLICIT_COUNT)) continue;
    return { explicit: true, installmentCount: count, installmentNumber: number, stem: stemWithout(description, match.index, match[0].length) };
  }

  // The last bare marker wins: a merchant name or city rarely ends a description with one.
  let bare: InstallmentMarker | null = null;
  for (const match of description.matchAll(BARE)) {
    const number = Number(match[1]);
    const count = Number(match[2]);
    if (!validMarker(number, count, MAX_BARE_COUNT)) continue;
    bare = { explicit: false, installmentCount: count, installmentNumber: number, stem: stemWithout(description, match.index, match[0].length) };
  }
  return bare;
}

/** A stem in the form two descriptions of one purchase share: case, accents and spacing folded. */
export function normalizeInstallmentStem(stem: string): string {
  return stem
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\d]+/gu, ' ')
    .trim();
}
