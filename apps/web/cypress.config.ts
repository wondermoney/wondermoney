import { defineConfig } from "cypress";

// OS env vars are mapped into `Cypress.env()` here; specs read them with
// `Cypress.env(...)`. Secrets are read name-only and never logged.
//
// Auth credentials are better-auth email/password pairs (the previous
// Supabase URL/anon/service-key vars were removed with the auth migration):
//   - E2E_PORTFOLIO_IMPORT_EMAIL / E2E_PORTFOLIO_IMPORT_PASSWORD
// The specs create/sign in users directly against better-auth at
// `<E2E_API_BASE_URL>/api/auth/*`, so no Supabase admin/service key is needed.
const baseUrl =
  process.env.CYPRESS_BASE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000";

export default defineConfig({
  e2e: {
    baseUrl,
    env: {
      E2E_API_BASE_URL: process.env.E2E_API_BASE_URL,
      E2E_BYPASS_RECAPTCHA: process.env.E2E_BYPASS_RECAPTCHA,
      E2E_PORTFOLIO_IMPORT_EMAIL: process.env.E2E_PORTFOLIO_IMPORT_EMAIL,
      E2E_PORTFOLIO_IMPORT_ENABLED: process.env.E2E_PORTFOLIO_IMPORT_ENABLED,
      E2E_PORTFOLIO_IMPORT_PASSWORD: process.env.E2E_PORTFOLIO_IMPORT_PASSWORD,
      NEXT_PUBLIC_E2E_BYPASS_RECAPTCHA:
        process.env.NEXT_PUBLIC_E2E_BYPASS_RECAPTCHA,
    },
    supportFile: false,
  },
});
