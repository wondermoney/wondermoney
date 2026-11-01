// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import { instanceFeatures, queryClientWithInstance } from "@/lib/api/instance/instance-fixture";

import enMessages from "../../messages/en/common.json";
import LoginForm from "./LoginForm";
import SignupForm from "./SignupForm";

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));
vi.mock("@/lib/auth/client", () => ({ authClient: { signIn: { social: vi.fn() } } }));
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture: () => {} }) }));
vi.mock("react-google-recaptcha-v3", () => ({ useGoogleReCaptcha: () => ({ executeRecaptcha: undefined }) }));

afterEach(cleanup);

function renderWith(form: ReactNode, client: QueryClient) {
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {form}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const googleButton = () => screen.queryByRole("button", { name: enMessages.google });

const forms = [
  ["login", () => <LoginForm />],
  ["sign-up", () => <SignupForm />],
] as const;

for (const [name, form] of forms) {
  test(`the ${name} page offers Google when the server has it configured`, () => {
    renderWith(form(), queryClientWithInstance(instanceFeatures({ googleSignIn: true })));
    assert.ok(googleButton());
  });

  test(`the ${name} page hides Google on a server without Google credentials`, () => {
    renderWith(form(), queryClientWithInstance(instanceFeatures({ googleSignIn: false })));
    assert.equal(googleButton(), null);
    assert.equal(screen.queryByText(enMessages["or-continue-with"]), null);
  });

  test(`the ${name} page does not offer Google before the server has answered`, () => {
    // Nothing cached and nothing fetched: the instance query never resolves.
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
    renderWith(form(), client);
    assert.equal(googleButton(), null);
  });
}
