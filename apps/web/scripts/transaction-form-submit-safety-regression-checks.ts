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

function expectNoPattern(path: string, pattern: RegExp, message: string) {
  if (pattern.test(read(path))) fail(`${path}: ${message}`);
}

function expectMatchCount(
  path: string,
  pattern: RegExp,
  expectedCount: number,
  message: string,
) {
  const count = read(path).match(pattern)?.length ?? 0;
  if (count !== expectedCount) {
    fail(`${path}: ${message}; expected ${expectedCount}, found ${count}`);
  }
}

expectMatchCount(
  "components/ui/DatePicker.tsx",
  /<Button\b(?=[^>]*type="button")(?=[^>]*variant="input")[^>]*>/g,
  1,
  'DatePicker trigger must be type="button" so opening the calendar never submits parent forms',
);

expectMatchCount(
  "components/ui/combobox.tsx",
  /<Button\b(?=[^>]*type="button")(?=[^>]*variant=\{btnVariant\})[^>]*>/g,
  2,
  'ComboBox triggers must be type="button"',
);

expectMatchCount(
  "components/ui/combobox.tsx",
  /<Button\b(?=[^>]*type="button")(?=[^>]*variant="input")[^>]*>/g,
  2,
  'ComboBoxForm triggers must be type="button"',
);

expectMatchCount(
  "components/ui/combobox-creatable.tsx",
  /<Button\b(?=[^>]*type="button")(?=[^>]*variant=\{btnVariant\})[^>]*>/g,
  2,
  'ComboboxCreatable triggers must be type="button"',
);

expectMatchCount(
  "components/ui/combobox-creatable.tsx",
  /<Button\b(?=[^>]*type="button")(?=[^>]*variant="ghost")(?=[^>]*disabled=\{!canCreate\})[^>]*>[\s\S]*?renderCreateLabel\(trimmedQuery\)/g,
  2,
  'ComboboxCreatable create actions must remain type="button", be disabled for blank queries, and render explicit create copy for the trimmed query',
);

expectPattern(
  "components/ui/combobox-creatable.tsx",
  /const\s+trimmedQuery\s*=\s*getCreatableQuery\(query\)\s*\?\?\s*""/,
  "ComboboxCreatable must trim create queries before validating or creating options",
);

expectPattern(
  "components/ui/combobox-creatable.tsx",
  /const\s+canCreate\s*=\s*trimmedQuery\.length\s*>\s*0/,
  "ComboboxCreatable must prevent creating blank options",
);

expectNoPattern(
  "components/ui/combobox-creatable.tsx",
  /onCreate\(query\)/,
  "ComboboxCreatable must never pass untrimmed raw query text to onCreate",
);

expectMatchCount(
  "components/ui/combobox-creatable.tsx",
  /setQuery\(""\);\s*\n\s*onQueryChange\?\.\(""\);/g,
  2,
  "ComboboxCreatable must clear parent query state after creating an option in desktop and mobile flows",
);

expectPattern(
  "components/account/AccountTransactionAddForm.tsx",
  /<CollapsibleTrigger\b[\s\S]*?asChild[\s\S]*?<button\b[\s\S]*?type="button"/,
  'Other details collapsible trigger must be a non-submit button inside the add transaction form',
);

expectMatchCount(
  "components/CategoryComboBoxForm.tsx",
  /<Button\b(?=[^>]*type="button")(?=[^>]*variant="input")[^>]*>/g,
  2,
  'CategoryComboBoxForm triggers must be type="button" because it is used inside transaction forms',
);

expectPattern(
  "components/ui/combobox-virtualized.tsx",
  /<Button\b(?=[^>]*type="button")(?=[^>]*variant="input")(?=[^>]*role="combobox")[^>]*>/,
  'VirtualizedCombobox trigger must be type="button" so selecting a financial institution never submits or resets parent forms',
);

