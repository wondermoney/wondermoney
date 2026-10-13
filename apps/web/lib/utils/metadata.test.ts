import assert from "node:assert/strict";

import { test } from "vitest";

import { createMetadata } from "./metadata";

test("createMetadata sets an absolute metadataBase", () => {
  const metadata = createMetadata({ description: "d", title: "t" });
  assert.ok(metadata.metadataBase instanceof URL);
});

test("createMetadata tolerates a protocol-less base URL (e.g. Vercel's bare-hostname convention)", () => {
  process.env.NEXT_PUBLIC_APP_URL = "my-app.vercel.app";
  try {
    const metadata = createMetadata({ description: "d", title: "t" });
    assert.equal(String(metadata.metadataBase), "https://my-app.vercel.app/");
  } finally {
    delete process.env.NEXT_PUBLIC_APP_URL;
  }
});
