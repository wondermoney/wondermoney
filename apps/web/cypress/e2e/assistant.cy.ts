describe.skip("Assistant consent flow", () => {
  // TODO: Enable once Cypress auth/session setup and assistant consent fixtures exist.
  // The assistant lives under /settings, which redirects anonymous users to login.
  // Each test should stub or reset /v1/assistant/consent so launcherHidden and
  // assistantEnabled do not leak between cases.

  it("shows the assistant launcher on the authenticated settings page", () => {
    cy.visit("/en/settings?tab=assistant");

    cy.get('[data-testid="assistant-launcher"]').should("be.visible");
  });

  it("opens the consent screen before assistant access is enabled", () => {
    cy.visit("/en/settings?tab=assistant");

    cy.get('[data-testid="assistant-launcher"]').click();
    cy.get('[data-testid="assistant-panel"]').should("be.visible");
    cy.get('[data-testid="assistant-consent-screen"]').should("be.visible");
    cy.get('[data-testid="assistant-enable"]').should("be.visible");
  });

  it("dismisses the consent screen", () => {
    cy.visit("/en/settings?tab=assistant");

    cy.get('[data-testid="assistant-launcher"]').click();
    cy.get('[data-testid="assistant-dismiss"]').click();
    cy.get('[data-testid="assistant-panel"]').should("not.exist");
  });

  it("shows the launcher and bottom nav on mobile", () => {
    cy.viewport("iphone-se2");
    cy.visit("/en/settings?tab=assistant");

    cy.get('[data-testid="bottom-nav"]').should("be.visible");
    cy.get('[data-testid="assistant-launcher"]').should("be.visible");
  });
});
