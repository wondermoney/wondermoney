import { z } from 'zod'

export type ReadMethod = 'GET' | 'HEAD'
export type WriteMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export type ReadEndpoint<Value> = Readonly<{
  method: ReadMethod
  path: string
  schema: z.ZodType<Value>
}>

export type WriteEndpoint<Value> = Readonly<{
  method: WriteMethod
  path: string
  schema: z.ZodType<Value>
  successStatuses?: readonly number[]
}>

export const readEndpoint = <Value>(endpoint: ReadEndpoint<Value>): ReadEndpoint<Value> => endpoint

export const writeEndpoint = <Value>(endpoint: WriteEndpoint<Value>): WriteEndpoint<Value> => endpoint

export const commonErrorEnvelopeSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
})

export type CommonErrorEnvelope = z.infer<typeof commonErrorEnvelopeSchema>

export const parseCommonErrorEnvelope = (body: unknown): CommonErrorEnvelope | undefined => {
  const result = commonErrorEnvelopeSchema.safeParse(body)
  return result.success ? result.data : undefined
}

/**
 * Response schemas validate what the app reads from an HTTP API that ships on its own schedule,
 * so they must accept anything the API adds later. Installed builds can't be updated in step
 * with the API. Object schemas therefore use Zod's default (unknown keys are stripped), never
 * `.strict()`. Request schemas, which build the bodies the app sends, stay strict.
 *
 * `tolerantEnum` is for response enums that the API may extend. A known value comes through
 * unchanged. Any other string becomes `fallback`, so a new value shows up as "unknown" on one
 * row instead of failing the whole response. `fallback` can be `null` where the screen already
 * handles a missing value. Non-strings and missing values still fail, the same as `z.enum`.
 */
export function tolerantEnum<const Values extends readonly [string, ...string[]], const Fallback extends string | null>(
  values: Values,
  fallback: Fallback,
) {
  const known: ReadonlySet<string> = new Set(values)
  return z.string().transform((value): Values[number] | Fallback => (
    known.has(value) ? value as Values[number] : fallback
  ))
}

/** A response array of enum values: keeps the known ones and drops the rest. */
export function knownValues<const Values extends readonly [string, ...string[]]>(values: Values) {
  const known: ReadonlySet<string> = new Set(values)
  return z.array(z.string()).transform((items) => items.filter((item): item is Values[number] => known.has(item)))
}
