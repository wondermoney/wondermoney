import assert from "node:assert/strict";

import { test } from "vitest";

import {
  createMerchantDetailsSchema,
  isAcceptedMerchantUrl,
  MERCHANT_LOGO_URL_MAX_LENGTH,
  MERCHANT_WEBSITE_MAX_LENGTH,
  merchantDetailsPatch,
} from "./merchant-details-schema";

const schema = createMerchantDetailsSchema();

function errorsFor(values: { website: string; logoUrl: string }) {
  const result = schema.safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
  );
}

test("only https addresses are accepted", () => {
  assert.equal(isAcceptedMerchantUrl("https://example.com"), true);
  assert.equal(
    isAcceptedMerchantUrl("https://cdn.example.com/logo.png?s=64"),
    true,
  );

  for (const rejected of [
    "http://example.com",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "ftp://example.com",
    "example.com",
    "https://user:secret@example.com",
    "https://127.0.0.1/logo.png",
    "https://[::1]/logo.png",
    "https://localhost/logo.png",
  ]) {
    assert.equal(isAcceptedMerchantUrl(rejected), false, rejected);
  }
});

test("the form rejects http, javascript and data addresses on either field", () => {
  assert.deepEqual(errorsFor({ website: "http://example.com", logoUrl: "" }), {
    website: "error-https",
  });
  assert.deepEqual(errorsFor({ website: "", logoUrl: "javascript:alert(1)" }), {
    logoUrl: "error-https",
  });
  assert.deepEqual(
    errorsFor({ website: "", logoUrl: "data:image/svg+xml,<svg/>" }),
    { logoUrl: "error-https" },
  );
});

test("the form holds each field to the API's length limit", () => {
  const url = (length: number) =>
    `https://example.com/${"a".repeat(length - "https://example.com/".length)}`;

  assert.deepEqual(
    errorsFor({
      website: url(MERCHANT_WEBSITE_MAX_LENGTH),
      logoUrl: url(MERCHANT_LOGO_URL_MAX_LENGTH),
    }),
    {},
  );
  assert.equal(
    errorsFor({ website: url(MERCHANT_WEBSITE_MAX_LENGTH + 1), logoUrl: "" })
      .website,
    "error-too-long",
  );
  assert.equal(
    errorsFor({ website: "", logoUrl: url(MERCHANT_LOGO_URL_MAX_LENGTH + 1) })
      .logoUrl,
    "error-too-long",
  );
});

test("an empty field clears it", () => {
  assert.deepEqual(
    merchantDetailsPatch({
      website: "  ",
      logoUrl: "https://example.com/l.png",
    }),
    { website: null, logoUrl: "https://example.com/l.png" },
  );
});
