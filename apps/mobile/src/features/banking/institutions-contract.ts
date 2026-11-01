import { z } from 'zod'

import { readEndpoint } from '@/lib/api/runtime-schema'

/**
 * Bank institution picker source list. `GET /v1/banking/bank`
 * forwards the provider's institution data close to verbatim, so unlike the
 * connections DTO (our own allowlisted shape) this schema stays permissive
 * on unknown upstream fields — only the fields the picker actually renders
 * (id, name, logo) are validated.
 */
export const bankInstitutionSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  logo: z.string().nullable(),
})

export const bankInstitutionsResponseSchema = z.array(bankInstitutionSchema)

export type BankInstitutionDto = z.infer<typeof bankInstitutionSchema>

export function createBankInstitutionsEndpoint(countryCode?: string) {
  const query = countryCode ? `?country=${encodeURIComponent(countryCode)}` : ''
  return readEndpoint({
    method: 'GET',
    path: `/v1/banking/bank${query}`,
    schema: bankInstitutionsResponseSchema,
  })
}
