import assert from "node:assert/strict";

import { createTranslator } from "next-intl";
import { test } from "vitest";

import enMessages from "../../../../messages/en/common.json";
import esMessages from "../../../../messages/es/common.json";
import ptMessages from "../../../../messages/pt/common.json";
import { accountTypeTranslationKey } from "../useAccountTypes";

/** The account types the API seeds and returns from /v1/account/account-types. */
const SEEDED_ACCOUNT_TYPES = [
  "CHECKING",
  "SAVINGS",
  "INVESTMENT",
  "MORTGAGE",
  "CREDIT_CARD",
  "LOAN",
  "PENSION",
  "OTHER",
  "EXTERNAL",
  "CASH",
];

const catalogs = { en: enMessages, pt: ptMessages, es: esMessages } as const;

for (const [locale, messages] of Object.entries(catalogs)) {
  test(`every seeded account type has a readable label in ${locale}`, () => {
    const missing: string[] = [];
    const t = createTranslator({
      locale,
      messages,
      onError: (error) => missing.push(error.message),
    });

    for (const description of SEEDED_ACCOUNT_TYPES) {
      const label = t(accountTypeTranslationKey(description) as never);
      assert.ok(label.trim().length > 0, `${description} renders an empty label`);
    }
    assert.deepEqual(missing, []);
  });
}
