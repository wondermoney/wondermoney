// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "@/messages/en/common.json";

import MfaPage from "./page";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: () => {}, replace: () => {} }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useRouter: () => router,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  useRouter: () => router,
}));
// No full session yet: a 2FA challenge is pending, so the page shows the code form.
vi.mock("@/lib/auth/client", () => ({
  authClient: { getSession: vi.fn(async () => ({ data: null, error: null })) },
}));

// input-otp polls the caret position; jsdom has no layout.
document.elementFromPoint = () => null;

afterEach(cleanup);

test("mid-sign-in, the MFA page offers a way back to login and no sign-up link", async () => {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MfaPage />
    </NextIntlClientProvider>,
  );

  await screen.findByRole("heading", { name: enMessages["multi-factor-authentication"] });

  const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
  assert.ok(!hrefs.includes("/auth/signup"), `unexpected sign-up link among ${hrefs.join(", ")}`);
  assert.ok(hrefs.includes("/auth/login"));
});
