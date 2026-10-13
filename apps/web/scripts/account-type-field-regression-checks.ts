/**
 * RAD-651 — manual accounts had no way to record a type (checking/savings/
 * credit card/loan/investment/cash). The API now accepts an optional
 * `accountTypeId` on offline account creation and exposes GET
 * /v1/account/account-types to list the seeded values; this script guards
 * the web-side wiring stays backward compatible and complete.
 */
import { readFileSync } from "node:fs";

const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

function read(path: string) {
  return readFileSync(path, "utf8");
}

function expectPattern(path: string, pattern: RegExp, message: string) {
  if (!pattern.test(read(path))) fail(`${path}: ${message}`);
}

// The new field must stay optional so a client that never sends it behaves
// exactly as before — no positivity/required constraint invented client-side
// beyond what the API itself enforces.
expectPattern(
  "components/account/AccountCreateOfflineModal.tsx",
  /accountTypeId:\s*z\.coerce\.number\(\)\.optional\(\)/,
  "accountTypeId must be optional so accounts created without a type keep working exactly as before",
);
expectPattern(
  "components/account/AccountCreateOfflineModal.tsx",
  /defaultValues:\s*\{[\s\S]*financialInstitutionId:\s*undefined[\s\S]*accountTypeId:\s*undefined[\s\S]*\}/,
  "accountTypeId must be initialized in defaultValues to avoid a controlled/uncontrolled warning",
);

// The dropdown must be sourced from the API's seeded list, not a hardcoded
// client-side enum that could drift from AccountTypeSeeder.
expectPattern(
  "components/account/AccountCreateOfflineModal.tsx",
  /useAccountTypes\(\)/,
  "Offline account form should source its type options from useAccountTypes, not a hardcoded list",
);
expectPattern(
  "components/account/AccountCreateOfflineModal.tsx",
  /name="accountTypeId"[\s\S]*?accountTypesData\?\.accountTypes\.map/,
  "Offline account form should render one SelectItem per fetched AccountType",
);

expectPattern(
  "lib/api/account/useAccountTypes.ts",
  /"\/v1\/account\/account-types"/,
  "useAccountTypes must call the account-types lookup endpoint",
);

// The mutation must actually forward the field to the API, not just accept
// it in the schema and silently drop it before the request.
expectPattern(
  "lib/api/account/useCreateOfflineAccount.ts",
  /mutationFn:\s*\(\s*\{[\s\S]*?accountTypeId,?[\s\S]*?\}[\s\S]*?=>[\s\S]*?api\.post\(`\/v1\/account\/offline`,\s*\{[\s\S]*?accountTypeId,?[\s\S]*?\}\)/,
  "createOfflineAccount mutation must destructure and forward accountTypeId in the POST body",
);

// Every seeded AccountType.description (see AccountTypeSeeder on the API)
// must resolve to a translation key in every supported locale, or picking
// that type in the dropdown throws/renders a raw missing-message string.
const SEEDED_ACCOUNT_TYPES = [
  "CHECKING",
  "SAVINGS",
  "INVESTMENT",
  "MORTGAGE",
  "CREDIT_CARD",
  "LOAN",
  "PENSION",
  "OTHER",
  "EXTERNAL",
  "CASH",
];

function accountTypeTranslationKey(description: string): string {
  return `account-type-${description.toLowerCase().replace(/_/g, "-")}`;
}

for (const [locale, path] of [
  ["en", "messages/en/common.json"],
  ["pt", "messages/pt/common.json"],
  ["es", "messages/es/common.json"],
] as const) {
  const messages = JSON.parse(read(path)) as Record<string, unknown>;
  for (const description of SEEDED_ACCOUNT_TYPES) {
    const key = accountTypeTranslationKey(description);
    if (typeof messages[key] !== "string" || messages[key].length === 0) {
      fail(`${path}: missing "${key}" translation for seeded AccountType ${description} (${locale})`);
    }
  }
  if (typeof messages["account-type"] !== "string") {
    fail(`${path}: missing "account-type" field label (${locale})`);
  }
}

if (failures.length > 0) {
  console.error("Account type field regression checks failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Account type field regression checks passed");
