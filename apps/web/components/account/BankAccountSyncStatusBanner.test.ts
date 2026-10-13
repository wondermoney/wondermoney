import assert from "node:assert/strict";

import { test } from "vitest";

import { hasInstitutionTechnicalError } from "../../lib/account/bank-account-sync-banner";

test("shows the bank issue banner for InstitutionTechnicalError", () => {
  assert.equal(hasInstitutionTechnicalError("InstitutionTechnicalError"), true);
});

test("returns false for other errors", () => {
  assert.equal(hasInstitutionTechnicalError("SomeOtherError"), false);
});
