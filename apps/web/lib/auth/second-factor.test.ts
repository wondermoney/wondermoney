import assert from "node:assert/strict";

import { test } from "vitest";

import en from "@/messages/en/common.json";
import es from "@/messages/es/common.json";
import pt from "@/messages/pt/common.json";

import {
  getSecondFactorErrorKey,
  normalizeBackupCode,
  type SecondFactorErrorMessageKey,
} from "./second-factor";

test("a wrong or already used backup code says so", () => {
  assert.equal(
    getSecondFactorErrorKey({ code: "INVALID_BACKUP_CODE", status: 401 }),
    "mfa-backup-code-invalid",
  );
});

test("a wrong authenticator code keeps the invalid-code message", () => {
  assert.equal(getSecondFactorErrorKey({ code: "INVALID_CODE", status: 401 }), "invalid-code");
});

test("an ended challenge sends the person back to login", () => {
  assert.equal(
    getSecondFactorErrorKey({ code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", status: 400 }),
    "mfa-error-too-many-attempts",
  );
  assert.equal(
    getSecondFactorErrorKey({ code: "INVALID_TWO_FACTOR_COOKIE", status: 401 }),
    "mfa-error-challenge-expired",
  );
});

test("a locked account and the API's rate limit both ask to wait", () => {
  assert.equal(
    getSecondFactorErrorKey({ code: "ACCOUNT_TEMPORARILY_LOCKED", status: 429 }),
    "mfa-error-rate-limited",
  );
  assert.equal(getSecondFactorErrorKey({ status: 429 }), "mfa-error-rate-limited");
});

test("anything else is the generic verification error", () => {
  assert.equal(getSecondFactorErrorKey({ status: 500 }), "toast-mfa-error");
  assert.equal(getSecondFactorErrorKey({ code: "CONFLICT", status: 409 }), "toast-mfa-error");
  assert.equal(getSecondFactorErrorKey(null), "toast-mfa-error");
});

test("every second-factor message exists in en, pt and es", () => {
  const keys: SecondFactorErrorMessageKey[] = [
    "invalid-code",
    "mfa-backup-code-invalid",
    "mfa-error-challenge-expired",
    "mfa-error-too-many-attempts",
    "mfa-error-rate-limited",
    "toast-mfa-error",
  ];
  for (const messages of [en, es, pt] as Record<string, unknown>[]) {
    for (const key of keys) assert.equal(typeof messages[key], "string", key);
  }
});

test("a backup code keeps its case and loses pasted spaces", () => {
  assert.equal(normalizeBackupCode("  AbCdE-12345 \n"), "AbCdE-12345");
  assert.equal(normalizeBackupCode("AbCdE 12345"), "AbCdE-12345");
});

test("a backup code typed without its hyphen gets it back", () => {
  assert.equal(normalizeBackupCode("abcde12345"), "abcde-12345");
});

test("a code in another shape is sent as typed", () => {
  assert.equal(normalizeBackupCode("abc-12345"), "abc-12345");
  assert.equal(normalizeBackupCode("abcdef123456"), "abcdef123456");
});
