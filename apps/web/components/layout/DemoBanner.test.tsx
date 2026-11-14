// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import {
  instanceFeatures,
  queryClientWithInstance,
} from "@/lib/api/instance/instance-fixture";
import type { InstanceDescription } from "@/lib/api/instance/useInstance";
import { type Profile, profileQueryKey } from "@/lib/api/user/useProfile";
import { instanceConfig } from "@/lib/instance";

import enMessages from "../../messages/en/common.json";
import DemoBanner from "./DemoBanner";

const { calls, router, signOut } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    router: {
      push: vi.fn((path: string) => calls.push(`push ${path}`)),
      refresh: () => {},
      replace: () => {},
    },
    signOut: vi.fn(async () => {
      calls.push("sign-out");
      return {};
    }),
  };
});

vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut } }));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ reset: () => {} }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  calls.length = 0;
});

const PROFILE: Profile = {
  emailAddress: "demo@example.com",
  firstName: "Demo",
  lastName: null,
  mfaEnabled: false,
};

function renderBanner({
  demo,
  signupMode = "open",
}: {
  demo: boolean | undefined;
  signupMode?: InstanceDescription["signupMode"];
}) {
  const client = queryClientWithInstance(instanceFeatures({ demo: true }), {
    signupMode,
  });
  client.setQueryData<Profile>(profileQueryKey, { ...PROFILE, demo });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <DemoBanner />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const banner = () =>
  screen.queryByRole("region", { name: enMessages.demo["banner-label"] });
const signUp = () =>
  screen.queryByRole("button", { name: enMessages.demo["banner-sign-up"] });

test("the demo account sees the read-only demo banner", () => {
  renderBanner({ demo: true });
  assert.ok(banner());
  assert.ok(screen.getByText(enMessages.demo["banner-message"]));
});

test("an ordinary account, or one on an older API, sees no demo banner", () => {
  renderBanner({ demo: false });
  assert.equal(banner(), null);
  cleanup();

  renderBanner({ demo: undefined });
  assert.equal(banner(), null);
});

test("the banner links to the self-hosting docs in the current locale", () => {
  renderBanner({ demo: true });
  const link = screen.getByRole("link", {
    name: enMessages.demo["banner-self-host"],
  });
  assert.equal(
    link.getAttribute("href"),
    `${instanceConfig.docsUrl}/en/docs/self-hosting`,
  );
});

test("sign-up is offered only when the server's sign-up is open", () => {
  renderBanner({ demo: true, signupMode: "open" });
  assert.ok(signUp());
  cleanup();

  for (const signupMode of ["invite", "closed"] as const) {
    renderBanner({ demo: true, signupMode });
    assert.equal(signUp(), null, signupMode);
    // The docs link stays either way.
    assert.ok(
      screen.getByRole("link", { name: enMessages.demo["banner-self-host"] }),
    );
    cleanup();
  }
});

test("sign-up from the demo ends the demo session before opening the sign-up page", async () => {
  renderBanner({ demo: true });

  fireEvent.click(signUp()!);

  await waitFor(() => assert.equal(router.push.mock.calls.length, 1));
  assert.deepEqual(calls, ["sign-out", "push /auth/signup"]);
});
