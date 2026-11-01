import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { buildMetadata, createMetadata } = await import("./metadata");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("createMetadata sets an absolute metadataBase", () => {
  const metadata = buildMetadata({
    description: "d",
    instanceName: "WonderMoney",
    title: "t",
  });
  assert.ok(metadata.metadataBase instanceof URL);
});

test("createMetadata tolerates a protocol-less base URL (e.g. Vercel's bare-hostname convention)", () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "my-app.vercel.app");
  const metadata = buildMetadata({
    description: "d",
    instanceName: "WonderMoney",
    title: "t",
  });
  assert.equal(String(metadata.metadataBase), "https://my-app.vercel.app/");
});

test("a renamed instance names the tab, the installed app and link previews", () => {
  const metadata = buildMetadata({
    description: "d",
    instanceName: "Casa Finance",
    title: "Accounts",
  });

  assert.equal(metadata.title, "Accounts | Casa Finance");
  assert.equal(metadata.applicationName, "Casa Finance");
  assert.equal(metadata.openGraph?.siteName, "Casa Finance");
  assert.equal(metadata.openGraph?.title, "Accounts | Casa Finance");
  assert.deepEqual(metadata.appleWebApp, {
    capable: true,
    statusBarStyle: "default",
    title: "Accounts | Casa Finance",
  });
  assert.ok(!JSON.stringify(metadata).includes("WonderMoney"));
  // Not the hosted service, so not its publisher or social account either.
  assert.equal(metadata.publisher, undefined);
  assert.ok(!JSON.stringify(metadata).includes("@wondermoneyapp"));
});

test("the default instance keeps the hosted title and publisher", () => {
  const metadata = buildMetadata({
    description: "d",
    instanceName: "WonderMoney",
    title: "Accounts",
  });

  assert.equal(metadata.title, "Accounts | WonderMoney");
  assert.equal(metadata.openGraph?.siteName, "WonderMoney");
  assert.equal(metadata.publisher, "RadixCatch");
});

test("createMetadata titles the page with the name the API reports", async () => {
  vi.stubEnv("API_INTERNAL_URL", "http://api:3001");
  const fetch = vi.fn(async () => Response.json({ name: "Casa Finance" }));
  vi.stubGlobal("fetch", fetch);

  const metadata = await createMetadata({ description: "d", title: "Budgets" });

  assert.equal(metadata.title, "Budgets | Casa Finance");
  assert.equal(
    String(fetch.mock.calls[0]?.at(0)),
    "http://api:3001/v1/instance",
  );
});
