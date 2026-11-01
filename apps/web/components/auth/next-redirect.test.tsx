// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import MfaPage from "@/app/[locale]/(no-layout)/auth/mfa/page";
import { instanceFeatures, queryClientWithInstance } from "@/lib/api/instance/instance-fixture";

import enMessages from "../../messages/en/common.json";
import LoginForm from "./LoginForm";
import MfaForm from "./MfaForm";

const APP_ORIGIN = "http://localhost:3000";

const { apiPost, authClient, router } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  authClient: {
    getSession: vi.fn(),
    signIn: { email: vi.fn(), social: vi.fn() },
    signOut: vi.fn(),
    twoFactor: { verifyTotp: vi.fn() },
  },
  router: { push: vi.fn(), refresh: () => {}, replace: () => {} },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
  useRouter: () => router,
}));
vi.mock("@/lib/auth/client", () => ({ authClient }));
vi.mock("@/lib/api/api", () => ({ default: { post: apiPost } }));

// input-otp polls the caret position; jsdom has no layout.
document.elementFromPoint = () => null;

const originalLocation = window.location;
const assign = vi.fn();

function visit(search = "") {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign, origin: APP_ORIGIN, search },
  });
}

beforeEach(() => {
  visit();
  apiPost.mockResolvedValue({ data: { outcome: "login", method: "email" } });
  authClient.signIn.social.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

function renderWithProviders(ui: ReactNode) {
  render(
    <QueryClientProvider client={queryClientWithInstance(instanceFeatures({ googleSignIn: true }))}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function logInWithPassword(nextParam: string | null) {
  renderWithProviders(<LoginForm nextParam={nextParam} />);
  fireEvent.change(screen.getByLabelText(enMessages.email), { target: { value: "a@example.com" } });
  fireEvent.change(screen.getByLabelText(enMessages.password), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: enMessages["log-in"] }));
  await waitFor(() => assert.equal(assign.mock.calls.length, 1));
}

/** The destination of the one full-page navigation, as path + query. */
function landedOn(): string {
  const url = new URL(String(assign.mock.calls[0]![0]), APP_ORIGIN);
  assert.equal(url.origin, APP_ORIGIN);
  return `${url.pathname}${url.search}`;
}

const UNSAFE_NEXT = ["//evil.example", "https://evil.example/", "/%2F%2Fevil.example", "/\\evil.example", "/api/auth/sign-out"];

test("a password login returns to a safe next", async () => {
  authClient.signIn.email.mockResolvedValue({ data: { user: {} }, error: null });

  await logInWithPassword("/en/accounts/42?tab=transactions");

  assert.equal(landedOn(), "/en/accounts/42?tab=transactions");
});

test("a password login without next lands on the locale home", async () => {
  authClient.signIn.email.mockResolvedValue({ data: { user: {} }, error: null });

  await logInWithPassword(null);

  assert.equal(landedOn(), "/en");
});

for (const unsafe of UNSAFE_NEXT) {
  test(`a password login ignores unsafe next ${JSON.stringify(unsafe)}`, async () => {
    authClient.signIn.email.mockResolvedValue({ data: { user: {} }, error: null });

    await logInWithPassword(unsafe);

    assert.equal(landedOn(), "/en");
  });
}

test("a login that needs 2FA goes to MFA with next carried along", async () => {
  authClient.signIn.email.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });

  await logInWithPassword("/en/settings?tab=security");

  const url = new URL(landedOn(), APP_ORIGIN);
  assert.equal(url.pathname, "/en/auth/mfa");
  assert.equal(url.searchParams.get("next"), "/en/settings?tab=security");
});

test("a login that needs 2FA drops an unsafe next", async () => {
  authClient.signIn.email.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });

  await logInWithPassword("//evil.example");

  assert.equal(landedOn(), "/en/auth/mfa");
});

async function googleCallbackFor(nextParam: string | null): Promise<URL> {
  renderWithProviders(<LoginForm nextParam={nextParam} />);
  fireEvent.click(screen.getByRole("button", { name: enMessages.google }));
  await waitFor(() => assert.equal(authClient.signIn.social.mock.calls.length, 1));
  return new URL(authClient.signIn.social.mock.calls[0]![0].callbackURL);
}

test("Google sign-in comes back through auth-complete with next", async () => {
  const callback = await googleCallbackFor("/pt/budgets");

  assert.equal(callback.pathname, "/en/auth/complete");
  assert.equal(callback.searchParams.get("next"), "/pt/budgets");
});

test("Google sign-in drops an unsafe next from its callback", async () => {
  const callback = await googleCallbackFor("https://evil.example/");

  assert.equal(callback.pathname, "/en/auth/complete");
  assert.equal(callback.searchParams.has("next"), false);
});

async function verifyCodeOnMfaPageWith(search: string) {
  visit(search);
  authClient.twoFactor.verifyTotp.mockResolvedValue({ error: null });
  renderWithProviders(<MfaForm />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: enMessages.submit }));
  await waitFor(() => assert.equal(assign.mock.calls.length, 1));
}

test("a verified MFA code returns to the next on the MFA page's URL", async () => {
  await verifyCodeOnMfaPageWith(`?next=${encodeURIComponent("/es/goals?id=3")}`);

  assert.equal(landedOn(), "/es/goals?id=3");
});

test("a verified MFA code ignores an unsafe next", async () => {
  await verifyCodeOnMfaPageWith(`?next=${encodeURIComponent("/%5Cevil.example")}`);

  assert.equal(landedOn(), "/en");
});

async function openMfaPageSignedInWith(search: string): Promise<string> {
  visit(search);
  authClient.getSession.mockResolvedValue({ data: { session: {} }, error: null });
  renderWithProviders(<MfaPage />);
  await waitFor(() => assert.equal(router.push.mock.calls.length, 1));
  return String(router.push.mock.calls[0]![0]);
}

test("the MFA page with nothing left to verify goes to next through the localised router", async () => {
  // The router prepends the active locale itself.
  assert.equal(
    await openMfaPageSignedInWith(`?next=${encodeURIComponent("/en/settings?tab=security")}`),
    "/settings?tab=security",
  );
});

test("the MFA page with nothing left to verify ignores an unsafe next", async () => {
  assert.equal(await openMfaPageSignedInWith(`?next=${encodeURIComponent("//evil.example")}`), "/");
});
