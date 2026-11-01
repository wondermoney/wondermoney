import { expect, test } from "vitest";

import { resolveServerApiUrl } from "./server-api-url";

test("server-side requests go to the internal API address when one is set", () => {
  expect(
    resolveServerApiUrl({
      API_INTERNAL_URL: "http://api:3001/",
      NEXT_PUBLIC_API_URL: "http://localhost:3001",
    }),
  ).toBe("http://api:3001");
});

test("without an internal address, server-side requests use the public API address", () => {
  expect(
    resolveServerApiUrl({
      API_INTERNAL_URL: "",
      NEXT_PUBLIC_API_URL: "https://api.example.com",
    }),
  ).toBe("https://api.example.com");
  expect(resolveServerApiUrl({})).toBe("http://localhost:3001");
});
