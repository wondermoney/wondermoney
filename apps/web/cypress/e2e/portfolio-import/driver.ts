import {
  apiBaseUrl,
  createOrSignInBetterAuthUser,
} from "../../support/better-auth";
import {
  assertImportedHoldingQuantities,
  assertImportedTransactions,
  assertImportPreview,
  assertRealizedGains,
  type ImportPreview,
  type PortfolioContext,
} from "./assertions";
import type { BrokerImportCase } from "./cases";

export type { PortfolioContext } from "./assertions";

type ImportSessionCreateResponse = {
  readonly importSessionId: number;
};

export type PortfolioAuthContext = {
  readonly accessToken: string;
  readonly userId: string;
};

type ImportAssetGroup = {
  readonly id: number;
  readonly identity: { readonly brokerTicker?: string };
  readonly recommendedCandidateId?: number;
  readonly status: string;
};

type AssetReviewPreview = ImportPreview & {
  readonly assetGroups: readonly ImportAssetGroup[];
};

class PortfolioImportE2EError extends Error {}

function assertSuccessfulStatus(status: number, operation: string): void {
  if (status < 200 || status >= 300) {
    throw new PortfolioImportE2EError(
      `${operation} failed with HTTP ${status}`,
    );
  }
}

export function authenticate(): Cypress.Chainable<PortfolioAuthContext> {
  const email = Cypress.env("E2E_PORTFOLIO_IMPORT_EMAIL");
  const password = Cypress.env("E2E_PORTFOLIO_IMPORT_PASSWORD");
  if (
    typeof email !== "string" ||
    email.length === 0 ||
    typeof password !== "string" ||
    password.length === 0
  ) {
    throw new PortfolioImportE2EError(
      "Portfolio import E2E requires E2E_PORTFOLIO_IMPORT_EMAIL and E2E_PORTFOLIO_IMPORT_PASSWORD",
    );
  }

  // Better-auth sign-up/sign-in replaces the old Supabase admin session that
  // `portfolioImportAuthSession` used to create in a cy.task. Its bearer token
  // then replaces the Supabase access token for `/v1/auth/callback` and the
  // authenticated API calls below.
  return createOrSignInBetterAuthUser(email, password, "E2E Portfolio Import")
    .then((session) =>
      cy
        .request({
          body: {},
          failOnStatusCode: false,
          headers: { Authorization: `Bearer ${session.accessToken}` },
          log: false,
          method: "POST",
          url: `${apiBaseUrl()}/v1/auth/callback`,
        })
        .then((response) => {
          assertSuccessfulStatus(response.status, "Auth callback");
          return session;
        }),
    )
    .then((session) =>
      cy
        .request({
          failOnStatusCode: false,
          headers: { Authorization: `Bearer ${session.accessToken}` },
          log: false,
          method: "GET",
          url: `${apiBaseUrl()}/v1/portfolio`,
        })
        .then((response) => {
          assertSuccessfulStatus(response.status, "Portfolio preflight");
          return session;
        }),
    )
    .then((session) =>
      // Sign-in already stored better-auth's session cookie in the browser, so
      // the protected portfolio route is authenticated. The first-run flag is
      // seeded in `onBeforeLoad` so the onboarding modal never renders.
      cy
        .visit("/en/portfolio", {
          onBeforeLoad(browserWindow) {
            browserWindow.localStorage.setItem(
              `wondermoney:first-run-onboarding:v1:${session.userId}`,
              JSON.stringify({
                accountStep: "skipped",
                budgetStep: "skipped",
                completedAt: new Date().toISOString(),
                currentStep: "completion",
                portfolioStep: "skipped",
                selectedGoals: [],
                status: "completed",
              }),
            );
          },
        })
        .then(() =>
          cy
            .url({ timeout: 60_000 })
            .should("include", "/en/portfolio")
            .then(() => ({
              accessToken: session.accessToken,
              userId: session.userId,
            })),
        ),
    );
}

export function createPortfolio(
  auth: PortfolioAuthContext,
  name: string,
): Cypress.Chainable<PortfolioContext> {
  cy.intercept("POST", "**/v1/portfolio/").as("createPortfolio");
  cy.visit("/en/portfolio");
  cy.contains("button", "Create your first portfolio", {
    timeout: 30_000,
  }).click();
  cy.get('input[placeholder="My Tech Stocks Portfolio"]').type(name);
  cy.contains('[role="dialog"] label', "Currency")
    .parent()
    .find('[role="combobox"]')
    .click();
  cy.contains('[role="option"]', /Euro/i).click();
  cy.contains('[role="dialog"] button', "Create").click();

  return cy
    .wait<Record<string, unknown>, { portfolio: { portfolioKey: number } }>(
      "@createPortfolio",
    )
    .then((interception) => {
      const portfolioId = interception.response?.body.portfolio.portfolioKey;
      if (!portfolioId) {
        throw new PortfolioImportE2EError(
          "Portfolio creation did not return a portfolio id",
        );
      }
      return {
        accessToken: auth.accessToken,
        portfolioId,
      };
    });
}

