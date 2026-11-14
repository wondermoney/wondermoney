/**
 * Every bank-sync failure code the API can store has plain copy and an action in
 * all three shipped locales. The API's own `bank-sync-status.service.ts` builds
 * its accepted-code set from `BANK_SYNC_ERROR_CODES`, so this covers every value
 * it can return.
 */
import assert from "node:assert/strict";

import {
  BANK_SYNC_ERROR_ACTION_KEYS,
  BANK_SYNC_ERROR_CODES,
  BANK_SYNC_ERROR_COPY,
} from "@wondermoney/shared/bank-sync";
import { test } from "vitest";

import en from "../messages/en/common.json";
import es from "../messages/es/common.json";
import pt from "../messages/pt/common.json";

type Messages = Record<string, unknown>;

function valueAt(messages: Messages, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Messages)[segment];
  }, messages);
}

const catalogs = { en, es, pt } as const;

test("every bank-sync error code has copy and an action in en, pt and es", () => {
  for (const code of BANK_SYNC_ERROR_CODES) {
    const copy = BANK_SYNC_ERROR_COPY[code];
    const actionKey = BANK_SYNC_ERROR_ACTION_KEYS[copy.action];

    for (const [locale, messages] of Object.entries(catalogs)) {
      const message = valueAt(messages as Messages, copy.messageKey);
      const action = valueAt(messages as Messages, actionKey);

      assert.equal(typeof message, "string", `${locale} is missing ${copy.messageKey}`);
      assert.notEqual((message as string).trim(), "", `${locale} has empty copy for ${copy.messageKey}`);
      assert.equal(typeof action, "string", `${locale} is missing ${actionKey}`);
      assert.notEqual((action as string).trim(), "", `${locale} has an empty action for ${actionKey}`);
    }
  }
});
