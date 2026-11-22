// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import FeatureScreenView from "./FeatureScreenView";

const h = vi.hoisted(() => ({
  consent: "granted" as string,
  enabled: true,
  pathname: "/accounts/123/transactions",
  track: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({ usePathname: () => h.pathname }));
vi.mock("@/lib/analytics/consent", () => ({ useAnalyticsConsent: () => h.consent }));
vi.mock("@/lib/utils/analytics-enabled", () => ({ isAnalyticsEnabled: () => h.enabled }));
vi.mock("@/lib/analytics/track", () => ({ track: h.track }));

beforeEach(() => {
  h.consent = "granted";
  h.enabled = true;
  h.pathname = "/accounts/123/transactions";
  h.track.mockReset();
});
afterEach(cleanup);

it("names the screen on each navigation, never the path", () => {
  const { rerender } = render(<FeatureScreenView />);
  h.pathname = "/budgets";
  rerender(<FeatureScreenView />);

  expect(h.track.mock.calls).toEqual([
    ["feature_screen_viewed", { screen: "account_transactions" }],
    ["feature_screen_viewed", { screen: "budgets" }],
  ]);
});

it("sends nothing for a route that is not counted", () => {
  h.pathname = "/admin/bank-sync";
  render(<FeatureScreenView />);
  expect(h.track).not.toHaveBeenCalled();
});

it.each([
  ["without consent", () => (h.consent = "denied")],
  ["without analytics configured", () => (h.enabled = false)],
])("sends nothing %s", (_case, given) => {
  given();
  render(<FeatureScreenView />);
  expect(h.track).not.toHaveBeenCalled();
});
