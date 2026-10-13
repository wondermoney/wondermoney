describe("Mobile bottom navigation", () => {
  beforeEach(() => {
    cy.viewport("iphone-se2");
  });

  it("does not render the bottom nav on the login page", () => {
    cy.visit("http://localhost:3000/en/auth/login");
    cy.get('[data-testid="bottom-nav"]').should("not.exist");
  });

  it("does not render the bottom nav on the signup page", () => {
    cy.visit("http://localhost:3000/en/auth/signup");
    cy.get('[data-testid="bottom-nav"]').should("not.exist");
  });

  it("redirects unauthenticated users away from protected pages on mobile", () => {
    cy.visit("http://localhost:3000/en/accounts");

    cy.url().should("include", "/en/auth/login");
    cy.get('[data-testid="bottom-nav"]').should("not.exist");
    cy.get('form input[type="email"]').should("be.visible");
    cy.get('form input[type="password"]').should("be.visible");
  });
});
