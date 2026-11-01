describe("First-run onboarding", () => {
  it("redirects anonymous users away from the route-based onboarding entry", () => {
    cy.visit("/en/onboarding/welcome");

    cy.url().should("include", "/en/auth/login");
    cy.contains("h1", "Welcome back").should("be.visible");
  });
});
