// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import {
  instanceFeatures,
  queryClientWithInstance,
} from "@/lib/api/instance/instance-fixture";
import type { InstanceDescription } from "@/lib/api/instance/useInstance";
import type { InstanceSetup } from "@/lib/instance-setup.server";

import adminMessages from "../../../../messages/en/admin.json";
import commonMessages from "../../../../messages/en/common.json";
import navigationMessages from "../../../../messages/en/navigation.json";

const messages = { ...commonMessages, ...navigationMessages, ...adminMessages };

const setup = vi.hoisted(() => ({
  current: { instance: null, setupRequired: false } as InstanceSetup,
}));

/** `redirect()` ends the render by throwing; the tests read where it pointed. */
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/instance-setup.server", () => ({
  getInstanceSetup: () => Promise.resolve(setup.current),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  useParams: () => ({ locale: "en" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: (options?: string | { namespace?: string }) =>
    Promise.resolve(
      createTranslator({
        locale: "en",
        messages,
        namespace: (typeof options === "string" ? options : options?.namespace) as never,
      }),
    ),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { social: vi.fn() }, signUp: { email: vi.fn() } },
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("react-google-recaptcha-v3", () => ({
  GoogleReCaptchaProvider: ({ children }: { children: ReactNode }) => children,
  useGoogleReCaptcha: () => ({ executeRecaptcha: undefined }),
}));

const { default: SetupPage } = await import("./page");
const { default: LoginLayout } = await import("../auth/login/layout");
const { default: SignupPage } = await import("../auth/signup/page");

const params = (locale: string) => Promise.resolve({ locale });

function newServer(
  features: InstanceDescription["features"],
  firstAccountAdmin = true,
): InstanceSetup {
  return {
    instance: {
      apiVersion: 1,
      features,
      firstAccountAdmin,
      minAppVersion: null,
      name: "Home Money",
      setupRequired: true,
      signupMode: "open",
      supportEmail: null,
    },
    setupRequired: true,
  };
}

async function renderSetup() {
  const page = (await SetupPage({ params: params("en") })) as ReactElement;
  render(
    <QueryClientProvider
      client={queryClientWithInstance(setup.current.instance?.features)}
    >
      <NextIntlClientProvider locale="en" messages={messages}>
        {page}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function redirectOf(render: () => Promise<unknown>): Promise<null | string> {
  try {
    await render();
    return null;
  } catch (error) {
    if (error instanceof Redirect) return error.to;
    throw error;
  }
}

beforeEach(() => {
  setup.current = { instance: null, setupRequired: false };
});
afterEach(cleanup);

test("a new server sends sign-in and sign-up to setup, in the visitor's language", async () => {
  setup.current = newServer(instanceFeatures());

  assert.equal(
    await redirectOf(() => LoginLayout({ children: null, params: params("pt") })),
    "/pt/setup",
  );
  assert.equal(await redirectOf(() => SignupPage({ params: params("en") })), "/en/setup");
});

test("a server with accounts keeps sign-in and sign-up, and sends setup to sign-in", async () => {
  assert.equal(
    await redirectOf(() => LoginLayout({ children: null, params: params("en") })),
    null,
  );
  assert.equal(await redirectOf(() => SignupPage({ params: params("en") })), null);
  assert.equal(await redirectOf(() => SetupPage({ params: params("es") })), "/es/auth/login");
});

test("setup welcomes the operator by the server's name, offers sign-up and lists what is on", async () => {
  setup.current = newServer(
    instanceFeatures({ email: false, googleSignIn: false, oidc: { name: "Home SSO" } }),
  );

  await renderSetup();

  assert.ok(screen.getByText(messages.instanceSetup.description));

  assert.match(
    screen.getByRole("heading", { level: 1 }).textContent ?? "",
    /Home Money/u,
  );
  assert.ok(screen.getByLabelText(/email/iu, { selector: "input" }));
  assert.ok(screen.getByRole("button", { name: messages.instanceSetup["create-account"] }));
  const features = within(
    screen.getByRole("region", { name: messages.instanceSetup["features-title"] }),
  );
  const row = (name: string) =>
    features.getByText(name).closest("li") as HTMLElement;
  assert.equal(
    within(row(messages.instanceSetup["feature-email"])).getByRole("link").getAttribute("href"),
    "https://docs.wonder.money/en/docs/self-hosting/configure#email",
  );
  assert.match(row(messages.instanceSetup["feature-email"]).textContent ?? "", /Off/u);
  assert.match(row(messages.instanceSetup["feature-singleSignOn"]).textContent ?? "", /On/u);
  assert.equal(
    within(row(messages.instanceSetup["feature-singleSignOn"])).queryByRole("link"),
    null,
  );
});

test("setup promises admin only when the first account gets it, not when single sign-on groups decide", async () => {
  setup.current = newServer(instanceFeatures({ oidc: { name: "Home SSO" } }), false);

  await renderSetup();

  assert.ok(screen.getByText(messages.instanceSetup["description-groups"]));
  assert.equal(screen.queryByText(messages.instanceSetup.description), null);
});
