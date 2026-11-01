import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getInstanceName } = await import("./instance-name.server");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const apiAnswers = (response: () => Promise<Response>) =>
  vi.stubGlobal("fetch", vi.fn(response));

test("reads the instance name from the API's internal address", async () => {
  vi.stubEnv("API_INTERNAL_URL", "http://api:3001");
  const fetch = vi.fn(async () => Response.json({ name: "  Smoke Money " }));
  vi.stubGlobal("fetch", fetch);

  assert.equal(await getInstanceName(), "Smoke Money");
  assert.equal(
    String(fetch.mock.calls[0]?.at(0)),
    "http://api:3001/v1/instance",
  );
});

test("falls back to WonderMoney when the API is unreachable", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  apiAnswers(() => Promise.reject(new TypeError("fetch failed")));
  assert.equal(await getInstanceName(), "WonderMoney");
});

test("falls back to WonderMoney when the API errors or sends no name", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  apiAnswers(async () => new Response("nope", { status: 503 }));
  assert.equal(await getInstanceName(), "WonderMoney");

  apiAnswers(async () => Response.json({ name: "" }));
  assert.equal(await getInstanceName(), "WonderMoney");
});
