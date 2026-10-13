import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function startsWithUseClient(source: string) {
  return /^\s*["']use client["'];/.test(source);
}

const fullLayoutPath = "app/[locale]/(full-layout)/layout.tsx";
const clientChromePath = "app/[locale]/(full-layout)/FullLayoutClientChrome.tsx";
const clientOverlaysPath = "app/[locale]/(full-layout)/FullLayoutClientOverlays.tsx";
const fullLayout = read(fullLayoutPath);
const wrapper = read("components/layout/Wrapper.tsx");
const container = read("components/layout/Container.tsx");
const assistantLauncher = read("components/assistant/AssistantLauncher.tsx");
const subscriptionEntitlementGate = read(
  "components/subscription/SubscriptionEntitlementGate.tsx",
);

// This check used to assert package.json exposed a `test:<domain>` script for
// itself. `pnpm test` replaced those 50 scripts with one Vitest run, and
// scripts/regression-checks.test.ts now enumerates this file from disk, so
// being wired in is structural rather than something to string-match.

assert.equal(
  startsWithUseClient(fullLayout),
  false,
  "full-layout route layout should be a server component",
);

assert.doesNotMatch(
  fullLayout,
  /useEffect|useState|differenceInDays|useConfigs|useSubscription|useUser|AssistantLauncher|TrialEndingModal|TrialEndedModal|delay/,
  "full-layout server layout should not import client hooks, data hooks, assistant, or trial modal behavior",
);

assert.equal(
  startsWithUseClient(wrapper),
  false,
  "Wrapper should be server-compatible and should not declare use client",
);

assert.equal(
  startsWithUseClient(container),
  false,
  "Container should be server-compatible and should not declare use client",
);

assert.equal(
  existsSync(clientChromePath),
  true,
  "FullLayoutClientChrome navigation client island should exist",
);

const clientChrome = read(clientChromePath);

assert.equal(
  startsWithUseClient(clientChrome),
  true,
  "FullLayoutClientChrome should be an explicit client island",
);

assert.match(
  clientChrome,
  /<Sidebar\s*\/?>[\s\S]*<BottomNav\s*\/?>/,
  "FullLayoutClientChrome should render the navigation chrome",
);

assert.doesNotMatch(
  clientChrome,
  /AssistantLauncher|TrialEndingModal|TrialEndedModal|useSubscription/,
  "FullLayoutClientChrome should not own floating assistant or subscription modal behavior",
);

assert.match(
  clientChrome,
  /useConfigs\(\)/,
  "FullLayoutClientChrome should preserve global config prefetch behavior",
);

assert.equal(
  existsSync(clientOverlaysPath),
  true,
  "FullLayoutClientOverlays client island should exist for floating UI after page content",
);

const clientOverlays = read(clientOverlaysPath);

assert.equal(
  startsWithUseClient(clientOverlays),
  true,
  "FullLayoutClientOverlays should be an explicit client island",
);

assert.match(
  fullLayout,
  /<FullLayoutClientChrome\s*\/?>[\s\S]*<Container>\{children\}<\/Container>[\s\S]*<FullLayoutClientOverlays\s*\/?>/,
  "full-layout source order should keep floating overlays after page content",
);

assert.match(
  clientOverlays,
  /from "next\/dynamic"/,
  "FullLayoutClientOverlays should dynamically load optional global UI",
);

assert.doesNotMatch(
  clientOverlays,
  /import\s+AssistantLauncher\s+from|import\s+TrialEndingModal\s+from|import\s+TrialEndedModal\s+from/,
  "Assistant and trial modal components should not be statically imported into overlays",
);

// Subscription/trial reminder behavior moved out of the overlays island and
// into a dedicated root-level entitlement gate (see "feat: add paid trial
// recovery UX"), which now wraps the whole full-layout route instead of
// showing delayed trial modals from within the overlays island.
assert.match(
  subscriptionEntitlementGate,
  /useSubscription\(\s*user\?\.id/,
  "SubscriptionEntitlementGate should preserve subscription reminder behavior",
);

assert.match(
  fullLayout,
  /<SubscriptionEntitlementGate>[\s\S]*<\/SubscriptionEntitlementGate>/,
  "full-layout should wrap the route in the subscription entitlement gate",
);

// The assistant used to be visible only to @wonder.money addresses, via a
// localStorage "admin module visibility" switch. Every module is now available
// to everyone, so these assert the gate stays gone rather than that it works.
assert.equal(
  existsSync("lib/admin"),
  false,
  "the admin module-visibility gate should stay deleted — modules are available to everyone",
);

assert.doesNotMatch(
  clientOverlays,
  /isModuleVisible|useAdminModuleVisibility/,
  "FullLayoutClientOverlays should render AssistantLauncher unconditionally",
);

assert.match(
  clientOverlays,
  /<AssistantLauncher\s*\/>/,
  "FullLayoutClientOverlays should still mount the assistant launcher",
);

assert.doesNotMatch(
  assistantLauncher,
  /import\s+AssistantPanel\s+from/,
  "AssistantLauncher should not statically import the heavy assistant panel/chat stack",
);

assert.match(
  assistantLauncher,
  /from "next\/dynamic"/,
  "AssistantLauncher should dynamically load the assistant panel only when opened",
);

console.log("Full-layout DX regression checks passed");
