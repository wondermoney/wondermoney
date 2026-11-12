// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import {
  instanceFeatures,
  queryClientWithInstance,
} from "@/lib/api/instance/instance-fixture";

import enMessages from "../../messages/en/common.json";
import LoginForm from "./LoginForm";
import SignupForm from "./SignupForm";

const { social } = vi.hoisted(() => ({ social: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));
vi.mock("@/lib/auth/client", () => ({ authClient: { signIn: { social } } }));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("react-google-recaptcha-v3", () => ({
  useGoogleReCaptcha: () => ({ executeRecaptcha: undefined }),
}));

afterEach(() => {
  cleanup();
  social.mockReset();
});

function renderWith(form: ReactNode, client: QueryClient) {
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {form}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const ssoButton = () =>
  screen.queryByRole("button", { name: "Sign in with Home SSO" });
const passwordField = () => screen.queryByPlaceholderText(enMessages.password);
const withSso = (overrides: Parameters<typeof instanceFeatures>[0] = {}) =>
  queryClientWithInstance(
    instanceFeatures({ oidc: { name: "Home SSO" }, ...overrides }),
  );

const forms = [
  ["login", () => <LoginForm />],
  ["sign-up", () => <SignupForm />],
] as const;

for (const [name, form] of forms) {
  test(`the ${name} page offers "Sign in with <name>" when the server has single sign-on`, () => {
    renderWith(form(), withSso());
    assert.ok(ssoButton());
    // Password sign-in stays alongside it.
    assert.ok(passwordField());
  });

  test(`the ${name} page has no single sign-on button on a server without it`, () => {
    renderWith(
      form(),
      queryClientWithInstance(instanceFeatures({ oidc: null })),
    );
    assert.equal(screen.queryByRole("button", { name: /Sign in with/ }), null);
  });

  test(`the ${name} page does not offer single sign-on before the server has answered`, () => {
    renderWith(
      form(),
      new QueryClient({ defaultOptions: { queries: { enabled: false } } }),
    );
    assert.equal(ssoButton(), null);
    // Nor does it hide the password form on a guess.
    assert.ok(passwordField());
  });

  test(`the ${name} page hides the password form under OIDC_ONLY and keeps single sign-on`, () => {
    renderWith(form(), withSso({ passwordSignIn: false }));
    assert.equal(passwordField(), null);
    assert.equal(screen.queryByPlaceholderText(enMessages.email), null);
    assert.equal(screen.queryByText(enMessages["forgot-pw"]), null);
    assert.ok(ssoButton());
  });
}

test("the login page keeps Google next to single sign-on under OIDC_ONLY", () => {
  renderWith(
    <LoginForm />,
    withSso({ googleSignIn: true, passwordSignIn: false }),
  );
  assert.ok(ssoButton());
  assert.ok(screen.queryByRole("button", { name: enMessages.google }));
});

test("single sign-on goes through the provider and back to /auth/complete, with refusals on the error page", async () => {
  social.mockResolvedValue({
    data: { redirect: true, url: "https://sso.example.com/authorize" },
    error: null,
  });
  renderWith(<LoginForm nextParam="/en/budgets" />, withSso());

  const button = ssoButton();
  assert.ok(button);
  fireEvent.click(button);

  await waitFor(() => assert.equal(social.mock.calls.length, 1));
  const [request] = social.mock.calls[0] as [
    { callbackURL: string; errorCallbackURL: string; provider: string },
  ];
  assert.equal(request.provider, "oidc");
  const callback = new URL(request.callbackURL);
  assert.equal(callback.pathname, "/en/auth/complete");
  assert.equal(callback.searchParams.get("next"), "/en/budgets");
  assert.equal(
    new URL(request.errorCallbackURL).pathname,
    "/en/auth/auth-code-error",
  );
});

test("an invited sign-up through single sign-on carries the invite to /auth/complete", async () => {
  social.mockResolvedValue({
    data: { redirect: true, url: "https://sso.example.com/authorize" },
    error: null,
  });
  renderWith(
    <SignupForm inviteToken="invite-token" lockedEmail="partner@example.com" />,
    withSso({ passwordSignIn: false }),
  );

  const button = ssoButton();
  assert.ok(button);
  fireEvent.click(button);

  await waitFor(() => assert.equal(social.mock.calls.length, 1));
  const [request] = social.mock.calls[0] as [{ callbackURL: string }];
  assert.equal(
    new URL(request.callbackURL).searchParams.get("invite"),
    "invite-token",
  );
});
