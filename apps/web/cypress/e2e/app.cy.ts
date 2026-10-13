describe("App entry", () => {
  it("redirects anonymous users to the localized login page", () => {
    cy.visit("http://localhost:3000/");

    cy.url().should("include", "/en/auth/login");
    cy.contains("h2", "Welcome back").should("be.visible");
    cy.get('form input[type="email"]').should("be.visible");
    cy.get('form input[type="password"]').should("be.visible");
  });
});
