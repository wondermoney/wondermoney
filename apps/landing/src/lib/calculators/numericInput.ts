/**
 * The text of a calculator's number field, kept apart from the number it stands for so a
 * visitor can type through entries that are not numbers yet ("3.", "-", "").
 *
 * A dot or a comma is the decimal separator. Spaces are ignored, so "1 500" reads as 1500.
 * There is no thousands separator: "1,500" is one and a half.
 */

const SPACES = /[\s\u00a0\u202f]/g;

/** An optional sign, digits, and at most one decimal separator, each part possibly still empty. */
const DRAFT = /^[+-]?\d*(?:[.,]\d*)?$/;

function compact(text: string): string {
  return text.replace(SPACES, "");
}

/** Whether the field may show this text: a number, or a number being typed. */
export function isNumericDraft(text: string): boolean {
  return DRAFT.test(compact(text));
}

/**
 * The number a field's text stands for, or NaN while it is empty or partial ("", "-", ".").
 * An entry too large for a finite number reads as NaN as well.
 */
export function parseNumericInput(text: string): number {
  const normalized = compact(text).replace(",", ".");
  if (!DRAFT.test(normalized) || !/\d/.test(normalized)) return Number.NaN;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** The text a field shows for a number: empty for NaN, and with `separator` as the decimal mark. */
export function formatNumericInput(value: number, separator: "." | "," = "."): string {
  if (!Number.isFinite(value)) return "";
  const text = String(value);
  return separator === "," ? text.replace(".", ",") : text;
}

/** The decimal mark the visitor used in `text`, so tidying the field keeps it. */
export function separatorOf(text: string): "." | "," {
  return text.includes(",") ? "," : ".";
}

export type StepBounds = { min?: number; max?: number; step: number };

function decimalsOf(value: number): number {
  const text = String(value);
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
