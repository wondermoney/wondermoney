import assert from "node:assert/strict";

import { afterEach, beforeEach, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Module = typeof import("./instance-setup.server");
let getInstanceSetup: Module["getInstanceSetup"];

beforeEach(async () => {
  // The module remembers a set-up server for the life of the process.
  vi.resetModules();
  ({ getInstanceSetup } = await import("./instance-setup.server"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const apiAnswers = (...bodies: (() => Promise<Response>)[]) => {
  const fetch = vi.fn<() => Promise<Response>>();
  for (const body of bodies) fetch.mockImplementationOnce(body);
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

test("needs setup while the API says nobody has signed up, asking afresh each time", async () => {
  const fetch = apiAnswers(
    async () => Response.json({ name: "Home", setupRequired: true }),
    async () => Response.json({ name: "Home", setupRequired: true }),
  );

  const first = await getInstanceSetup();
  assert.equal(first.setupRequired, true);
  assert.equal(first.instance?.name, "Home");
  assert.equal((await getInstanceSetup()).setupRequired, true);
  assert.equal(fetch.mock.calls.length, 2);
});

test("stops asking once the API says the server is set up", async () => {
  const fetch = apiAnswers(
    async () => Response.json({ name: "Home", setupRequired: true }),
    async () => Response.json({ name: "Home", setupRequired: false }),
  );

  assert.equal((await getInstanceSetup()).setupRequired, true);
  assert.equal((await getInstanceSetup()).setupRequired, false);
  assert.equal((await getInstanceSetup()).setupRequired, false);
  assert.equal(fetch.mock.calls.length, 2);
});

test("reads an older API without the field as set up", async () => {
  apiAnswers(async () => Response.json({ name: "Home" }));

  assert.equal((await getInstanceSetup()).setupRequired, false);
});

test("shows the usual sign-in when the API cannot be reached, and asks again next time", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  apiAnswers(
    () => Promise.reject(new TypeError("fetch failed")),
    async () => new Response("nope", { status: 503 }),
    async () => Response.json({ setupRequired: true }),
  );

  assert.equal((await getInstanceSetup()).setupRequired, false);
  assert.equal((await getInstanceSetup()).setupRequired, false);
  assert.equal((await getInstanceSetup()).setupRequired, true);
});
