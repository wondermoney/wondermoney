import assert from "node:assert/strict";

import { test } from "vitest";

import {
  isSupportedTimeZone,
  resolveViewerTimeZone,
  toReportTimeZone,
} from "./viewer-timezone";

test("a real IANA name is passed through unchanged", () => {
  for (const zone of [
    "Europe/Madrid",
    "Europe/Lisbon",
    "UTC",
    "America/Argentina/Buenos_Aires",
    "Etc/GMT+1",
  ]) {
    assert.equal(toReportTimeZone(zone), zone, zone);
    assert.equal(isSupportedTimeZone(zone), true, zone);
  }
});

test("surrounding whitespace is trimmed rather than sent", () => {
  assert.equal(toReportTimeZone("  Europe/Madrid  "), "Europe/Madrid");
});

test("anything the API would reject resolves to no filter at all", () => {
  // The API validates `timezone` with Intl and answers 400 on a name it cannot
  // resolve, so an unusable reading must become "omit the param", never a
  // guess and never a value that fails the whole report.
  const unusable = [
    undefined,
    null,
    "",
    "   ",
    "Not/A/Zone",
    "Europe/Atlantis",
    "Mars/Olympus_Mons",
    "'; DROP TABLE",
    "Europe/Madrid; rm -rf",
    "local",
    42,
    {},
    ["Europe/Madrid"],
  ];

  for (const value of unusable) {
    assert.equal(
      toReportTimeZone(value),
      undefined,
      `expected ${JSON.stringify(value)} to be omitted`,
    );
  }
});

test("a fixed offset is not accepted as a calendar", () => {
  // Some runtimes answer `resolvedOptions().timeZone` with an offset. An offset
  // cannot express a DST transition inside the reporting period, so the API's
  // named default is a better answer than sending it.
  for (const offset of ["+01:00", "-05:00", "+0100", "GMT+1"]) {
    assert.equal(toReportTimeZone(offset), undefined, offset);
  }
});

test("a server render never claims a time zone", () => {
  // This test file runs in Node with no `window`, which is exactly the
  // condition a Next.js server render is in. The container's zone (whatever
  // TZ says) must not leak out as if it were the viewer's.
  assert.equal(typeof globalThis.window, "undefined");
  assert.equal(resolveViewerTimeZone(), undefined);
});

test("a browser render sends the viewer's own calendar", () => {
  const runtime = globalThis as { window?: unknown };
  runtime.window = {};
  try {
    const resolved = resolveViewerTimeZone();
    assert.equal(typeof resolved, "string");
    assert.equal(resolved, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(isSupportedTimeZone(resolved as string), true);
  } finally {
    delete runtime.window;
  }
});

test("a browser whose Intl cannot name a zone falls back to omitting", () => {
  const runtime = globalThis as { window?: unknown };
  const realIntl = globalThis.Intl;
  runtime.window = {};
  try {
    Object.defineProperty(globalThis, "Intl", {
      configurable: true,
      value: {
        DateTimeFormat: () => {
          throw new Error("Intl unavailable");
        },
      },
    });
    assert.equal(resolveViewerTimeZone(), undefined);

    Object.defineProperty(globalThis, "Intl", {
      configurable: true,
      value: {
        DateTimeFormat: () => ({ resolvedOptions: () => ({}) }),
      },
    });
    assert.equal(resolveViewerTimeZone(), undefined);
  } finally {
    Object.defineProperty(globalThis, "Intl", {
      configurable: true,
      value: realIntl,
    });
    delete runtime.window;
  }
});
