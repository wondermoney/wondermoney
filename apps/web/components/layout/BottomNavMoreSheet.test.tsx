// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, test, vi } from "vitest";

import { instanceFeatures, queryClientWithInstance } from "@/lib/api/instance/instance-fixture";

import enCommon from "../../messages/en/common.json";
import enNavigation from "../../messages/en/navigation.json";
import BottomNavMoreSheet from "./BottomNavMoreSheet";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ reset: () => {} }) }));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut: async () => {} } }));
// An ordinary account: not on any staff domain, email unconfirmed.
vi.mock("@/lib/auth/user-context", () => ({
  useUser: () => ({ id: "u1", email: "person@example.com", email_confirmed_at: null }),
}));

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const nav = enNavigation.navigation;

function renderSheet(features = instanceFeatures()) {
  render(
    <QueryClientProvider client={queryClientWithInstance(features)}>
      <NextIntlClientProvider locale="en" messages={{ ...enCommon, ...enNavigation }}>
        <BottomNavMoreSheet open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return screen.getByTestId("more-sheet");
}

test("an ordinary account sees Loans, Goals, Financial Markets and Bills & subscriptions", () => {
  const sheet = renderSheet();

  for (const [name, href] of [
    [nav.loans, "/loans"],
    [nav.goals, "/goals"],
    [nav["financial-markets"], "/financial-markets"],
    [nav["bills-subscriptions"], "/accounts/recurring"],
  ]) {
    assert.equal(within(sheet).getByRole("link", { name }).getAttribute("href"), href);
  }
});

test("a server without market data drops Financial Markets from the sheet", () => {
  const sheet = renderSheet(instanceFeatures({ marketData: false }));

  assert.equal(within(sheet).queryByRole("link", { name: nav["financial-markets"] }), null);
  within(sheet).getByRole("link", { name: nav.loans });
});
