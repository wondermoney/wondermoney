import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const account = read("components/onboarding/first-run/FirstRunAccountStep.tsx");
const sync = read("components/onboarding/first-run/FirstRunSyncStep.tsx");

assert(account.includes("useBankList"), "account step must list banks inline via useBankList");
assert(account.includes("useCreateRequisition"), "account step must create a requisition inline");
assert(
  account.includes("buildOnboardingConnectRedirectPage"),
  "account step must build a locale-prefixed redirectPage",
);
assert(
  !account.includes("/accounts?add=true"),
  "account step must NOT hand off to /accounts anymore",
);
assert(account.includes("useCreateOfflineAccount"), "manual path must create an offline account inline");

assert(sync.includes("resolveConnectReturn"), "sync step must resolve GoCardless return params");
assert(sync.includes("useBankAccountSyncStatus"), "sync step must poll the sync incident");
assert(
  sync.includes('getFirstRunStepRoute("account")'),
  "sync step must bounce not-linked errors back to the account step",
);

for (const locale of ["en", "pt", "es"]) {
  const json = JSON.parse(read(`messages/${locale}/onboarding.json`)) as {
    onboarding: { firstRun: { connect?: Record<string, unknown> } };
  };
  const connect = json.onboarding.firstRun.connect;
  assert(connect, `${locale}: missing onboarding.firstRun.connect block`);
  for (const key of ["handoffTitle", "connectErrorBanner", "manualSubmit", "syncing"]) {
    assert(key in connect!, `${locale}: connect.${key} missing`);
  }
}

console.log("onboarding-inline-connect regression checks passed");
