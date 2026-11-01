// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import { instanceFeatures, queryClientWithInstance } from "@/lib/api/instance/instance-fixture";

import enCommon from "../../../../messages/en/common.json";
import enNavigation from "../../../../messages/en/navigation.json";
import SettingsPage from "./page";

const { searchParams } = vi.hoisted(() => ({ searchParams: { current: new URLSearchParams() } }));

vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams.current }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: () => {} }),
}));
// Tab bodies are beside the point here; each one is a lazily loaded settings
// panel with its own data hooks.
vi.mock("next/dynamic", () => ({ default: () => () => <p>tab body</p> }));
vi.mock("@/components/settings/Profile", () => ({ default: () => <p>profile body</p> }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const nav = enNavigation.navigation;

function renderSettings(features = instanceFeatures(), tab?: string) {
  searchParams.current = new URLSearchParams(tab ? { tab } : {});
  render(
    <QueryClientProvider client={queryClientWithInstance(features)}>
      <NextIntlClientProvider locale="en" messages={{ ...enCommon, ...enNavigation }}>
        <SettingsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const withoutAssistant = () =>
  instanceFeatures({ ai: { ...instanceFeatures().ai, assistant: false } });

test("a server with an assistant model shows the Assistant settings tab", () => {
  renderSettings();

  screen.getByRole("tab", { name: nav.assistant });
});

test("a server without an assistant model has no Assistant settings tab", () => {
  renderSettings(withoutAssistant());

  assert.equal(screen.queryByRole("tab", { name: nav.assistant }), null);
  screen.getByRole("tab", { name: nav.appearance });
});

test("a link to the Assistant tab on such a server opens Profile instead", () => {
  renderSettings(withoutAssistant(), "assistant");

  const selected = screen.getByRole("tab", { selected: true });
  assert.equal(selected.textContent, nav.profile);
  screen.getByText("profile body");
});
