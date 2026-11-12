import assert from "node:assert/strict";

import { test } from "vitest";

import { presetLocale } from "./preset-locale";

test("a browser language in the app's language decides the region", () => {
  assert.deepEqual(presetLocale("pt", ["en-US", "pt-BR"]), {
    language: "pt",
    region: "BR",
  });
  assert.deepEqual(presetLocale("es", ["es-ES", "en-GB"]), {
    language: "es",
    region: "ES",
  });
});

test("otherwise the first browser language with a region does", () => {
  assert.deepEqual(presetLocale("en", ["pt-PT", "en"]), {
    language: "en",
    region: "PT",
  });
});

test("no region is sent when the browser names none", () => {
  assert.deepEqual(presetLocale("pt", ["pt", "en"]), { language: "pt" });
  assert.deepEqual(presetLocale("pt", []), { language: "pt" });
});

test("malformed browser languages are ignored", () => {
  assert.deepEqual(presetLocale("es", ["not a tag", "es-MX"]), {
    language: "es",
    region: "MX",
  });
});
