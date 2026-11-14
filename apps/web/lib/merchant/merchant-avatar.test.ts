import assert from "node:assert/strict";

import { test } from "vitest";

import {
  fnv1a32,
  MERCHANT_AVATAR_PALETTE,
  merchantAvatarColor,
  merchantColorIndex,
  merchantInitial,
  normalizeMerchantName,
} from "./merchant-avatar";

test("a merchant name is normalised as the API normalises it", () => {
  assert.equal(normalizeMerchantName("  Café   NERO "), "cafe nero");
  assert.equal(normalizeMerchantName("Pão\tde  Açúcar"), "pao de acucar");
});

test("the same merchant gets the same colour however its name is written", () => {
  assert.equal(
    merchantColorIndex("Café Nero"),
    merchantColorIndex("  cafe   NERO "),
  );
  assert.equal(
    merchantAvatarColor("Café Nero"),
    merchantAvatarColor("  cafe   NERO "),
  );
});

test("the hash is FNV-1a, pinned so web, mobile and the API stay on one colour", () => {
  // Shared with the mobile client: change these only together with it.
  assert.equal(fnv1a32(""), 0x811c9dc5);
  assert.equal(fnv1a32("starbucks"), 3426220875);
  assert.equal(merchantColorIndex("starbucks"), 3);
  assert.equal(merchantColorIndex("Starbucks"), 3);
  assert.equal(merchantColorIndex("Café Nero"), 6);
});

test("the palette keeps the order both clients share", () => {
  assert.deepEqual(
    MERCHANT_AVATAR_PALETTE.map((color) => color.hue),
    ["blue", "teal", "amber", "fuchsia", "sky", "orange", "stone", "slate"],
  );
});

test("the initial is the first letter or digit, upper-cased", () => {
  assert.equal(merchantInitial("starbucks"), "S");
  assert.equal(merchantInitial("  (ética) loja"), "É");
  assert.equal(merchantInitial("7-Eleven"), "7");
  assert.equal(merchantInitial("***"), "?");
  assert.equal(merchantInitial(""), "?");
});
