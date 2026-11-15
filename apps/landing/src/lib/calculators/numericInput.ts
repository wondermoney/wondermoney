/**
 * The text of a calculator's number field, kept apart from the number it stands for so a
 * visitor can type through entries that are not numbers yet ("3.", "-", "").
 *
 * Both a dot and a comma can be the decimal mark, and either can group thousands, so the
 * same text reads the way an English or a Portuguese visitor means it:
 * - With both marks, the last one is the decimal mark and the earlier ones group digits in
 *   threes: "1,000.50" and "1.000,50" are both 1000.5.
 * - The same mark more than once groups thousands: "1.000.000" is a million.
 * - One mark followed by exactly three digits groups thousands only in a whole-number field
 *   (`grouping`): "1,500" is 1500 as an amount but 1.5 as a rate, where "3,125" is 3.125%.
 *   A leading zero ("0,500") always makes it a decimal.
 * Spaces are ignored, so "1 500" reads as 1500.
 */

export type ParseOptions = {
  /** True in a whole-number field, where "1,500" is more likely 1500 than 1.5. */
  grouping?: boolean;
};

const SPACES = /[\s\u00a0\u202f]/g;

/** An optional sign, then digits and marks, never two marks in a row. */
const DRAFT = /^[+-]?(?:\d|[.,](?![.,]))*$/;

function compact(text: string): string {
  return text.replace(SPACES, "");
}

/** Whether the field may show this text: a number, or a number being typed. */
export function isNumericDraft(text: string): boolean {
  return DRAFT.test(compact(text));
}

/**
 * What a paste or a keystroke leaves once anything that cannot be part of a number is
 * dropped: "€1500" becomes "1500" and "1 500,00 €" becomes "1 500,00".
 */
export function sanitizeNumericInput(text: string): string {
  return text.replace(/[^\d.,+\-\s\u00a0\u202f]/g, "");
}

/** Digits with marks only between groups of exactly three, as in "1,000,000". */
function isGrouped(digits: string, mark: "." | ","): boolean {
  const escaped = mark === "." ? "\\." : ",";
  return new RegExp(`^\\d{1,3}(?:${escaped}\\d{3})+$`).test(digits);
}

/** The text as plain "1234.5" for Number(), or null when it is not a whole number yet. */
function canonical(unsigned: string, grouping: boolean): string | null {
  const dots = unsigned.split(".").length - 1;
  const commas = unsigned.split(",").length - 1;

  if (dots === 0 && commas === 0) return unsigned;

  if (dots > 0 && commas > 0) {
    const decimalAt = Math.max(unsigned.lastIndexOf("."), unsigned.lastIndexOf(","));
    const decimalMark = unsigned[decimalAt] as "." | ",";
    const groupMark = decimalMark === "." ? "," : ".";
    const whole = unsigned.slice(0, decimalAt);
    if (whole.includes(decimalMark) || !isGrouped(whole, groupMark)) return null;
    return `${whole.split(groupMark).join("")}.${unsigned.slice(decimalAt + 1)}`;
  }

  const mark = dots > 0 ? "." : ",";
  if (dots + commas > 1) {
    return isGrouped(unsigned, mark) ? unsigned.split(mark).join("") : null;
  }

  const [whole, fraction] = unsigned.split(mark);
  if (grouping && fraction.length === 3 && /^[1-9]\d{0,2}$/.test(whole)) return whole + fraction;
  return `${whole}.${fraction}`;
}

/**
 * The number a field's text stands for, or NaN while it is empty, partial ("", "-", ".") or
 * not a number ("1,00,0"). An entry too large for a finite number reads as NaN as well.
 */
export function parseNumericInput(text: string, { grouping = false }: ParseOptions = {}): number {
  const compacted = compact(text);
  if (!DRAFT.test(compacted) || !/\d/.test(compacted)) return Number.NaN;
  const sign = compacted[0] === "-" || compacted[0] === "+" ? compacted[0] : "";
  const plain = canonical(compacted.slice(sign.length), grouping);
  if (plain === null) return Number.NaN;
  const value = Number(sign + plain);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** A number as plain digits, never in exponent form (1e21, 1e-7). */
function plainDigits(value: number): string {
  if (Object.is(value, -0)) return "0";
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}

/** The text a field shows for a number: empty for NaN, and with `separator` as the decimal mark. */
export function formatNumericInput(value: number, separator: "." | "," = "."): string {
  if (!Number.isFinite(value)) return "";
  const text = plainDigits(value);
  return separator === "," ? text.replace(".", ",") : text;
}

/** The decimal mark the visitor used in `text` (the last mark typed), so tidying keeps it. */
export function separatorOf(text: string): "." | "," {
  return text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
}

export type StepBounds = { min?: number; max?: number; step: number };

function decimalsOf(value: number): number {
  const text = plainDigits(value);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * The value one step up or down from `value`, as the arrow keys give it, kept within min and
 * max. From an empty field (NaN) the first step lands on min, or 0 without one.
 */
export function stepNumericValue(
  value: number,
  direction: 1 | -1,
  { min, max, step }: StepBounds,
): number {
  const start = Number.isFinite(value) ? value + direction * step : (min ?? 0);
  // Round to the step's precision so 0.1 steps never show 0.30000000000000004.
  const decimals = Math.max(decimalsOf(step), Number.isFinite(value) ? decimalsOf(value) : 0);
  const rounded = Number(start.toFixed(Math.min(decimals, 20)));
  const atLeastMin = min === undefined ? rounded : Math.max(min, rounded);
  return max === undefined ? atLeastMin : Math.min(max, atLeastMin);
}
