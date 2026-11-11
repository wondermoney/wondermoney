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

/*
 * The ICU arguments in a message, as `name` or `name:type`: `{name}` and the
 * argument of a plural, select or number (`{count, plural, …}`). A translator
 * may rewrite everything inside the branches — `one {line} other {lines}` is
 * copy, not an argument — but the arguments themselves are the contract. A
 * `{name}` that becomes a literal leaves a raw placeholder in front of the
 * reader, and a plural that loses its argument stops formatting the number.
 * Arguments nested in a branch (a plural that mentions `{currencies}`) count
 * too, so branch bodies are parsed rather than skipped.
 */
function icuArguments(message: string) {
  const found = new Set<string>();
  const header = /^\s*([A-Za-z_][\w-]*)\s*(?:,\s*([A-Za-z]+))?\s*(?:,|$)/;

  const matchingBrace = (text: string, open: number) => {
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
      if (text[index] === "{") depth += 1;
      if (text[index] === "}") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return text.length - 1;
  };

  const readMessage = (text: string, start: number, end: number) => {
    let index = start;
    while (index < end) {
      if (text[index] !== "{") {
        index += 1;
        continue;
      }

      const close = matchingBrace(text, index);
      const inner = text.slice(index + 1, close);
      const match = header.exec(inner);

      // A brace that does not open an argument is literal text (a stray `{`).
      if (match) {
        const [, name, type] = match;
        found.add(type ? `${name}:${type}` : name);

        if (type === "plural" || type === "select" || type === "selectordinal") {
          let branch = index + 1 + match[0].length;
          while (branch < close) {
            if (text[branch] === "{") {
              const branchClose = matchingBrace(text, branch);
              readMessage(text, branch + 1, branchClose);
              branch = branchClose + 1;
            } else {
              branch += 1;
            }
          }
        }
      }

      index = close + 1;
    }
  };

  readMessage(message, 0, message.length);
  return [...found].sort();
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

      for (const key of expectedKeys) {
        assert.ok(
          actualKeys.has(key),
          `${locale}/${name}: "${key}" is missing — add it to apps/web/messages/${locale}/${name} (English: apps/web/messages/${defaultLocale}/${name})`,
        );
      }
      for (const key of actualKeys) {
        assert.ok(
          expectedKeys.has(key),
          `${locale}/${name}: "${key}" does not exist in ${defaultLocale}/${name} — add it there or remove it from ${locale}/${name}`,
        );
      }
    }
  });
}

/*
 * A key can exist in every locale and still render wrongly: a translation that
 * drops `{name}` or turns a plural into plain text gives that locale's reader a
 * different message. The words are free; the ICU arguments are not.
 */
for (const locale of otherLocales) {
  test(`${locale} keeps every ${defaultLocale} message's ICU arguments`, () => {
    for (const { name, messages } of filesFor(defaultLocale)) {
      const translated = filesFor(locale).find((file) => file.name === name);
      assert.ok(translated, `${locale} is missing ${name}`);

      for (const key of leafKeys(messages)) {
        const source = valueAt(messages, key);
        const target = valueAt(translated.messages, key);
        // Key parity and the non-empty-string test report a missing or
        // non-string message; there is nothing to compare here.
        if (typeof source !== "string" || typeof target !== "string") continue;

        const expected = icuArguments(source);
        const actual = icuArguments(target);
        const missing = expected.filter((argument) => !actual.includes(argument));
        const extra = actual.filter((argument) => !expected.includes(argument));

        assert.deepEqual(
          { missing, extra },
          { missing: [], extra: [] },
          `${locale}/${name}: "${key}" has different ICU arguments from ${defaultLocale} — missing: ${missing.join(", ") || "none"}; not in ${defaultLocale}: ${extra.join(", ") || "none"}`,
        );
      }
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
