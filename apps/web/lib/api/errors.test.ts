import assert from "node:assert/strict";

import { test } from "vitest";

import { classifyAppError } from "@/lib/errors/app-error";

import {
  getApiErrorCode,
  isBankCredentialInvalidError,
  isDemoReadOnlyError,
  isHouseholdOwnerRequiredError,
} from "./errors";

test("detects demo read-only api errors", () => {
  assert.equal(
    isDemoReadOnlyError({
      response: { status: 403, data: { code: "demo_read_only" } },
    }),
    true,
  );
});

test("rejects non-demo read-only errors", () => {
  assert.equal(
    isDemoReadOnlyError({
      response: { status: 401, data: { code: "demo_read_only" } },
    }),
    false,
  );
  assert.equal(
    isDemoReadOnlyError({
      response: { status: 403, data: { code: "other" } },
    }),
    false,
  );
  assert.equal(isDemoReadOnlyError(undefined), false);
});

const forbidden = (code: string) => ({ response: { data: { code }, status: 403 } });

test("reads the code off an error, and nothing off a shapeless one", () => {
  assert.equal(getApiErrorCode(forbidden("demo_read_only")), "demo_read_only");
  assert.equal(getApiErrorCode({ response: { data: {} } }), undefined);
  assert.equal(getApiErrorCode({ response: { data: { code: "" } } }), undefined);
  assert.equal(getApiErrorCode(new Error("boom")), undefined);
  assert.equal(getApiErrorCode(undefined), undefined);
});

test("tells the two 403s apart", () => {
  // Both are 403 and only the code separates them, which is why WEB-4Q spent a
  // month misattributed to a session race.
  assert.equal(isHouseholdOwnerRequiredError(forbidden("household_owner_required")), true);
  assert.equal(isHouseholdOwnerRequiredError(forbidden("demo_read_only")), false);
});

test("classifies a 403 as auth and a 401 as auth", () => {
  assert.equal(classifyAppError(forbidden("household_owner_required")), "auth");
  assert.equal(classifyAppError({ response: { status: 403 } }), "auth");
  assert.equal(classifyAppError({ response: { status: 401 } }), "auth");
});

test("detects invalid bank credentials, which need a reconnect not a retry", () => {
  assert.equal(isBankCredentialInvalidError(forbidden("bank_credential_invalid")), true);
  assert.equal(isBankCredentialInvalidError(forbidden("not_found")), false);
});
