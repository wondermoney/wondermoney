describe("First-run onboarding", () => {
  it("redirects anonymous users away from the route-based onboarding entry", () => {
    cy.visit("http://localhost:3000/en/onboarding/welcome");

    cy.url().should("include", "/en/auth/login");
    cy.contains("h2", "Welcome back").should("be.visible");
  });
});
