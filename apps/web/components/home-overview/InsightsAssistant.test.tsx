// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type { Insight } from "@/lib/api/insights/useInsights";

import commonMessages from "../../messages/en/common.json";
import homeMessages from "../../messages/en/home.json";
import { closeAssistant } from "../assistant/assistant-store";
import AssistantLauncher from "../assistant/AssistantLauncher";
import { InsightsSection } from "./InsightsSection";

const state = vi.hoisted(() => ({
  aiHidden: false,
  assistantAvailable: true,
}));

const chat = vi.hoisted(() => ({ sendMessage: vi.fn() }));

const consentState = vi.hoisted(() => {
  let consent = {
    assistantEnabled: false,
    chatRetentionMode: "temporary" as const,
    consentVersion: 1,
    disabledAt: null as null | string,
    enabledAt: null as null | string,
    launcherHidden: false,
    providerDisclosureVersion: 1,
  };
  const listeners = new Set<() => void>();

  return {
    get: () => consent,
    set: (next: typeof consent) => {
      consent = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

const insightsState = vi.hoisted(() => ({ insight: null as null | unknown }));

vi.mock("@/lib/api/instance/useInstance", () => ({
  useFeature: () => state.assistantAvailable,
}));
vi.mock("@/lib/api/user-preferences/useAiHidden", () => ({
  default: () => state.aiHidden,
}));
vi.mock("@/lib/api/insights/useInsights", () => ({
  default: () => ({
    data: { insights: [insightsState.insight] },
    error: null,
    isPending: false,
  }),
}));
vi.mock("@/lib/api/assistant/useAssistantConsent", async () => {
  const { useSyncExternalStore } = await import("react");
  function useAssistantConsentMock() {
    return {
      data: useSyncExternalStore(
        consentState.subscribe,
        consentState.get,
        consentState.get,
      ),
      isError: false,
      isLoading: false,
    };
  }
  return { default: useAssistantConsentMock };
});
vi.mock("@/lib/api/assistant/useUpdateAssistantConsent", () => ({
  default: () => ({
    isPending: false,
    mutateAsync: async (input: {
      assistantEnabled: boolean;
      launcherHidden?: boolean;
    }) => {
      const next = {
        ...consentState.get(),
        assistantEnabled: input.assistantEnabled,
        launcherHidden:
          input.launcherHidden ?? consentState.get().launcherHidden,
      };
      consentState.set(next);
      return next;
    },
  }),
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    error: undefined,
    messages: [],
    sendMessage: chat.sendMessage,
    status: "ready",
    stop: async () => {},
  }),
}));
// The launcher loads the panel lazily; in the test the real panel is fine.
vi.mock("next/dynamic", async () => {
  const { default: AssistantPanel } =
    await import("@/components/assistant/AssistantPanel");
  return { default: () => AssistantPanel };
});

const messages = { ...commonMessages, ...homeMessages };

const spending: Insight = {
  facts: {
    baselineAmount: "100",
    categoryKey: 9,
    categoryKeys: [10, 11],
    categoryName: "Food",
    currency: "EUR",
    currentAmount: "150",
    daysElapsed: 10,
    deviationPercent: "50.00",
    direction: "above",
    fromDate: "2026-11-01T00:00:00.000Z",
    toDate: "2026-11-10T12:00:00.000Z",
  },
  id: "spending-1",
  period: "2026-11",
  severity: "warning",
  type: "spending_vs_normal",
};

const budget: Insight = {
  facts: {
    amountBudgeted: "250",
    amountSpent: "100",
    budgetKey: 4,
    budgetName: "Plan",
    budgetTemplateCategoryKey: 2,
    categoryKey: 10,
    categoryName: "Groceries",
    currencyCode: "EUR",
    daysElapsed: 10,
    daysInMonth: 30,
    elapsedPercent: "33.33",
    overBy: "50",
    parentCategoryName: "Food",
    projectedAmount: "300",
  },
  id: "budget-1",
  period: "2026-11",
  severity: "critical",
  type: "budget_pace",
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  insightsState.insight = spending;
});

afterEach(() => {
  cleanup();
  closeAssistant();
  state.aiHidden = false;
  state.assistantAvailable = true;
  chat.sendMessage.mockClear();
  consentState.set({
    assistantEnabled: false,
    chatRetentionMode: "temporary",
    consentVersion: 1,
    disabledAt: null,
    enabledAt: null,
    launcherHidden: false,
    providerDisclosureVersion: 1,
  });
});

function renderAssistant() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <InsightsSection />
        <AssistantLauncher />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function enableConsent() {
  consentState.set({
    ...consentState.get(),
    assistantEnabled: true,
    enabledAt: "2026-11-11T00:00:00.000Z",
  });
}

test("opens the panel with the question in the input and does not send it", async () => {
  enableConsent();
  renderAssistant();

  fireEvent.click(screen.getByRole("button", { name: "Ask the assistant" }));

  const input = (await screen.findByTestId(
    "assistant-input",
  )) as HTMLTextAreaElement;
  assert.equal(
    input.value,
    "Why is my Food spending 50% above normal this month?",
  );
  assert.equal(chat.sendMessage.mock.calls.length, 0);
});

test("builds the budget question from the insight's figures", async () => {
  enableConsent();
  insightsState.insight = budget;
  renderAssistant();

  fireEvent.click(screen.getByRole("button", { name: "Ask the assistant" }));

  const input = (await screen.findByTestId(
    "assistant-input",
  )) as HTMLTextAreaElement;
  assert.equal(
    input.value,
    "Why is my Food / Groceries budget projected at €300.00 against €250.00 planned this month?",
  );
});

test("hides the link when the server has no assistant", () => {
  state.assistantAvailable = false;
  renderAssistant();

  assert.equal(
    screen.queryByRole("button", { name: "Ask the assistant" }),
    null,
  );
});

test("hides the link when the person turned AI off", () => {
  state.aiHidden = true;
  renderAssistant();

  assert.equal(
    screen.queryByRole("button", { name: "Ask the assistant" }),
    null,
  );
});

test("keeps the question through the consent screen and pre-fills it after enabling", async () => {
  renderAssistant();

  fireEvent.click(screen.getByRole("button", { name: "Ask the assistant" }));

  await screen.findByTestId("assistant-consent-screen");
  fireEvent.click(screen.getByTestId("assistant-enable"));

  const input = (await screen.findByTestId(
    "assistant-input",
  )) as HTMLTextAreaElement;
  assert.equal(
    input.value,
    "Why is my Food spending 50% above normal this month?",
  );
  assert.equal(chat.sendMessage.mock.calls.length, 0);
});