expectPattern(
  "components/account/AccountTransactionImportModal.tsx",
  /toast\.error\(t\("toast-import-transactions-error-no-file"\)/,
  "Account import should show the specific no-file validation message",
);

expectPattern(
  "components/portfolio/PortfolioTransactionImportModal.tsx",
  /toast\.error\(t\("toast-import-transactions-error-no-file"\)/,
  "Portfolio import should show the specific no-file validation message",
);

// RAD-95's import-session rewrite inlined the named onSubmit/onInvalidSubmit
// handlers into methods.handleSubmit(successFn, invalidFn) directly; the
// invalid-submit branch still explicitly re-checks for a missing file so the
// no-file toast fires even when other required fields also fail validation.
expectPattern(
  "components/portfolio/PortfolioTransactionImportModal.tsx",
  /methods\.handleSubmit\(\s*async[\s\S]*?\},\s*\(\)\s*=>\s*\{\s*if\s*\(!methods\.getValues\("portfoliocsv"\)\?\.\[0\]\)\s*\{\s*showNoFileError\(\);/,
  "Portfolio import should show no-file feedback even when other required fields are invalid",
);

// RAD-630: a manual account has no type field (checking/savings/credit
// card/loan), so a negative balance is the only way to represent debt at
// all — the schema intentionally allows it (only zero/non-finite/absurdly
// large values are rejected) rather than requiring `.positive()`.
expectPattern(
  "components/account/AccountCreateOfflineModal.tsx",
  /name:\s*z\.string\(\)\.min\(1[\s\S]*?currentBalance:\s*zLocaleNumber\.pipe\([\s\S]*?z\s*[\s\S]*?\.number\(\)[\s\S]*?\.refine\(\s*\(value\)\s*=>\s*value\s*!==\s*0/,
  "Offline account creation must validate required name and a non-zero balance (negative allowed, for debt) before mutation",
);

expectPattern(
  "components/account/AccountCreateOfflineModal.tsx",
  /onSuccess:\s*async\s*\(\)\s*=>\s*{[\s\S]*?completeOfflineAccountCreation\(/,
  "Offline account creation should delegate its success-only completion sequence",
);
expectPattern(
  "lib/account/offline-account-success.ts",
  /safePostHogCapture\([\s\S]*?await invalidateAccounts\(\)[\s\S]*?closeModal\(\)[\s\S]*?resetForm\(\)[\s\S]*?await onSuccess\?\.\(\)/,
  "Offline account creation should refetch, close, reset, and invoke onSuccess even if analytics throws",
);

expectNoPattern(
  "components/account/AccountCreateOfflineModal.tsx",
  /onError:\s*[^}]*closeModal\(|onError:\s*[^}]*reset\(/,
  "Offline account creation failures must keep the dialog open and preserve form values",
);

expectPattern(
  "components/account/AccountTransactionAddModal.tsx",
  /onSuccess:\s*async\s*\(\)\s*=>\s*{[\s\S]*?invalidateAccounts\(queryClient\)[\s\S]*?setOpen\(false\)/,
  "Add transaction should close only after successful mutation and account cache invalidation",
);

expectNoPattern(
  "components/account/AccountTransactionAddModal.tsx",
  /onError:\s*[^}]*setOpen\(false\)|onError:\s*[^}]*setCurrentStep\(TransactionAddStep\.MANUAL\)/,
  "Add transaction failures must keep the dialog open and preserve the active form step",
);

expectNoPattern(
  "components/account/AccountTransactionAddForm.tsx",
  /message:\s*"(?:Both original amount and currency must be provided together|Either transaction merchant or name must be provided)"/,
  "Add transaction validation copy must use translation keys instead of hardcoded English",
);

expectPattern(
  "components/account/AccountTransactionAddForm.tsx",
  /transactionMerchantName:\s*z\.string\(\)\.trim\(\)/,
  "Add transaction form must trim newly-created merchant names before submission",
);

expectPattern(
  "components/account/AccountTransactionAddForm.tsx",
  /createLabel=\{\(value\)\s*=>\s*t\("create-merchant"[\s\S]*?merchant:\s*value[\s\S]*?\)\}/,
  "Merchant select create action must use explicit translated copy including the merchant name",
);

expectPattern(
  "components/account/AccountTransactionAddForm.tsx",
  /createEmptyHint=\{t\("type-merchant-name-to-create"\)\}/,
  "Merchant select must explain that users need to type a merchant name before creating one",
);

expectNoPattern(
  "components/account/AccountTransactionOcrContent.tsx",
  /(?:File is required|You must accept the terms and conditions)/,
  "OCR transaction validation copy must use translation keys instead of hardcoded English",
);

expectPattern(
  "components/account/AccountTransactionImportModal.tsx",
  /setError\(\s*"files"[\s\S]*?toast-import-transactions-error-no-file/,
  "Account transaction import must show nearby file validation when no file is selected",
);

const accountImportSource = read(
  "components/account/AccountTransactionImportModal.tsx",
);
const accountImportCreateUrlOnErrorBlock = accountImportSource.match(
  /onError:\s*\(\)\s*=>\s*{([\s\S]*?)\n\s*},\n\s*},\n\s*\);/,
)?.[1];
if (
  accountImportCreateUrlOnErrorBlock &&
  /reset\(\)|setFiles\(\[\]\)/.test(accountImportCreateUrlOnErrorBlock)
) {
  fail(
    "components/account/AccountTransactionImportModal.tsx: Account transaction import API failures must preserve selected account and file so the user can retry",
  );
}

if (failures.length > 0) {
  console.error("Transaction form submit-safety regression checks failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Transaction form submit-safety regression checks passed");
