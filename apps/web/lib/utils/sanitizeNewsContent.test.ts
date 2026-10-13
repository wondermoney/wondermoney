import assert from "node:assert/strict";

import { test } from "vitest";

import { stripHtmlToText } from "./sanitizeNewsContent";

test("stripHtmlToText removes scripts and event handlers", () => {
  const result = stripHtmlToText(
    '<p>Hello <strong>world</strong></p><script>alert(1)</script><img src=x onerror="alert(2)">',
  );

  assert.equal(result, "Hello world");
});

test("stripHtmlToText preserves readable text and links", () => {
  const result = stripHtmlToText(
    '<div>Read <a href="https://example.com">more</a><style>body{display:none}</style></div>',
  );

  assert.equal(result, "Read more");
});

test("stripHtmlToText decodes named and numeric entities", () => {
  const result = stripHtmlToText(
    "Markets&nbsp;&amp;&nbsp;rates moved &lt;today&gt; as Company&apos;s &#x26; bonds rallied",
  );

  assert.equal(result, "Markets & rates moved <today> as Company's & bonds rallied");
});

test("stripHtmlToText leaves invalid numeric entities inert", () => {
  assert.doesNotThrow(() => stripHtmlToText("Bad code point &#x110000; stays text"));
  assert.equal(
    stripHtmlToText("Bad code point &#x110000; stays text"),
    "Bad code point &#x110000; stays text",
  );
});
