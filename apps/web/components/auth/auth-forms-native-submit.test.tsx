// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentType } from "react";
import { afterEach, test, vi } from "vitest";

import { queryClientWithInstance } from "@/lib/api/instance/instance-fixture";

import enMessages from "../../messages/en/common.json";
import ForgotPasswordForm from "./ForgotPasswordForm";
import LoginForm from "./LoginForm";
import MfaForm from "./MfaForm";
import ResetPasswordForm from "./ResetPasswordForm";

const router = vi.hoisted(() => ({ push: () => {}, refresh: () => {}, replace: () => {} }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams("token=reset-token"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useRouter: () => router,
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: {},
}));

afterEach(cleanup);

/*
 * Until React hydrates, submitting a form is a native browser submit. Without
 * `method="post"` that is a GET, which puts the email and password in the URL,
 * the browser history and every proxy and server log on the way.
 */
const forms: [string, ComponentType][] = [
  ["login", LoginForm],
  ["two-factor", MfaForm],
  ["forgot password", ForgotPasswordForm],
  ["reset password", ResetPasswordForm],
];

for (const [name, Form] of forms) {
  test(`a native submit of the ${name} form never puts its fields in the URL`, () => {
    const { container } = render(
      <QueryClientProvider client={queryClientWithInstance()}>
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <Form />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    const form = container.querySelector("form");
    assert.ok(form, `${name} form rendered`);
    assert.equal(form.method, "post");
  });
}
