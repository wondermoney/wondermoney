import { z } from 'zod';

const numericString = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const positiveIntString = /^[1-9]\d*$/;
const epochMsString = /^-?\d+$/;
const canonicalUuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const canonicalUuidV4 = z.string().regex(canonicalUuidV4Pattern);

export function isCanonicalUuidV4(value: unknown): value is string {
  return typeof value === 'string' && canonicalUuidV4Pattern.test(value);
}

function isSafeFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && !Number.isNaN(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

export const positiveIntId = z.union([z.number(), z.string().regex(positiveIntString)])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => Number.isInteger(value) && value > 0 && isSafeFiniteNumber(value), { message: 'Must be a positive integer' });

export const finiteAmount = z.union([z.number(), z.string().regex(numericString)])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => isSafeFiniteNumber(value), { message: 'Must be a finite number' });

export const validDate = z.union([z.date(), z.number(), z.string()])
  .transform((value) => {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    const trimmed = value.trim();
    if (epochMsString.test(trimmed)) return new Date(Number(trimmed));
    return new Date(trimmed);
  })
  .refine((value) => Number.isFinite(value.getTime()) && Math.abs(value.getTime()) <= 8.64e15, { message: 'Invalid date' });

/**
 * A bounded, defaulted `limit` query parameter.
 *
 * `defaultValue` is always applied: an omitted `limit` must never reach a service as
 * `undefined`, where `...(limit ? { limit } : {})` would emit no LIMIT clause at all. A
 * non-positive default is rejected at schema construction time rather than silently
 * becoming "unbounded".
 */
export function boundedLimit(options: { defaultValue: number; max: number; min?: number }) {
  const min = options.min ?? 1;
  if (!Number.isInteger(options.defaultValue) || options.defaultValue < min || options.defaultValue > options.max) {
    throw new Error(
      `boundedLimit: defaultValue ${options.defaultValue} must be an integer within [${min}, ${options.max}]. `
      + 'A zero or out-of-range default previously resulted in an unbounded query.',
    );
  }
  return z.union([z.number(), z.string().regex(/^\d+$/)])
    .transform((value) => (typeof value === 'number' ? value : Number(value)))
    .refine((v) => Number.isInteger(v) && Number.isSafeInteger(v) && v >= min && v <= options.max, { message: `Must be between ${min} and ${options.max}` })
    .default(options.defaultValue);
}
