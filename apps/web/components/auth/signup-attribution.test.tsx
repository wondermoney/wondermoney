// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import { ANALYTICS_CONSENT_KEY } from "@/lib/analytics/consent";
import { instanceFeatures, queryClientWithInstance } from "@/lib/api/instance/instance-fixture";

import enMessages from "../../messages/en/common.json";
import SignupForm from "./SignupForm";

// A visitor who followed a signup link from a wonder.money tool page, having come to the
// website from ChatGPT: the website put both values on the link (`apps/landing/src/lib/landingSource.ts`).
const mocked = vi.hoisted(() => ({
  search: "landing_source=toolMortgage&referrer_class=ai_assistant",
  social: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useSearchParams: () => new URLSearchParams(mocked.search),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));
vi.mock("@/lib/auth/client", () => ({ authClient: { signIn: { social: mocked.social } } }));
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture: () => {} }) }));
vi.mock("react-google-recaptcha-v3", () => ({ useGoogleReCaptcha: () => ({ executeRecaptcha: undefined }) }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  mocked.social.mockReset();
});

async function signUpWithGoogle(): Promise<URL> {
  mocked.social.mockResolvedValue({ error: null });
  render(
    <QueryClientProvider client={queryClientWithInstance(instanceFeatures({ googleSignIn: true }))}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SignupForm />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: enMessages.google }));
  await waitFor(() => assert.equal(mocked.social.mock.calls.length, 1));
  const [{ callbackURL }] = mocked.social.mock.calls[0] as [{ callbackURL: string }];
  return new URL(callbackURL);
}

test("a Google signup carries the landing source and referrer class with the app's analytics consent", async () => {
  window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");

  const callbackURL = await signUpWithGoogle();

  assert.equal(callbackURL.pathname, "/en/auth/complete");
  assert.equal(callbackURL.searchParams.get("landing_source"), "toolMortgage");
  assert.equal(callbackURL.searchParams.get("referrer_class"), "ai_assistant");
});

test("a Google signup carries neither without the app's analytics consent", async () => {
  const callbackURL = await signUpWithGoogle();

  assert.equal(callbackURL.searchParams.has("landing_source"), false);
  assert.equal(callbackURL.searchParams.has("referrer_class"), false);
});
