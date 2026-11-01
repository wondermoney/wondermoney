// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import { instanceFeatures, queryClientWithInstance } from "@/lib/api/instance/instance-fixture";

import enCommon from "../../messages/en/common.json";
import enNavigation from "../../messages/en/navigation.json";
import esCommon from "../../messages/es/common.json";
import esNavigation from "../../messages/es/navigation.json";
import ptCommon from "../../messages/pt/common.json";
import ptNavigation from "../../messages/pt/navigation.json";
import Sidebar from "./Sidebar";

const route = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => route.pathname,
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
beforeEach(() => {
  route.pathname = "/";
});
afterEach(cleanup);

const locales = [
  { locale: "en", messages: { ...enCommon, ...enNavigation } },
  { locale: "pt", messages: { ...ptCommon, ...ptNavigation } },
  { locale: "es", messages: { ...esCommon, ...esNavigation } },
] as const;

function renderSidebar(client: QueryClient = queryClientWithInstance(), locale = 0) {
  const { locale: code, messages } = locales[locale];
  const onError = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={code} messages={messages} onError={onError}>
        <Sidebar />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { nav: screen.getByRole("navigation"), onError };
}

const nav = enNavigation.navigation;

locales.forEach(({ locale }, index) => {
  test(`every sidebar entry has a translated label (${locale})`, () => {
    const { nav: rail, onError } = renderSidebar(queryClientWithInstance(), index);

    // A missing key renders as its own path, e.g. "navigation.credits".
    assert.doesNotMatch(rail.textContent ?? "", /navigation\.[a-z-]+/);
    assert.equal(onError.mock.calls.length, 0, String(onError.mock.calls[0]?.[0]));
  });
});

test("an ordinary account sees Loans, Goals and Financial Markets in the rail", () => {
  const { nav: rail } = renderSidebar();

  assert.equal(within(rail).getByRole("link", { name: nav.loans }).getAttribute("href"), "/loans");
  assert.equal(within(rail).getByRole("link", { name: nav.goals }).getAttribute("href"), "/goals");
  within(rail).getByRole("button", { name: nav["financial-markets"] });
});

test("an ordinary account sees Bills & subscriptions under Accounts", () => {
  route.pathname = "/accounts/recurring";
  const { nav: rail } = renderSidebar();

  const bills = within(rail).getByRole("link", { name: nav["bills-subscriptions"] });
  assert.equal(bills.getAttribute("href"), "/accounts/recurring");
});

test("a server without market data drops Financial Markets and nothing else", () => {
  const { nav: rail } = renderSidebar(queryClientWithInstance(instanceFeatures({ marketData: false })));

  assert.equal(within(rail).queryByRole("button", { name: nav["financial-markets"] }), null);
  within(rail).getByRole("link", { name: nav.loans });
  within(rail).getByRole("link", { name: nav.goals });
});

test("the rail has no admin visibility control", () => {
  const { nav: rail } = renderSidebar();

  assert.equal(within(rail).queryByRole("button", { name: /admin/i }), null);
});
