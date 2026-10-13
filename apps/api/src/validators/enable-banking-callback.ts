import { z } from 'zod';

/**
 * Enable Banking's callback query shape (`?code=&state=` on success, `?error=&state=`
 * on failure) — not GoCardless's `?ref=&error=&details=` shape used by the existing
 * `bankConnectionCallbackRequestSchema`. Every field is optional, including `state`:
 * this endpoint is hit directly by the end user's browser with no WonderMoney session,
 * so a malformed/missing value must fall through to a safe redirect in the controller
 * rather than a raw 400 zod-validation error surfaced to the browser.
 */
export const enableBankingCallbackRequestSchema = z.object({
  query: z.object({
    code: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
    state: z.string().optional(),
  }),
});
