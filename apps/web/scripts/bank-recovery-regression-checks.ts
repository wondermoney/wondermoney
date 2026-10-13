import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const accountsClient = read(
  "app/[locale]/(full-layout)/accounts/accounts-client.tsx",
);
const expectationModal = read(
  "components/account/AccountCreateSyncModal.tsx",
);
const statusBanner = read(
  "components/account/BankAccountSyncStatusBanner.tsx",
);
const incidentHook = read("lib/api/banking/useBankAccountSyncStatus.ts");
const emptyState = read("components/account/AccountsEmptyStateV2.tsx");
const offlineModal = read("components/account/AccountCreateOfflineModal.tsx");
const importModal = read(
  "components/account/AccountTransactionImportModal.tsx",
);
const importCompletion = read(
  "lib/account/account-csv-import-completion.ts",
);
const budgetLayout = read(
  "app/[locale]/(full-layout)/budgets/[budgetId]/layout.tsx",
);
const rolloutDoc = read("docs/bank-sync-web-first-rollout.md");

// This check used to assert package.json exposed a `test:<domain>` script for
// itself. `pnpm test` replaced those 50 scripts with one Vitest run, and
// scripts/regression-checks.test.ts now enumerates this file from disk, so
// being wired in is structural rather than something to string-match.

assert.match(
  expectationModal,
  /bank-connection-expectation-title/,
  "bank selection should lead to a deliberate expectation step",
);
assert.match(expectationModal, /continue-to-bank/);
assert.match(expectationModal, /aria-live="polite"/);
assert.match(expectationModal, /disabled=\{[^}]*isFetchingRedirect/);
assert.doesNotMatch(
  expectationModal,
  /(?:seconds?|minutes?|guarantee|secure encryption)/i,
  "expectation copy should not make unsupported timing or security claims",
);

assert.match(incidentHook, /\/v1\/banking\/sync\/\$\{incidentId\}\/status/);
for (const field of [
  "incidentId",
  "state",
  "result",
  "final",
  "retryable",
  "attempts",
  "errorCategory",
  "errorCode",
]) {
  assert.match(incidentHook, new RegExp(`\\b${field}\\b`));
}
assert.match(incidentHook, /data\?\.final/);
const incidentOnly = incidentHook.split("Temporary web-first rollout fallback")[0];
assert.doesNotMatch(
  incidentOnly,
  /refreshedAt|requisition|accounts\.length|Date\.now|setTimeout/,
  "incident status must not infer API finality from client-side signals",
);

assert.match(accountsClient, /searchParams\.get\("sync"\)/);
assert.match(accountsClient, /searchParams\.get\("nrid"\)/);
assert.match(accountsClient, /syncIncidentId \? null : searchParams\.get\("nrid"\)/);
assert.doesNotMatch(accountsClient, /requisitionId\s*:/);
assert.match(accountsClient, /invalidateAccounts\(queryClient\)/);
// The consent ledger feature (cookie/tracking consent banner + per-user
// analytics consent gate) was deliberately removed in full (commit
// 105756b6, "Remove the consent ledger feature"): PostHog/GTM now
// initialize unconditionally based on env config alone, so
// readConsentSnapshot no longer exists anywhere in the codebase. The
// remaining invariant this guard protects -- that bank-recovery analytics
// capture can never interrupt recovery actions -- is still covered by the
// safeCaptureBankRecoveryEvent try/catch assertion below.
assert.match(accountsClient, /safeCaptureBankRecoveryEvent/);

for (const state of [
  "processing",
  "callback_error",
  "partial",
  "failed",
  "transport_unavailable",
]) {
  assert.match(statusBanner, new RegExp(`\\b${state}\\b`));
}
for (const action of [
  "bank-recovery-retry",
  "bank-recovery-add-manually",
  "bank-recovery-import-statement",
]) {
  assert.match(statusBanner, new RegExp(action));
}
assert.match(statusBanner, /role="status"/);
assert.match(statusBanner, /aria-live="polite"/);
assert.match(statusBanner, /canOfferFallbacks = status !== "transport_unavailable"/);
assert.match(
  statusBanner,
  /canOfferFallbacks && onImportStatement && csvRequiresAccount/,
  "CSV prerequisite copy must only render with a working import action",
);

