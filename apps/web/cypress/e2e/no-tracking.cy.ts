// A self-hosted instance with the default env sets no analytics keys, so its
// pages must not contact Google Tag Manager or PostHog. CI runs this with
// NEXT_PUBLIC_ENABLE_ANALYTICS=1 (what a production build implies) and no
// NEXT_PUBLIC_GTM_ID or NEXT_PUBLIC_POSTHOG_KEY, so only the missing keys keep
// the trackers off.
const TRACKER_HOSTS = /googletagmanager\.com|posthog\.com/;

describe("Self-hosted defaults", () => {
  it("loads no analytics or tag manager without keys", () => {
    const trackerRequests: string[] = [];
    cy.intercept({ url: TRACKER_HOSTS }, (request) => {
      trackerRequests.push(request.url);
      request.reply({ statusCode: 204 });
    });

    cy.visit("/en/auth/login");
    cy.get('form input[type="email"]').should("be.visible");
    cy.visit("/en/auth/signup");
    cy.get('form input[type="email"]').should("be.visible");

    cy.get("script[src*='googletagmanager.com'], script[src*='posthog.com']").should(
      "not.exist",
    );
    cy.wrap(trackerRequests).should("be.empty");
  });
});