export function deletePortfolio(context: PortfolioContext): void {
  cy.request({
    failOnStatusCode: false,
    headers: { Authorization: `Bearer ${context.accessToken}` },
    log: false,
    method: "DELETE",
    url: `${apiBaseUrl()}/v1/portfolio/${context.portfolioId}`,
  });
}

function requestPreview(context: PortfolioContext, importSessionId: number) {
  return cy.request<AssetReviewPreview>({
    failOnStatusCode: false,
    headers: { Authorization: `Bearer ${context.accessToken}` },
    log: false,
    method: "GET",
    url: `${apiBaseUrl()}/v1/portfolio-import-sessions/${importSessionId}?limit=100`,
  }).then((response) => {
    assertSuccessfulStatus(response.status, "Import preview");
    return response;
  });
}

function resolveAssetGroups(
  context: PortfolioContext,
  importSessionId: number,
  input: BrokerImportCase,
): Cypress.Chainable<AssetReviewPreview> {
  return requestPreview(context, importSessionId).then(({ body: preview }) => {
    const unresolved = preview.assetGroups.filter(
      (group) => !["matched", "selected", "skipped"].includes(group.status),
    );
    const skippedSymbols = preview.assetGroups
      .filter((group) => group.status === "skipped")
      .flatMap((group) =>
        group.identity.brokerTicker ? [group.identity.brokerTicker] : [],
      );
    expect(skippedSymbols.sort()).to.deep.equal(
      (input.expectedUnsupportedAssets ?? [])
        .map((asset) => asset.symbol)
        .sort(),
    );
    if (unresolved.length === 0) return cy.wrap(preview);

    const decisions = unresolved.map((group) => {
      if (group.recommendedCandidateId) {
        return {
          action: "use_candidate",
          candidateId: group.recommendedCandidateId,
          groupId: group.id,
        };
      }
      if (group.identity.brokerTicker) {
        return {
          action: "use_external_symbol",
          groupId: group.id,
          symbol: group.identity.brokerTicker,
        };
      }
      throw new PortfolioImportE2EError(
        `Asset group ${group.id} has no deterministic resolution`,
      );
    });

    return cy
      .request({
        body: { decisions },
        failOnStatusCode: false,
        headers: { Authorization: `Bearer ${context.accessToken}` },
        log: false,
        method: "PATCH",
        url: `${apiBaseUrl()}/v1/portfolio-import-sessions/${importSessionId}/asset-mappings`,
      })
      .then((response) => {
        assertSuccessfulStatus(response.status, "Asset mapping");
        return requestPreview(context, importSessionId).its("body");
      });
  });
}

export function importBrokerFile(
  context: PortfolioContext,
  input: BrokerImportCase,
): Cypress.Chainable<number> {
  cy.intercept("POST", "**/v1/portfolio/*/import-sessions").as(
    "createImportSession",
  );
  cy.intercept("POST", "**/v1/portfolio-import-sessions/*/parse").as(
    "parseImportSession",
  );
  cy.intercept(
    "POST",
    "**/v1/portfolio-import-sessions/*/column-mapping/suggest",
  ).as("suggestImportMapping");
  cy.visit(`/en/portfolio/${context.portfolioId}/transactions?import=1`);
  cy.contains("label", "Broker")
    .parent()
    .find('[role="combobox"]')
    .click();
  cy.contains('[role="option"]', input.brokerLabel).click();
  cy.fixture(input.fixture, "utf8").then((base64) => {
    cy.get('input[type="file"]').selectFile(
      {
        contents: Cypress.Buffer.from(base64.replace(/\s+/g, ""), "base64"),
        fileName: input.fileName,
        mimeType: input.mimeType,
      },
      { action: "drag-drop", force: true },
    );
  });
  cy.contains("button", "Analyze file").click();

  return cy
    .wait<Record<string, unknown>, ImportSessionCreateResponse>(
      "@createImportSession",
    )
    .then((interception) => {
      const importSessionId = interception.response?.body.importSessionId;
      if (!importSessionId) {
        throw new PortfolioImportE2EError("Import session was not created");
      }
      cy.wait("@parseImportSession");
      cy.contains("Map columns to portfolio fields", { timeout: 120_000 }).should(
        "be.visible",
      );
      cy.wait("@suggestImportMapping", { timeout: 60_000 });
      return cy.request({
        body: input.mapping,
        failOnStatusCode: false,
        headers: { Authorization: `Bearer ${context.accessToken}` },
        log: false,
        method: "PATCH",
        url: `${apiBaseUrl()}/v1/portfolio-import-sessions/${importSessionId}/column-mapping`,
      }).then((response) => {
        assertSuccessfulStatus(response.status, "Column mapping");
        return resolveAssetGroups(context, importSessionId, input).then((preview) => {
          assertImportPreview(preview, input);
          return importSessionId;
        });
      });
    });
}

export function assertImportedMetrics(
  context: PortfolioContext,
  input: BrokerImportCase,
): void {
  cy.contains("button", "Confirm import").click();
  cy.contains("Import complete", { timeout: 180_000 }).should("be.visible");
  const baseUrl = apiBaseUrl();
  assertImportedTransactions(context, input, baseUrl);
  assertImportedHoldingQuantities(context, input, baseUrl);
  assertRealizedGains(context, input, baseUrl);
}
