import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * RAD-226 — server-authoritative versioned onboarding/bootstrap DTO served by
 * `GET /v1/user/me/onboarding`. Strict: any extra field (e.g. legacy numeric
 * step ids, user/tenant ids) is a contract violation. Nulls are explicit and
 * never inferred.
 *
 * `version` is the content version the server currently considers "fresh".
 * `required` is the server's view of whether this user should see the journey
 * right now. `completed` and `completedVersion` reflect persisted state.
 * `supportedActions` and `skippable` are the contract-level escape hatches:
 * the client must never invent a destination the server hasn't listed here.
 */

export const onboardingSupportedActionSchema = z.enum(['connect_bank', 'create_manual_account', 'skip'])

export const onboardingStepSchema = z
  .object({
    done: z.boolean(),
    key: z.string().min(1).max(64),
  })
  .strict()

export const onboardingStateSchema = z
  .object({
    completed: z.boolean(),
    completedVersion: z.number().int().min(0).nullable(),
    required: z.boolean(),
    skippable: z.boolean(),
    steps: z.array(onboardingStepSchema),
    supportedActions: z.array(onboardingSupportedActionSchema),
    version: z.number().int().min(0),
  })
  .strict()

export const onboardingBootstrapResponseSchema = z.object({
  onboarding: onboardingStateSchema,
})

export type OnboardingSupportedAction = z.infer<typeof onboardingSupportedActionSchema>
export type OnboardingStepDto = z.infer<typeof onboardingStepSchema>
export type OnboardingStateDto = z.infer<typeof onboardingStateSchema>
export type OnboardingBootstrapResponseDto = z.infer<typeof onboardingBootstrapResponseSchema>

export function createOnboardingBootstrapEndpoint() {
  return readEndpoint({
    method: 'GET',
    path: '/v1/user/me/onboarding',
    schema: onboardingBootstrapResponseSchema,
  })
}

/**
 * RAD-226 — idempotent completion mutation. The body MUST carry the same
 * content `version` the server advertised in the bootstrap. A stale or
 * future version is rejected with HTTP 400 by the server. Repeated calls
 * with the current version are a no-op success.
 */
export const completeOnboardingRequestSchema = z.object({
  version: z.number().int().min(0),
})

export const completeOnboardingResponseSchema = onboardingBootstrapResponseSchema

export type CompleteOnboardingRequest = z.infer<typeof completeOnboardingRequestSchema>
export type CompleteOnboardingResponse = z.infer<typeof completeOnboardingResponseSchema>

export function createCompleteOnboardingEndpoint() {
  return writeEndpoint({
    method: 'POST',
    path: '/v1/user/me/onboarding/complete',
    schema: completeOnboardingResponseSchema,
  })
}
