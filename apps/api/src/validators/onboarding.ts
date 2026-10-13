import { z } from 'zod';

import { CURRENT_ONBOARDING_VERSION } from '@app/onboarding-version';

/**
 * RAD-226 — request envelope for `POST /v1/user/me/onboarding/complete`.
 * The body carries the content version the client is completing. The server
 * compares it against the current content version; a stale or future version
 * is rejected with 400. Idempotency is enforced server-side: repeating the
 * same call is a no-op success.
 */
export const completeOnboardingRequestSchema = z.object({
  body: z.object({
    version: z.literal(CURRENT_ONBOARDING_VERSION),
  }),
});
