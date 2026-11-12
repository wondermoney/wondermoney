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
import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import api from "@/lib/api/api";
import {
  instanceFeatures,
  queryClientWithInstance,
} from "@/lib/api/instance/instance-fixture";

import enMessages from "../../messages/en/common.json";
import LoginForm from "./LoginForm";

const APP_ORIGIN = "http://localhost:3000";

const { authClient } = vi.hoisted(() => ({
  authClient: {
    getSession: vi.fn(),
    signIn: { email: vi.fn(), social: vi.fn() },
    signOut: vi.fn(),
  },
}));

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
vi.mock("@/lib/auth/client", () => ({ authClient }));

type Reply = {
  data?: unknown;
  headers?: Record<string, string>;
  status: number;
};

/**
 * The real API client with its network swapped out: every request the page makes is
 * recorded, and answered from `replies` by path.
 */
const requests: InternalAxiosRequestConfig[] = [];
let replies: Record<string, Reply | "network-error"> = {};
const originalAdapter = api.defaults.adapter;
const originalLocation = window.location;
const assign = vi.fn();

beforeEach(() => {
  api.defaults.adapter = async (config) => {
    requests.push(config);
    const reply = replies[config.url ?? ""] ?? { status: 404 };
    if (reply === "network-error") {
      throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);
    }
    const response: AxiosResponse = {
      config,
      data: reply.data ?? {},
      headers: reply.headers ?? {},
      status: reply.status,
      statusText: "",
    };
    if (reply.status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${reply.status}`,
        AxiosError.ERR_BAD_REQUEST,
        config,
        null,
        response,
      );
    }
    return response;
  };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign, origin: APP_ORIGIN, search: "" },
  });
  authClient.signOut.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  requests.length = 0;
  replies = {};
  api.defaults.adapter = originalAdapter;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

function renderLogin(client: QueryClient, nextParam: null | string = null) {
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LoginForm nextParam={nextParam} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const demoButton = () =>
  screen.queryByRole("button", { name: enMessages.demo["sign-in"] });
const withDemo = () =>
  queryClientWithInstance(instanceFeatures({ demo: true }));

const DEMO_SESSION = {
  session: {
    cookieName: "better-auth.session_token",
    cookieValue: "opaque",
    expiresAt: "2026-11-12T12:00:00.000Z",
  },
};

test("a server that offers the demo shows the demo button on the sign-in page", () => {
  renderLogin(withDemo());
  assert.ok(demoButton());
});

test("a server with the demo off, or one older than the flag, shows no demo button", () => {
  renderLogin(queryClientWithInstance(instanceFeatures({ demo: false })));
  assert.equal(demoButton(), null);
  cleanup();

  renderLogin(queryClientWithInstance(instanceFeatures()));
  assert.equal(demoButton(), null);
});

test("the demo button stays hidden until the server has answered", () => {
  renderLogin(
    new QueryClient({ defaultOptions: { queries: { enabled: false } } }),
  );
  assert.equal(demoButton(), null);
});

test("the demo button signs in with the session cookie and continues like a password sign-in", async () => {
  replies = {
    "/v1/auth/callback": { data: { outcome: "login" }, status: 200 },
    "/v1/auth/demo": { data: DEMO_SESSION, status: 201 },
  };
  renderLogin(withDemo(), "/en/budgets");

  fireEvent.click(demoButton()!);

  await waitFor(() => assert.equal(assign.mock.calls.length, 1));
  const [demo, callback] = requests;
  assert.equal(demo?.method, "post");
  assert.equal(demo?.url, "/v1/auth/demo");
  assert.equal(demo?.withCredentials, true);
  assert.equal(callback?.method, "post");
  assert.equal(callback?.url, "/v1/auth/callback");
  assert.equal(callback?.withCredentials, true);
  const landed = new URL(String(assign.mock.calls[0]![0]), APP_ORIGIN);
  assert.equal(`${landed.pathname}${landed.search}`, "/en/budgets");
  assert.equal(screen.queryByRole("alert"), null);
});

test("the demo button is busy while the sign-in runs", async () => {
  let release: (value: unknown) => void = () => {};
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const adapter = api.defaults.adapter as (
    config: InternalAxiosRequestConfig,
  ) => Promise<AxiosResponse>;
  api.defaults.adapter = async (config) => {
    await pending;
    return adapter(config);
  };
  replies = { "/v1/auth/demo": { status: 404 } };
  renderLogin(withDemo());

  fireEvent.click(demoButton()!);

  await waitFor(() => {
    assert.equal(demoButton()?.getAttribute("aria-busy"), "true");
    assert.equal((demoButton() as HTMLButtonElement).disabled, true);
  });
  release(undefined);
  await waitFor(() => assert.ok(screen.getByRole("alert")));
});

const failures: [string, Reply | "network-error", string, boolean][] = [
  [
    "the demo is turned off (404)",
    { status: 404 },
    "sign-in-unavailable",
    true,
  ],
  [
    "the demo account is not set up (503)",
    { data: { code: "demo_unavailable" }, status: 503 },
    "sign-in-unavailable",
    true,
  ],
  [
    "the demo is rate limited (429)",
    {
      data: { code: "RATE_LIMITED", retryAfter: 60 },
      headers: { "retry-after": "60" },
      status: 429,
    },
    "sign-in-rate-limited",
    false,
  ],
  ["the network is down", "network-error", "sign-in-failed", false],
];

for (const [when, reply, messageKey, staysDisabled] of failures) {
  test(`a demo sign-in that fails because ${when} says so and stays on the page`, async () => {
    replies = { "/v1/auth/demo": reply };
    renderLogin(withDemo());

    fireEvent.click(demoButton()!);

    const alert = await screen.findByRole("alert");
    assert.equal(
      alert.textContent,
      enMessages.demo[messageKey as keyof typeof enMessages.demo],
    );
    assert.equal(assign.mock.calls.length, 0);
    // No provisioning call follows a refused demo sign-in.
    assert.deepEqual(
      requests.map((request) => request.url),
      ["/v1/auth/demo"],
    );
    assert.equal((demoButton() as HTMLButtonElement).disabled, staysDisabled);
  });
}

test("a demo session that cannot be provisioned is signed out and reported", async () => {
  replies = {
    "/v1/auth/callback": { status: 500 },
    "/v1/auth/demo": { data: DEMO_SESSION, status: 201 },
  };
  renderLogin(withDemo());

  fireEvent.click(demoButton()!);

  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, enMessages.demo["sign-in-failed"]);
  assert.equal(authClient.signOut.mock.calls.length, 1);
  assert.equal(assign.mock.calls.length, 0);
  assert.equal((demoButton() as HTMLButtonElement).disabled, false);
});
