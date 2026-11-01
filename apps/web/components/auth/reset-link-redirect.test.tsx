// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import ForgotPasswordForm from "./ForgotPasswordForm";
import ResetPasswordForm from "./ResetPasswordForm";

const navigation = vi.hoisted(() => {
  const replace = vi.fn<(href: string) => void>();
  // Stable across renders, like the real router.
  const router = { replace, push: () => {}, refresh: () => {} };
  return { search: "", replace, router };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  useParams: () => ({ locale: "en" }),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => navigation.router,
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { resetPassword: vi.fn(), requestPasswordReset: vi.fn() },
}));

beforeEach(() => {
  navigation.search = "";
  navigation.replace.mockClear();
});
afterEach(cleanup);

/** Follows the reset page's redirect and renders where it lands. */
async function followInvalidLink(
  linkQuery: string,
  locale: string,
  messages: (typeof locales)[number]["messages"],
) {
  navigation.search = linkQuery;
  const { unmount } = render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ResetPasswordForm />
    </NextIntlClientProvider>,
  );
  await waitFor(() => assert.equal(navigation.replace.mock.calls.length, 1));
  unmount();

  const target = new URL(navigation.replace.mock.calls[0][0], "http://app.test");
  assert.equal(target.pathname, "/auth/forgot");
  navigation.search = target.search;
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ForgotPasswordForm />
    </NextIntlClientProvider>,
  );
}

const locales = [
  { locale: "en", messages: enMessages },
  { locale: "pt", messages: ptMessages },
  { locale: "es", messages: esMessages },
] as const;

for (const { locale, messages } of locales) {
  test(`an expired reset link lands on the forgot page saying why (${locale})`, async () => {
    await followInvalidLink("?error=INVALID_TOKEN", locale, messages);

    const alert = screen.getByRole("alert");
    assert.match(alert.textContent ?? "", new RegExp(messages["reset-link-invalid-title"]));
    // The way out is right there: the email field to request a new link.
    assert.ok(screen.getByRole("textbox", { name: messages.email }));
  });
}

test("a reset link with no token at all is treated the same way", async () => {
  await followInvalidLink("", "en", enMessages);

  assert.ok(screen.getByRole("alert"));
});

test("a valid reset link stays on the reset form", async () => {
  navigation.search = "?token=abc123";
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ResetPasswordForm />
    </NextIntlClientProvider>,
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(navigation.replace.mock.calls.length, 0);
});

test("the forgot page shows no warning when reached directly", () => {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ForgotPasswordForm />
    </NextIntlClientProvider>,
  );

  assert.equal(screen.queryByRole("alert"), null);
});
