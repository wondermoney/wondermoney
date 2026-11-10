// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import type { BankingAlert } from "@/lib/api/banking/useBankingAlerts";

import homeMessages from "../../messages/en/home.json";
import { BANK_ALERTS_DISMISSED_KEY } from "./bank-alerts";
import { BankAlertsBanner } from "./BankAlertsBanner";

const state = vi.hoisted(() => ({
  query: { data: undefined } as { data?: { alerts: BankingAlert[] } },
}));

vi.mock("@/lib/api/banking/useBankingAlerts", () => ({
  default: () => state.query,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: unknown }) => (
    <a href={href} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

const alert = (overrides: Partial<BankingAlert> & Pick<BankingAlert, "id" | "kind">): BankingAlert => ({
  institutionName: "Millennium BCP",
  bankId: "BCP",
  expiresAt: null,
  daysUntilExpiry: null,
  failingSince: null,
  ...overrides,
});

function renderBanner() {
  return render(
    <NextIntlClientProvider locale="en" messages={homeMessages}>
      <BankAlertsBanner />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
});
afterEach(() => {
  cleanup();
  state.query = { data: undefined };
});

test("renders nothing while loading or with no alerts", () => {
  renderBanner();
  assert.equal(screen.queryByRole("status"), null);

  cleanup();
  state.query = { data: { alerts: [] } };
  renderBanner();
  assert.equal(screen.queryByRole("status"), null);
});

test("names the bank and the days left, counts the rest, and links to connections", () => {
  state.query = {
    data: {
      alerts: [
        alert({ id: "sync", kind: "sync_failing", institutionName: "CGD", failingSince: "2026-11-01T12:00:00Z" }),
        alert({ id: "exp", kind: "consent_expiring", daysUntilExpiry: 1 }),
      ],
    },
  };
  renderBanner();

  const banner = screen.getByRole("status", { name: "Bank connection alerts" });
  assert.match(banner.textContent ?? "", /Access to Millennium BCP ends in 1 day\./);
  assert.match(banner.textContent ?? "", /And 1 more connection needs attention\./);
  assert.equal(
    screen.getByRole("link", { name: "Reconnect" }).getAttribute("href"),
    "/settings?tab=connections",
  );
});

test("dismissing hides the banner and stores the ids; a new episode id shows again", async () => {
  state.query = { data: { alerts: [alert({ id: "exp-7", kind: "consent_expiring", daysUntilExpiry: 7 })] } };
  renderBanner();

  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

  assert.equal(screen.queryByRole("status"), null);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(BANK_ALERTS_DISMISSED_KEY) ?? "null"), ["exp-7"]);

  cleanup();
  renderBanner();
  assert.equal(screen.queryByRole("status"), null);

  cleanup();
  state.query = { data: { alerts: [alert({ id: "exp-1", kind: "consent_expiring", daysUntilExpiry: 1 })] } };
  renderBanner();
  assert.match(screen.getByRole("status").textContent ?? "", /ends in 1 day/);
});

test("still renders and dismisses when storage is blocked", async () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: blocked });
  state.query = { data: { alerts: [alert({ id: "rev", kind: "consent_revoked", institutionName: null })] } };
  renderBanner();

  assert.match(screen.getByRole("status").textContent ?? "", /Your bank ended access to your accounts\./);
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  assert.equal(screen.queryByRole("status"), null);
});
