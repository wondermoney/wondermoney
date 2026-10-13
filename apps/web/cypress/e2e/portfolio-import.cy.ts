import { BROKER_IMPORT_CASES } from "./portfolio-import/cases";
import {
  assertImportedMetrics,
  authenticate,
  createPortfolio,
  deletePortfolio,
  importBrokerFile,
  type PortfolioAuthContext,
  type PortfolioContext,
} from "./portfolio-import/driver";

// These scenarios stay `describe.skip`ped unless the isolated portfolio-import
// lane is explicitly enabled. Required env vars (mapped in cypress.config.ts):
//   - E2E_PORTFOLIO_IMPORT_ENABLED=1
//   - E2E_PORTFOLIO_IMPORT_EMAIL + E2E_PORTFOLIO_IMPORT_PASSWORD (better-auth)
//   - E2E_API_BASE_URL (optional, defaults to http://localhost:3001)
// The account is created/signed in through better-auth and provisioned via
// POST /v1/auth/callback; run only against an isolated local/test database.
const e2eEnabled = Cypress.env("E2E_PORTFOLIO_IMPORT_ENABLED") === "1";
const importDescribe = e2eEnabled ? describe : describe.skip;

importDescribe("Portfolio broker imports", () => {
  let auth: PortfolioAuthContext | undefined;
  let context: PortfolioContext | undefined;

  beforeEach(() => {
    authenticate().then((authenticated) => {
      auth = authenticated;
    });
  });

  afterEach(() => {
    if (!context) return;
    deletePortfolio(context);
    context = undefined;
  });

  for (const input of BROKER_IMPORT_CASES) {
    it(`imports ${input.brokerLabel} positions and broker P&L from ${input.fileName}`, () => {
      if (!auth) throw new Error("Portfolio import E2E is not authenticated");
      createPortfolio(auth, `E2E ${input.brokerLabel} ${Date.now()}`).then(
        (createdContext) => {
          context = createdContext;
          importBrokerFile(createdContext, input).then(() => {
            assertImportedMetrics(createdContext, input);
          });
        },
      );
    });
  }
});
