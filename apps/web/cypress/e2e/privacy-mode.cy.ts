import {
  apiBaseUrl,
  createOrSignInBetterAuthUser,
  e2eWebOrigin,
} from "../support/better-auth";

// Privacy mode leak check. Like the portfolio-import lane it needs a local API
// and a disposable database, so it stays `describe.skip`ped unless enabled:
//   - E2E_PRIVACY_MODE_ENABLED=1
//   - E2E_API_BASE_URL (optional, defaults to http://localhost:3001)
// It signs up a fresh test user, seeds one offline account with a known
// balance, turns privacy mode on and fails if any route shows a money figure.
const enabled = Cypress.expose("E2E_PRIVACY_MODE_ENABLED") === "1";
const privacyDescribe = enabled ? describe : describe.skip;

const SEEDED_BALANCE = 12345.67;

const MAIN_ROUTES = [
  "/en",
  "/en/accounts",
  "/en/accounts/transactions",
  "/en/accounts/recurring",
  "/en/budgets",
  "/en/goals",
  "/en/loans",
  "/en/portfolio",
  "/en/reports",
];

/**
 * A currency symbol touching a digit (`€12`, `12 €`, `US$3`), or the seeded
 * balance in any grouping. Percentages, counts and dates stay visible by
 * design, so a bare number is not a leak.
 */
// Only same-line spacing: a date on one line and a masked figure on the next
// ("Nov 26\n€•••••") is not a leak.
const MONEY_PATTERN = /[€$£¥][ \u00a0\u202f]?[\d−-]|\d[ \u00a0\u202f]?[€$£¥]/;
const SEEDED_PATTERN = /12[,.\s ]?345/;

function firstRunState(userId: string) {
  return [
    `wondermoney:first-run-onboarding:v1:${userId}`,
    JSON.stringify({
      accountStep: "skipped",
      budgetStep: "skipped",
      completedAt: new Date().toISOString(),
      currentStep: "completion",
      portfolioStep: "skipped",
      selectedGoals: [],
      status: "completed",
    }),
  ] as const;
}

privacyDescribe("Privacy mode", () => {
  let userId = "";

  before(() => {
    const email = `test+${crypto.randomUUID()}@example.invalid`;
    createOrSignInBetterAuthUser(email, crypto.randomUUID(), "E2E Privacy")
      .then((session) => {
        userId = session.userId;
        const auth = {
          Authorization: `Bearer ${session.accessToken}`,
          Origin: e2eWebOrigin(),
        };
        cy.request({
          body: {},
          headers: auth,
          method: "POST",
          url: `${apiBaseUrl()}/v1/auth/callback`,
        });
        cy.request<{ currencies: { currencyKey: number; code: string }[] }>({
          headers: auth,
          url: `${apiBaseUrl()}/v1/account/currencies`,
        }).then(({ body }) => {
          const eur = body.currencies.find((c) => c.code === "EUR");
          if (!eur) throw new Error("The local API has no EUR currency");
          cy.request({
            body: {
              currencyId: String(eur.currencyKey),
              currentBalance: SEEDED_BALANCE,
              name: "E2E privacy account",
            },
            headers: auth,
            method: "POST",
            url: `${apiBaseUrl()}/v1/account/offline`,
          });
        });
      });
  });

  beforeEach(() => {
    // `before` leaves the session cookie in the jar; keep it between tests.
    cy.viewport(1280, 900);
  });

  it("shows the seeded balance while off, so the check below is meaningful", () => {
    cy.clearCookie("wm-privacy-mode");
    cy.visit("/en/accounts", {
      onBeforeLoad(win) {
        win.localStorage.setItem(...firstRunState(userId));
      },
    });
    cy.contains(SEEDED_PATTERN, { timeout: 60_000 }).should("exist");
  });

  it("one click hides amounts and the choice survives a reload", () => {
    cy.clearCookie("wm-privacy-mode");
    cy.visit("/en/accounts", {
      onBeforeLoad(win) {
        win.localStorage.setItem(...firstRunState(userId));
      },
    });
    cy.contains(SEEDED_PATTERN, { timeout: 60_000 }).should("exist");
    cy.contains("button", "Hide amounts").click();
    cy.getCookie("wm-privacy-mode").its("value").should("eq", "1");
    cy.reload();
    cy.contains("button", "Show amounts", { timeout: 60_000 }).should(
      "have.attr",
      "aria-pressed",
      "true",
    );
    cy.get("body").invoke("text").should("not.match", SEEDED_PATTERN);
  });

  for (const route of MAIN_ROUTES) {
    it(`leaks no money figure on ${route}`, () => {
      cy.setCookie("wm-privacy-mode", "1");
      cy.visit(route, {
        onBeforeLoad(win) {
          win.localStorage.setItem(...firstRunState(userId));
        },
      });
      cy.get("main", { timeout: 60_000 }).should("exist");
      // Let the queries settle: a figure that arrives late must be masked too.
      cy.get('[aria-busy="true"]', { timeout: 60_000 }).should("not.exist");
      cy.wait(1500);
      cy.get("body")
        .invoke("text")
        .then((text) => {
          expect(text, `${route} shows money`).not.to.match(MONEY_PATTERN);
          expect(text, `${route} shows the seeded balance`).not.to.match(
            SEEDED_PATTERN,
          );
        });
    });
  }
});
