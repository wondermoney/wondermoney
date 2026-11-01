// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import { InstanceNameProvider } from "@/components/instance/InstanceNameProvider";

import enMessages from "../../../../../messages/en/common.json";
import LoginPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { social: vi.fn() } },
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("react-google-recaptcha-v3", () => ({
  useGoogleReCaptcha: () => ({ executeRecaptcha: undefined }),
}));

afterEach(cleanup);

function renderLogin(instanceName?: string) {
  const page = (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { enabled: false } } })
      }
    >
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LoginPage />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  render(
    instanceName ? (
      <InstanceNameProvider name={instanceName}>{page}</InstanceNameProvider>
    ) : (
      page
    ),
  );
}

test("the sign-in page names a renamed instance in its heading and wordmark", () => {
  renderLogin("Smoke Money");

  assert.equal(
    screen.getByRole("heading", { level: 1 }).textContent,
    "Welcome back to Smoke Money",
  );
  assert.equal(
    screen.getByRole("link", { name: "Smoke Money" }).getAttribute("href"),
    "/",
  );
  assert.equal(screen.queryByAltText("WonderMoney"), null);
});

test("the sign-in page keeps the WonderMoney logo by default", () => {
  renderLogin();

  assert.equal(
    screen.getByRole("heading", { level: 1 }).textContent,
    "Welcome back to WonderMoney",
  );
  assert.ok(screen.getByAltText("WonderMoney"));
});
