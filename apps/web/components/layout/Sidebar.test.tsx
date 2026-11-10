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
    name: "Person Example",
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
  { locale: "en", messages: { ...enCommon, ...enNavigation } },
  { locale: "pt", messages: { ...ptCommon, ...ptNavigation } },
  { locale: "es", messages: { ...esCommon, ...esNavigation } },
] as const;

function renderSidebar(
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
        <Sidebar />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  const main = screen.getByRole("navigation", {
    name: enNavigationLabel(locale),
  });
  return { main, onError };
}

function enNavigationLabel(locale: number) {
  return locales[locale].messages.navigation["sidebar-nav"];
}

const nav = enNavigation.navigation;

locales.forEach(({ locale }, index) => {
  test(`every sidebar destination and group has a translated label (${locale})`, () => {
    route.pathname = "/accounts/transactions";
    const { onError } = renderSidebar(queryClientWithInstance(), index);
    const rail = screen.getByRole("complementary");

    // A missing key renders as its own path, e.g. "navigation.credits".
    assert.doesNotMatch(rail.textContent ?? "", /navigation\.[a-z-]+/);
    assert.equal(
      onError.mock.calls.length,
      0,
      String(onError.mock.calls[0]?.[0]),
    );
  });
});

test("an ordinary account reaches Loans, Goals and Financial Markets from the sidebar", () => {
  const { main } = renderSidebar();

  assert.equal(
    within(main).getByRole("link", { name: nav.loans }).getAttribute("href"),
    "/loans",
  );
  assert.equal(
    within(main).getByRole("link", { name: nav.goals }).getAttribute("href"),
    "/goals",
  );
  assert.equal(
    within(main)
      .getByRole("link", { name: nav["financial-markets"] })
      .getAttribute("href"),
    "/financial-markets",
  );
});

test("the destinations sit in the day-to-day, investments and planning groups", () => {
  const { main } = renderSidebar();

  const dayToDay = within(main).getByRole("list", {
    name: nav["group-day-to-day"],
  });
  within(dayToDay).getByRole("link", { name: nav.accounts });
  within(dayToDay).getByRole("link", { name: nav.loans });
  within(dayToDay).getByRole("link", { name: nav.budgets });
  const investments = within(main).getByRole("list", {
    name: nav["group-investments"],
  });
  within(investments).getByRole("link", { name: nav.portfolio });
  const planning = within(main).getByRole("list", {
    name: nav["group-planning"],
  });
  within(planning).getByRole("link", { name: nav.goals });
  within(planning).getByRole("link", { name: nav.reports });
});

test("a server without market data drops Financial Markets and nothing else", () => {
  const { main } = renderSidebar(
    queryClientWithInstance(instanceFeatures({ marketData: false })),
  );

  assert.equal(
    within(main).queryByRole("link", { name: nav["financial-markets"] }),
    null,
  );
  within(main).getByRole("link", { name: nav.loans });
  within(main).getByRole("link", { name: nav.goals });
});

test("the sidebar marks the destination you are in, and Home only on the home page", () => {
  route.pathname = "/budgets/1/2026/11";
  const { main } = renderSidebar();

  assert.equal(
    within(main)
      .getByRole("link", { name: nav.budgets })
      .getAttribute("aria-current"),
    "page",
  );
  assert.equal(
    within(main)
      .getByRole("link", { name: nav.home })
      .getAttribute("aria-current"),
    null,
  );
});

test("inside Accounts, its pages are listed under it with the current one marked", () => {
  route.pathname = "/accounts/recurring";
  const { main } = renderSidebar();
  const pages = within(main).getByRole("list", { name: nav.accounts });

  const bills = within(pages).getByRole("link", {
    name: nav["bills-subscriptions"],
  });
  assert.equal(bills.getAttribute("href"), "/accounts/recurring");
  assert.equal(bills.getAttribute("aria-current"), "page");
  assert.equal(
    within(pages)
      .getByRole("link", { name: nav.overview })
      .getAttribute("aria-current"),
    null,
  );
});

test("outside a section, its pages stay folded away", () => {
  route.pathname = "/loans";
  const { main } = renderSidebar();

  assert.equal(within(main).queryByRole("list", { name: nav.accounts }), null);
  assert.equal(within(main).queryByRole("list", { name: nav.portfolio }), null);
});

test("Settings and the person's menu sit at the foot, under their name", () => {
  route.pathname = "/settings/profile";
  renderSidebar();
  const rail = screen.getByRole("complementary");

  assert.equal(
    within(rail)
      .getByRole("link", { name: enCommon.settings })
      .getAttribute("aria-current"),
    "page",
  );
  const menu = within(rail).getByRole("button", {
    name: enCommon["open-user-menu"],
  });
  assert.match(menu.textContent ?? "", /Person Example/);
});
