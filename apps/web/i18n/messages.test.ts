/// <reference types="vite/client" />
import assert from "node:assert/strict";

import { test, vi } from "vitest";

import getRequestConfig from "./request";
import { routing } from "./routing";

type Messages = Record<string, unknown>;

// Outside Next's react-server condition next-intl ships a throwing stub; the
// real server export hands back the callback it was given.
vi.mock("next-intl/server", () => ({
  getRequestConfig: <T,>(createConfig: T) => createConfig,
}));

/**
 * Every message file on disk, as data, keyed by `../messages/<locale>/<file>.json`.
 * Enumerated rather than listed so a new namespace is covered by existing.
 */
const catalogFiles = import.meta.glob<Messages>("../messages/*/*.json", {
  eager: true,
  import: "default",
});

function filesFor(locale: string) {
  return Object.entries(catalogFiles)
    .filter(([path]) => path.startsWith(`../messages/${locale}/`))
    .map(([path, messages]) => ({ name: path.split("/").at(-1)!, messages }));
}

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value as Messages).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function valueAt(messages: Messages, path: string) {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Messages)[segment];
  }, messages);
}

async function loadedMessages(locale: string) {
  const config = await (
    getRequestConfig as unknown as (params: {
      requestLocale: Promise<string | undefined>;
    }) => Promise<{ locale: string; messages: Messages }>
  )({ requestLocale: Promise.resolve(locale) });
  return config;
}

const [defaultLocale, ...otherLocales] = [
  routing.defaultLocale,
  ...routing.locales.filter((locale) => locale !== routing.defaultLocale),
];

test("every supported locale has the same message files", () => {
  const expected = filesFor(defaultLocale)
    .map((file) => file.name)
    .sort();
  assert.ok(expected.length > 0, "no message files found for the default locale");

  for (const locale of otherLocales) {
    assert.deepEqual(
      filesFor(locale)
        .map((file) => file.name)
        .sort(),
      expected,
      `${locale} message files differ from ${defaultLocale}`,
    );
  }
});

/*
 * A message file that exists but is not loaded per request renders every key
 * in it as a missing message; a loader importing a file that does not exist
 * fails the whole request.
 */
for (const locale of routing.locales) {
  test(`a ${locale} request loads every ${locale} message`, async () => {
    const { locale: resolved, messages } = await loadedMessages(locale);
    assert.equal(resolved, locale);

    for (const file of filesFor(locale)) {
      for (const key of leafKeys(file.messages)) {
        assert.notEqual(
          valueAt(messages, key),
          undefined,
          `${locale}/${file.name}: "${key}" is not served by the request config`,
        );
      }
    }
  });
}

test("an unsupported locale falls back to the default locale's messages", async () => {
  const { locale } = await loadedMessages("xx");
  assert.equal(locale, routing.defaultLocale);
});

/*
 * A missing key renders a raw "… is not yet translated" fallback to a reader
 * of that locale, so every locale must carry exactly the default locale's keys.
 */
for (const locale of otherLocales) {
  test(`${locale} has a message for every ${defaultLocale} key and no others`, () => {
    for (const { name, messages } of filesFor(defaultLocale)) {
      const translated = filesFor(locale).find((file) => file.name === name);
      assert.ok(translated, `${locale} is missing ${name}`);

      const expectedKeys = new Set(leafKeys(messages));
      const actualKeys = new Set(leafKeys(translated.messages));

      assert.deepEqual(
        [...expectedKeys].filter((key) => !actualKeys.has(key)),
        [],
        `${locale}/${name} is missing keys`,
      );
      assert.deepEqual(
        [...actualKeys].filter((key) => !expectedKeys.has(key)),
        [],
        `${locale}/${name} has keys ${defaultLocale} does not`,
      );
    }
  });
}

test("every message is a non-empty string", () => {
  for (const [path, messages] of Object.entries(catalogFiles)) {
    for (const key of leafKeys(messages)) {
      const value = valueAt(messages, key);
      assert.equal(typeof value, "string", `${path}: "${key}" is not a string`);
      assert.notEqual((value as string).trim(), "", `${path}: "${key}" is empty`);
    }
  }
});

/*
 * next-intl reads a dot as nesting, so a key that contains one can never be
 * looked up.
 */
test("no message key contains a dot", () => {
  const dotted = (value: unknown, path: string[] = []): string[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.entries(value as Messages).flatMap(([key, child]) => [
      ...(key.includes(".") ? [[...path, key].join(" > ")] : []),
      ...dotted(child, [...path, key]),
    ]);
  };

  for (const [path, messages] of Object.entries(catalogFiles)) {
    assert.deepEqual(dotted(messages), [], `${path} has dotted keys`);
  }
});
