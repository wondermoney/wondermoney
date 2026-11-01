import { z } from 'zod'

import { knownValues, readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Server-authoritative versioned onboarding/bootstrap DTO served by
 * `GET /v1/user/me/onboarding`. Fields outside the schema are stripped, so
 * nothing extra reaches the view model. Nulls are explicit and never inferred.
 *
 * `version` is the content version the server currently considers "fresh".
 * `required` is the server's view of whether this user should see the journey
 * right now. `completed` and `completedVersion` reflect persisted state.
 * `supportedActions` and `skippable` are the contract-level escape hatches:
 * the client must never invent a destination the server hasn't listed here.
 */

const ONBOARDING_SUPPORTED_ACTIONS = ['connect_bank', 'create_manual_account', 'skip'] as const
export const onboardingSupportedActionSchema = z.enum(ONBOARDING_SUPPORTED_ACTIONS)

export const onboardingStepSchema = z
  .object({
    done: z.boolean(),
    key: z.string().min(1).max(64),
  })

export const onboardingStateSchema = z
  .object({
    completed: z.boolean(),
    completedVersion: z.number().int().min(0).nullable(),
    required: z.boolean(),
    skippable: z.boolean(),
    steps: z.array(onboardingStepSchema),
    // An action this build doesn't know is dropped: the client never offers a destination it
    // can't route to, and the rest of the journey still loads.
    supportedActions: knownValues(ONBOARDING_SUPPORTED_ACTIONS),
    version: z.number().int().min(0),
  })

export const onboardingBootstrapResponseSchema = z.object({
  onboarding: onboardingStateSchema,
})

export type OnboardingSupportedAction = z.infer<typeof onboardingSupportedActionSchema>
export type OnboardingStepDto = z.infer<typeof onboardingStepSchema>
export type OnboardingStateDto = z.infer<typeof onboardingStateSchema>

export function createOnboardingBootstrapEndpoint() {
  return readEndpoint({
    method: 'GET',
    path: '/v1/user/me/onboarding',
    schema: onboardingBootstrapResponseSchema,
  })
}

/**
 * Idempotent completion mutation. The body MUST carry the same
 * content `version` the server advertised in the bootstrap. A stale or
 * future version is rejected with HTTP 400 by the server. Repeated calls
 * with the current version are a no-op success.
 */
export const completeOnboardingRequestSchema = z.object({
  version: z.number().int().min(0),
})

const completeOnboardingResponseSchema = onboardingBootstrapResponseSchema

export function createCompleteOnboardingEndpoint() {
  return writeEndpoint({
    method: 'POST',
    path: '/v1/user/me/onboarding/complete',
    schema: completeOnboardingResponseSchema,
  })
}
