// @vitest-environment jsdom
import assert from "node:assert/strict";

import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import { instanceFeatures, queryClientWithInstance } from "@/lib/api/instance/instance-fixture";
import type { InstanceDescription } from "@/lib/api/instance/useInstance";

import enMessages from "../../messages/en/common.json";
import Feedback from "./Feedback";

const mocked = vi.hoisted(() => ({ analytics: false, capture: vi.fn(), post: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({ usePathname: () => "/budgets" }));
vi.mock("@/components/ui/Link", () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture: mocked.capture }) }));
vi.mock("@/lib/utils/analytics-enabled", () => ({ isAnalyticsEnabled: () => mocked.analytics }));
vi.mock("@/lib/api/api", () => ({ default: { post: mocked.post } }));

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
beforeEach(() => {
  mocked.analytics = false;
  mocked.capture.mockReset();
  mocked.post.mockReset().mockResolvedValue({ data: undefined });
});
afterEach(cleanup);

function renderFeedback(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Feedback />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const shareButton = () => screen.queryByRole("button", { name: enMessages["share-feedback"] });

async function sendFeedback() {
  const user = userEvent.setup();
  await user.click(shareButton()!);
  await user.click(await screen.findByRole("button", { name: enMessages["feedback-bug"] }));
  await user.type(screen.getByPlaceholderText(enMessages["feedback-placeholder"]), "The chart is wrong");
  await user.click(screen.getByRole("button", { name: enMessages["feedback-submit"] }));
}

test("offers feedback on an instance that can email it", () => {
  renderFeedback(queryClientWithInstance(instanceFeatures({ feedback: true })));
  assert.ok(shareButton());
});

test("hides the feedback form on an instance that cannot deliver it, keeping the support address", () => {
  renderFeedback(queryClientWithInstance(instanceFeatures({ feedback: false }), { supportEmail: "help@example.com" }));
  assert.equal(shareButton(), null);
  assert.ok(document.querySelector('a[href="mailto:help@example.com"]'));
});

test("renders nothing on an instance with neither feedback nor a support address", () => {
  const { container } = renderFeedback(
    queryClientWithInstance(instanceFeatures({ contactForm: false, feedback: false }), { supportEmail: null }),
  );
  assert.equal(container.innerHTML, "");
});

test("treats an API that predates the feedback flag as having no feedback", () => {
  const { feedback: _feedback, ...olderFeatures } = instanceFeatures();
  renderFeedback(queryClientWithInstance(olderFeatures as InstanceDescription["features"]));
  assert.equal(shareButton(), null);
});

test("thanks the user only after the API has delivered the feedback", async () => {
  renderFeedback(queryClientWithInstance(instanceFeatures({ feedback: true })));
  await sendFeedback();

  await screen.findByText(enMessages["feedback-thank-you"]);
  assert.deepEqual(mocked.post.mock.calls[0], [
    "/v1/feedback",
    { message: "The chart is wrong", page: "/budgets", type: "bug" },
  ]);
  assert.equal(mocked.capture.mock.calls.length, 0);
});

test("says the feedback was not sent when the API fails, and keeps the message", async () => {
  mocked.post.mockRejectedValue(new Error("502"));
  renderFeedback(queryClientWithInstance(instanceFeatures({ feedback: true })));
  await sendFeedback();

  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, enMessages["feedback-send-error"]);
  assert.equal(screen.queryByText(enMessages["feedback-thank-you"]), null);
  assert.equal(
    (screen.getByPlaceholderText(enMessages["feedback-placeholder"]) as HTMLTextAreaElement).value,
    "The chart is wrong",
  );
});

test("sends feedback to analytics where they are configured, as the hosted app does", async () => {
  mocked.analytics = true;
  renderFeedback(queryClientWithInstance(instanceFeatures({ feedback: false })));
  await sendFeedback();

  await waitFor(() => assert.equal(mocked.capture.mock.calls.length, 1));
  assert.deepEqual(mocked.capture.mock.calls[0], [
    "feedback_submitted",
    { message: "The chart is wrong", page: "/budgets", type: "bug" },
  ]);
  assert.equal(mocked.post.mock.calls.length, 0);
});
