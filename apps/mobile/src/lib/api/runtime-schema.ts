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
