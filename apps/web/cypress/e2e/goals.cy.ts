describe("Goals navigation", () => {
  it("routes to the localized login page when goals are accessed without auth", () => {
    cy.visit("/en/goals");

    cy.url().should("include", "/en/auth/login");
    cy.contains("h1", "Welcome back").should("be.visible");
  });

  it("redirects unauthenticated users away from goals on mobile", () => {
    cy.viewport("iphone-se2");

    cy.visit("/en/goals");

    cy.url().should("include", "/en/auth/login");
    cy.get('[data-testid="bottom-nav"]').should("not.exist");
    cy.get('form input[type="email"]').should("be.visible");
    cy.get('form input[type="password"]').should("be.visible");
  });
});
