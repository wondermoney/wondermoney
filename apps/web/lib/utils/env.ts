import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /*
   * Serverside Environment variables, not available on the client.
   * Will throw if you access these variables on the client.
   */
  server: {
    // Add any server-side specific environment variables here, if needed.
    SENTRY_IGNORE_API_RESOLUTION_ERROR: z.coerce.number().optional().default(1),
    ENABLE_SENTRY: z.literal("1").optional(),
    NODE_ENV: z.enum(["development", "production", "test"]),
    RECAPTCHA_SECRET_KEY: z.string().optional(),
    E2E_BYPASS_RECAPTCHA: z.literal("1").optional(),
  },
  /*
   * Environment variables available on the client (and server).
   *
   * 💡 You'll get type errors if these are not prefixed with NEXT_PUBLIC_.
   */
  client: {
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_ENABLE_ANALYTICS: z.literal("1").optional(),
    NEXT_PUBLIC_ENABLE_SENTRY: z.literal("1").optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_VERCEL_ENV: z
      .enum(["development", "preview", "production"])
      .optional(),
    NEXT_PUBLIC_VERCEL_URL: z.string().url().optional(),
    NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
    // Optional (not .string().url() required) because it isn't set in every
    // local .env.local today — callers fall back to http://localhost:3001.
    NEXT_PUBLIC_API_URL: z.string().url().optional(),
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY: z.string().optional(),
    NEXT_PUBLIC_E2E_BYPASS_RECAPTCHA: z.literal("1").optional(),
    NEXT_PUBLIC_BANK_CONNECTIONS_PAUSED: z.literal("1").optional(),
  },
  /*
   * Due to how Next.js bundles environment variables on Edge and Client,
   * we need to manually destructure them to make sure all are included in bundle.
   *
   * 💡 You'll get type errors if not all variables from `server` & `client` are included here.
   */
  /*
   * The self-hosting image sets every NEXT_PUBLIC_* value at container start, and an unset one
   * arrives as "" (see docker/entrypoint.sh): treat that as not set.
   */
  emptyStringAsUndefined: true,
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    SENTRY_IGNORE_API_RESOLUTION_ERROR:
      process.env.SENTRY_IGNORE_API_RESOLUTION_ERROR,
    ENABLE_SENTRY: process.env.ENABLE_SENTRY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_ENABLE_ANALYTICS: process.env.NEXT_PUBLIC_ENABLE_ANALYTICS,
    NEXT_PUBLIC_ENABLE_SENTRY: process.env.NEXT_PUBLIC_ENABLE_SENTRY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
    NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
    NEXT_PUBLIC_E2E_BYPASS_RECAPTCHA:
      process.env.NEXT_PUBLIC_E2E_BYPASS_RECAPTCHA,
    NEXT_PUBLIC_BANK_CONNECTIONS_PAUSED:
      process.env.NEXT_PUBLIC_BANK_CONNECTIONS_PAUSED,
    E2E_BYPASS_RECAPTCHA: process.env.E2E_BYPASS_RECAPTCHA,
    RECAPTCHA_SECRET_KEY: process.env.RECAPTCHA_SECRET_KEY,
  },
});
