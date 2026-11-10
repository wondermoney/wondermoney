// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import {
  instanceFeatures,
  queryClientWithInstance,
} from "@/lib/api/instance/instance-fixture";

import enCommandPalette from "../../messages/en/command-palette.json";
import enCommon from "../../messages/en/common.json";
import enNavigation from "../../messages/en/navigation.json";
import esCommandPalette from "../../messages/es/command-palette.json";
import esCommon from "../../messages/es/common.json";
import esNavigation from "../../messages/es/navigation.json";
import ptCommandPalette from "../../messages/pt/command-palette.json";
import ptCommon from "../../messages/pt/common.json";
import ptNavigation from "../../messages/pt/navigation.json";
import TopBar from "./TopBar";

const route = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ reset: () => {} }),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signOut: async () => {} },
}));
vi.mock("@/lib/auth/user-context", () => ({
  useUser: () => ({
    id: "u1",
    email: "person@example.com",
    email_confirmed_at: null,
  }),
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
  { locale: "en", messages: { ...enCommon, ...enNavigation, ...enCommandPalette } },
  { locale: "pt", messages: { ...ptCommon, ...ptNavigation, ...ptCommandPalette } },
  { locale: "es", messages: { ...esCommon, ...esNavigation, ...esCommandPalette } },
] as const;

function renderTopBar(
  client: QueryClient = queryClientWithInstance(),
  locale = 0,
) {
  const { locale: code, messages } = locales[locale];
  const onError = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={code}
        messages={messages}
        onError={onError}
      >
        <TopBar />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onError };
}

const nav = enNavigation.navigation;

locales.forEach(({ locale }, index) => {
  test(`the mobile bar's section tabs have translated labels (${locale})`, () => {
    route.pathname = "/accounts/transactions";
    const { onError } = renderTopBar(queryClientWithInstance(), index);
    const header = screen.getByRole("banner");

    assert.doesNotMatch(
      header.textContent ?? "",
      /navigation\.[a-z-]+|top-bar\./,
    );
    assert.equal(
      onError.mock.calls.length,
      0,
      String(onError.mock.calls[0]?.[0]),
    );
  });
});

test("inside Accounts, its pages appear as tabs with Bills & subscriptions among them", () => {
  route.pathname = "/accounts/recurring";
  renderTopBar();
  const tabs = screen.getByRole("navigation", { name: nav.accounts });

  const bills = within(tabs).getByRole("link", {
    name: nav["bills-subscriptions"],
  });
  assert.equal(bills.getAttribute("href"), "/accounts/recurring");
  assert.equal(bills.getAttribute("aria-current"), "page");
  assert.equal(
    within(tabs)
      .getByRole("link", { name: nav.overview })
      .getAttribute("aria-current"),
    null,
  );
});

test("a page outside any section shows no tab row", () => {
  route.pathname = "/loans";
  renderTopBar();

  assert.equal(screen.queryByRole("navigation", { name: nav.accounts }), null);
  assert.equal(screen.queryByRole("navigation", { name: nav.portfolio }), null);
});
