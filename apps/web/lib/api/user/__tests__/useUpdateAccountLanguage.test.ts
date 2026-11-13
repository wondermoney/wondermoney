import assert from "node:assert/strict";

import { test } from "vitest";

import { routing } from "@/i18n/routing";

import {
  toAccountLanguage,
  updateAccountLanguage,
} from "../useUpdateAccountLanguage";

test("every web locale maps to the account language the API stores", () => {
  assert.deepEqual(
    routing.locales.map((locale) => [locale, toAccountLanguage(locale)]),
    [
      ["en", "EN"],
      ["pt", "PT"],
      ["es", "ES"],
    ],
  );
});

test("a locale the account cannot hold reads as English", () => {
  assert.equal(toAccountLanguage("fr"), "EN");
  assert.equal(toAccountLanguage("toString"), "EN");
});

test("picking Español sets the account language to ES", async () => {
  const calls: [string, unknown][] = [];
  const client = {
    patch: (url: string, body: unknown) => {
      calls.push([url, body]);
      return Promise.resolve({ data: undefined });
    },
  };

  await updateAccountLanguage("user/1", "es", client);

  assert.deepEqual(calls, [["/v1/user/user%2F1", { language: "ES" }]]);
});
