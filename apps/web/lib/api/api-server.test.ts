import assert from "node:assert/strict";

import Axios from "axios";
import { expect, test, vi } from "vitest";

/**
 * The SSR interceptor must not redirect a 403 to login. A 403 is not a dead
 * session — and redirecting a still-logged-in user to login makes middleware
 * bounce them back to the page, which re-fetches, 403s and redirects again, a
 * hard loop. So the contract these tests pin is narrow and
 * load-bearing: 401 redirects, 403 does not.
 */

const redirect = vi.hoisted(() => vi.fn((path: string) => {
  // Mirrors next/navigation: redirect() throws to abort the render.
  throw Object.assign(new Error(`NEXT_REDIRECT:${path}`), { digest: `NEXT_REDIRECT;${path}` });
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ toString: () => "" }),
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/auth/server-auth", () => ({
  requireServerAuth: () => Promise.resolve({ session: {}, user: {} }),
}));

const { getServerApi } = await import("./api-server");

/** Drives the real response interceptor with a synthetic Axios error. */
async function runInterceptor(status: number, data: unknown = {}) {
  const api = await getServerApi("pt");
  const handler = (api.interceptors.response as unknown as {
    handlers: { rejected: (error: unknown) => Promise<unknown> }[];
  }).handlers.at(-1)?.rejected;
  assert.ok(handler, "expected a rejection interceptor to be registered");

  const error = Object.assign(new Error(`Request failed with status code ${status}`), {
    config: { headers: {}, method: "get", url: "/v1/account/transaction" },
    isAxiosError: true,
    response: { data, status },
    toJSON: () => ({}),
  });
  // Axios.isAxiosError checks this brand.
  Object.defineProperty(error, "isAxiosError", { value: true });

  return handler(error).then(
    () => "resolved" as const,
    (thrown: unknown) => thrown,
  );
}

test("a 403 does not redirect to login", async () => {
  redirect.mockClear();

  const thrown = await runInterceptor(403, { message: "Demo account is read-only" });

  expect(redirect).not.toHaveBeenCalled();
  // The error still propagates — the page's catch degrades to the shell.
  expect(Axios.isAxiosError(thrown)).toBe(true);
  expect((thrown as { response?: { status?: number } }).response?.status).toBe(403);
});

test("a 401 with no usable refresh still redirects to login", async () => {
  redirect.mockClear();

  await runInterceptor(401);

  expect(redirect).toHaveBeenCalledWith("/pt/auth/login");
});

test("a household-owner 403 also avoids the login bounce", async () => {
  redirect.mockClear();

  // Household-owner-only routes are not an auth failure either.
  await runInterceptor(403, { message: "Only the household owner can manage the household." });

  expect(redirect).not.toHaveBeenCalled();
});
