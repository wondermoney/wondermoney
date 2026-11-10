import {
  type DecimalSeparator,
  detectDecimalSeparator,
  parseDecimal,
} from '../../decimal';

export interface ParserNumberFormat {
  /** The export's decimal separator. Without it, only unambiguous values are read. */
  decimalSeparator?: DecimalSeparator;
}

const describe = (value: unknown) => (typeof value === 'string' ? `"${value}"` : String(value));

/** A required number cell as a decimal string; throws rather than guess (amounts are money). */
export function requireDecimalString(
  value: string | number | undefined | null,
  format: ParserNumberFormat,
  where: string
): string {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return String(value);
  } else {
    const parsed = parseDecimal(value, { decimalSeparator: format.decimalSeparator });
    if (parsed !== null) return parsed;
  }
  throw new Error(`Invalid number ${describe(value)} in ${where}`);
}

/** A required number cell; throws rather than guess. */
export function requireNumber(
  value: string | number | undefined | null,
  format: ParserNumberFormat,
  where: string
): number {
  return Number(requireDecimalString(value, format, where));
}

/** An optional number cell: blank is `undefined`, anything else must be a number. */
export function optionalNumber(
  value: string | number | undefined | null,
  format: ParserNumberFormat,
  where: string
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return requireNumber(value, format, where);
}

/** The separator a file uses, judged from its number columns; undefined when they never say. */
export function detectFileDecimalSeparator(
  rows: string[][],
  columns: number[]
): DecimalSeparator | undefined {
  const values = rows.flatMap((row) => columns.map((column) => row[column] ?? ''));
  return detectDecimalSeparator(values) ?? undefined;
}
