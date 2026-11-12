// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../../../../messages/en/common.json";
import AuthCodeErrorPage from "./page";

/** The flat strings; nested namespaces are not used here. */
const messages = enMessages as unknown as Record<string, string>;

vi.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve((key: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replace(`{${name}}`, value),
        messages[key] ?? key,
      ),
    ),
}));
vi.mock("@/lib/instance-name.server", () => ({
  getInstanceName: () => Promise.resolve("Home"),
}));
vi.mock("@/components/layout/Logo", () => ({ default: () => null }));
vi.mock("@/components/ui/Link", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

async function renderFor(error?: string) {
  render(
    await AuthCodeErrorPage({
      searchParams: Promise.resolve(error ? { error } : {}),
    }),
  );
}

test.each([
  ["OIDC_GROUP_NOT_ALLOWED", "auth-code-error-oidc-group-not-allowed"],
  ["OIDC_EMAIL_NOT_VERIFIED", "auth-code-error-oidc-email-not-verified"],
  ["account_not_linked", "auth-code-error-account-not-linked"],
  ["SIGNUP_DISABLED", "auth-code-error-signup-disabled"],
])("explains a sign-in refused with %s", async (error, key) => {
  await renderFor(error);
  assert.ok(screen.getByText(messages[key] ?? ""));
  assert.equal(
    screen.queryByText(enMessages["auth-code-error-description"]),
    null,
  );
});

test.each([undefined, "invalid_code", "constructor"])(
  "falls back to the generic text for %s",
  async (error) => {
    await renderFor(error);
    assert.ok(screen.getByText(enMessages["auth-code-error-description"]));
  },
);