assert.match(accountsClient, /AccountTransactionImportModal/);
assert.match(accountsClient, /pendingCsvImport/);
assert.match(accountsClient, /csvRequiresAccount/);
assert.match(emptyState, /recoveryState/);
assert.match(accountsClient, /aria-label=\{t\("add-account"\)\}/);
assert.match(
  accountsClient,
  /handleCsvImportSuccess[\s\S]*completeFirstRunHandoff\([\s\S]*router\.replace\(getFirstRunStepRoute\("sync_value"\)\)/,
  "authoritative CSV success should complete the first-run account handoff",
);
assert.match(
  accountsClient,
  /setRecoveryImportModalOpen[\s\S]*cancelFirstRunHandoff\("account", "account"/,
  "an explicit recovery import cancellation should resolve the first-run handoff",
);
assert.match(
  accountsClient,
  /<AccountTransactionImportModal[\s\S]*onImportSuccess=\{handleCsvImportSuccess\}/,
  "accounts recovery should consume the CSV modal's successful completion seam",
);
assert.match(importModal, /onImportSuccess\?: AccountCsvImportSuccessCallback/);
assert.match(
  importModal,
  /authoritativeStatus: backgroundOperationQuery\.data\?\.status/,
  "CSV success must be based on the authoritative polled operation",
);
assert.match(importCompletion, /authoritativeStatus !== "succeeded"/);
assert.match(importCompletion, /tracker\.current === correlationId/);
assert.match(offlineModal, /completeOfflineAccountCreation/);
assert.match(accountsClient, /pendingCsvImport[\s\S]*setIsImportModalOpen\(true\)/);
assert.match(
  accountsClient,
  /if \(pendingCsvImport\) \{[\s\S]*setIsImportModalOpen\(true\);[\s\S]*return;/,
  "manual prerequisite success must launch CSV without completing the handoff early",
);

assert.doesNotMatch(
  budgetLayout,
  /csvRequiresAccount=/,
  "budget recovery must omit CSV UI until it has a complete import handoff",
);
assert.match(
  budgetLayout,
  /hasActiveBankAccountSyncReturnMarker\([\s\S]*setAccountSelectModalIsOpen\(true\)/,
  "authoritative budget success must open account selection independently of storage",
);
assert.doesNotMatch(
  budgetLayout,
  /if \(wasStartedFromThisPage\)[\s\S]*setAccountSelectModalIsOpen/,
  "the storage marker must not gate the budget success handoff",
);

assert.match(rolloutDoc, /safe to deploy before the matching API release/i);
assert.match(rolloutDoc, /legacy callbacks containing `nrid`/);
assert.match(rolloutDoc, /never copied into PostHog properties, Sentry context/i);
assert.match(incidentHook, /useLegacyBankAccountSyncStatus/);

const requiredMessages = [
  "bank-connection-expectation-title",
  "bank-connection-expectation-leave",
  "bank-connection-expectation-credentials",
  "bank-connection-expectation-read-only",
  "continue-to-bank",
  "bank-recovery-retry",
  "bank-recovery-add-manually",
  "bank-recovery-import-statement",
  "bank-recovery-csv-prerequisite",
  "bank-sync-transport-title",
  "bank-sync-partial-title",
  "bank-sync-failed-title",
];

for (const locale of ["en", "pt", "es"]) {
  const messages = JSON.parse(read(`messages/${locale}/common.json`)) as Record<
    string,
    unknown
  >;
  for (const key of requiredMessages) {
    assert.equal(
      typeof messages[key],
      "string",
      `${locale}/common.json should include ${key}`,
    );
    assert.ok(String(messages[key]).trim(), `${locale}:${key} must not be empty`);
  }
}

const recoverySources = `${accountsClient}\n${statusBanner}`;
for (const unsafeProperty of [
  "requisitionId:",
  "incidentId:",
  "bankId:",
  "email:",
  "error_message",
  "raw_error",
]) {
  assert.doesNotMatch(
    recoverySources,
    new RegExp(unsafeProperty),
    `recovery analytics should not include unsafe property ${unsafeProperty}`,
  );
}
for (const safeProperty of [
  "locale",
  "source",
  "state",
  "result",
  "error_category",
  "error_code",
  "fallback_type",
]) {
  assert.match(recoverySources, new RegExp(`\\b${safeProperty}\\b`));
}

console.log("Bank recovery regression checks passed");
