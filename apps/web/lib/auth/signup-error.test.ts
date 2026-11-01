import assert from "node:assert/strict";

import { test } from "vitest";

import en from "@/messages/en/common.json";
import es from "@/messages/es/common.json";
import pt from "@/messages/pt/common.json";

import {
  getSignupCallbackErrorKey,
  getSignupProviderErrorKey,
  type SignupErrorMessageKey,
} from "./signup-error";

const apiError = (status: number, code?: string, message?: string) => ({
  response: { data: { code, message }, status },
});

test("an email that already has an account says so instead of 'try again later'", () => {
  assert.equal(
    getSignupProviderErrorKey({ code: "USER_ALREADY_EXISTS", status: 422 }),
    "toast-signup-error-email-taken",
  );
  assert.equal(
    getSignupProviderErrorKey({
      code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
      status: 422,
    }),
    "toast-signup-error-email-taken",
  );
});

test("provider validation failures name the field the user has to fix", () => {
  assert.equal(
    getSignupProviderErrorKey({ code: "INVALID_EMAIL", status: 400 }),
    "toast-signup-error-invalid-email",
  );
  assert.equal(
    getSignupProviderErrorKey({ code: "PASSWORD_TOO_SHORT", status: 400 }),
    "toast-signup-error-password-length",
  );
});

test("a rate-limited signup tells the user to wait, at either stage", () => {
  assert.equal(
    getSignupProviderErrorKey({ status: 429 }),
    "toast-signup-error-rate-limited",
  );
  assert.equal(
    getSignupCallbackErrorKey(apiError(429, "RATE_LIMITED"), {
      hasInvite: false,
    }),
    "toast-signup-error-rate-limited",
  );
});

test("each invite refusal the API names gets its own message, with or without the token in hand", () => {
  const cases: [number, string, SignupErrorMessageKey][] = [
    [400, "invite_expired", "toast-signup-error-invite-expired"],
    [400, "invite_already_used", "toast-signup-error-invite-used"],
    [409, "invite_already_used", "toast-signup-error-invite-used"],
    [400, "invite_email_mismatch", "toast-signup-error-invite-email-mismatch"],
    [400, "invite_invalid", "toast-signup-error-invite-invalid"],
    [409, "household_full", "toast-signup-error-household-full"],
  ];
  for (const [status, code, key] of cases) {
    for (const hasInvite of [true, false]) {
      assert.equal(
        getSignupCallbackErrorKey(apiError(status, code), { hasInvite }),
        key,
        `${code} (${status})`,
      );
    }
  }
});

test("a server without invite codes: a refused household invite points at the invite, not at the account", () => {
  for (const error of [
    apiError(400, "bad_request", "This invitation has expired."),
    apiError(409, "conflict", "This household is already full."),
  ]) {
    assert.equal(
      getSignupCallbackErrorKey(error, { hasInvite: true }),
      "toast-signup-error-invite",
    );
  }
});

test("without an invite, a refused callback means the email already has an account", () => {
  assert.equal(
    getSignupCallbackErrorKey(apiError(400, "bad_request"), {
      hasInvite: false,
    }),
    "toast-signup-error-email-taken",
  );
});

test("server faults and unknown errors stay generic and never echo the API's message", () => {
  const internal = apiError(
    500,
    "internal_error",
    'duplicate key value violates unique constraint "appuser_pkey"',
  );
  assert.equal(
    getSignupCallbackErrorKey(internal, { hasInvite: true }),
    "toast-signup-error",
  );
  assert.equal(
    getSignupCallbackErrorKey(new Error("Network Error"), { hasInvite: false }),
    "toast-signup-error",
  );
  assert.equal(
    getSignupProviderErrorKey({ code: "SOMETHING_NEW", status: 400 }),
    "toast-signup-error",
  );
  assert.equal(getSignupProviderErrorKey(null), "toast-signup-error");
});

test("every signup error message exists in en, pt and es", () => {
  const keys: SignupErrorMessageKey[] = [
    "toast-signup-error",
    "toast-signup-error-email-taken",
    "toast-signup-error-invalid-email",
    "toast-signup-error-household-full",
    "toast-signup-error-invite",
    "toast-signup-error-invite-email-mismatch",
    "toast-signup-error-invite-expired",
    "toast-signup-error-invite-invalid",
    "toast-signup-error-invite-used",
    "toast-signup-error-password-length",
    "toast-signup-error-rate-limited",
  ];
  for (const [locale, messages] of Object.entries({ en, es, pt })) {
    for (const key of keys) {
      const value = (messages as Record<string, unknown>)[key];
      assert.ok(
        typeof value === "string" && value.length > 0,
        `${locale} is missing ${key}`,
      );
    }
  }
});
