import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const button = read("components/ui/button.tsx");
const offlineModal = read("components/account/AccountCreateOfflineModal.tsx");
const accountsList = read("components/account/AccountsList.tsx");

assert.match(
  button,
  /type=\{type \?\? "button"\}/,
  'Button should default to type="button" to avoid accidental form submission',
);
assert.match(
  button,
  /<button[\s\S]*?type=\{type \?\? "button"\}/,
  "Button should pass the type=button fallback to the native button element it renders",
);

assert.match(
  offlineModal,
  /defaultValues:\s*\{[\s\S]*currencyId:\s*"151"[\s\S]*name:\s*t\("my-account"\)[\s\S]*currentBalance:\s*""[\s\S]*financialInstitutionId:\s*undefined[\s\S]*\}/,
  "Offline account form should initialize every controlled field to avoid controlled/uncontrolled warnings",
);
assert.match(
  offlineModal,
  /description=\{t\("account-details-description"\)\}/,
  "Offline account dialog should provide an accessible description",
);

assert.match(
  accountsList,
  /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/,
  "Account action menu trigger should stop pointer propagation before row navigation",
);
assert.match(
  accountsList,
  /onClick=\{\(e\) => e\.stopPropagation\(\)\}/,
  "Account action menu trigger should stop click propagation before row navigation",
);

console.log("Account dialog/action regression checks passed");
