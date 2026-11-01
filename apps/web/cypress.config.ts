import { defineConfig } from "cypress";

// OS env vars are mapped into Cypress config here (Cypress 16 removed
// `Cypress.env()`):
//   - `expose`: non-secret settings, read synchronously with `Cypress.expose(...)`.
//   - `env`: secrets, read asynchronously with `cy.env([...])`, which yields
//     only the requested keys and logs names, never values.
//
// Auth credentials are better-auth email/password pairs:
//   - E2E_PORTFOLIO_IMPORT_EMAIL / E2E_PORTFOLIO_IMPORT_PASSWORD
// The specs create/sign in users directly against better-auth at
// `<E2E_API_BASE_URL>/api/auth/*`, so no admin/service key is needed.
const baseUrl =
  process.env.CYPRESS_BASE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  `http://localhost:${process.env.E2E_WEB_PORT ?? "3000"}`;

export default defineConfig({
  e2e: {
    baseUrl,
    env: {
      E2E_PORTFOLIO_IMPORT_EMAIL: process.env.E2E_PORTFOLIO_IMPORT_EMAIL,
      E2E_PORTFOLIO_IMPORT_PASSWORD: process.env.E2E_PORTFOLIO_IMPORT_PASSWORD,
    },
    expose: {
      E2E_API_BASE_URL: process.env.E2E_API_BASE_URL,
      E2E_BYPASS_RECAPTCHA: process.env.E2E_BYPASS_RECAPTCHA,
      E2E_PORTFOLIO_IMPORT_ENABLED: process.env.E2E_PORTFOLIO_IMPORT_ENABLED,
      NEXT_PUBLIC_E2E_BYPASS_RECAPTCHA:
        process.env.NEXT_PUBLIC_E2E_BYPASS_RECAPTCHA,
    },
    supportFile: "cypress/support/e2e.ts",
  },
});
