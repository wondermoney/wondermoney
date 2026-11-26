// @vitest-environment jsdom
import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import type { EnableBankingCredentialResponse } from "@/lib/api/user/useEnableBankingCredential";

import {
  ENABLE_BANKING_SETUP_STEP as STEP,
  ENABLE_BANKING_SETUP_STEPS,
  forgetRememberedStep,
  readRememberedStep,
  rememberStep,
  resolveResumeStep,
  revisitStepForError,
  stepNumber,
} from "./enable-banking-setup-steps";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const pending: EnableBankingCredentialResponse = {
  applicationId: null,
  lastValidatedAt: null,
  lastValidationError: null,
  pending: { expiresAt: "2026-12-03T00:00:00.000Z" },
  status: "pending",
};
const active: EnableBankingCredentialResponse = {
  applicationId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  lastValidatedAt: "2026-11-20T00:00:00.000Z",
  lastValidationError: null,
  pending: null,
  status: "active",
};

test("the step ids are the five steps, in order, and stay stable for analytics", () => {
  assert.deepEqual(ENABLE_BANKING_SETUP_STEPS, [
    "sign_in",
    "create_application",
    "activate",
    "application_id",
    "done",
  ]);
  assert.equal(stepNumber(STEP.signIn), 1);
  assert.equal(stepNumber(STEP.done), 5);
});

test("without a pending certificate the wizard starts at sign-in, or at most at creating the application", () => {
  assert.equal(resolveResumeStep(null, null), STEP.signIn);
  assert.equal(resolveResumeStep(null, STEP.signIn), STEP.signIn);
  assert.equal(resolveResumeStep(null, STEP.createApplication), STEP.createApplication);
  // Remembered past step 2, but the certificate lapsed or was never created.
  assert.equal(resolveResumeStep(null, STEP.activate), STEP.createApplication);
  assert.equal(resolveResumeStep(null, STEP.applicationId), STEP.createApplication);
  // An active key and a finished wizard: setting up another starts over.
  assert.equal(resolveResumeStep(active, STEP.done), STEP.signIn);
});

test("a pending certificate resumes at the remembered step from 2 to 4, else at step 2", () => {
  assert.equal(resolveResumeStep(pending, null), STEP.createApplication);
  assert.equal(resolveResumeStep(pending, STEP.signIn), STEP.createApplication);
  assert.equal(resolveResumeStep(pending, STEP.createApplication), STEP.createApplication);
  assert.equal(resolveResumeStep(pending, STEP.activate), STEP.activate);
  assert.equal(resolveResumeStep(pending, STEP.applicationId), STEP.applicationId);
  assert.equal(resolveResumeStep(pending, STEP.done), STEP.createApplication);
});

test("the remembered step is per person, ignores junk, and survives blocked storage", () => {
  rememberStep("user-1", STEP.activate);
  assert.equal(readRememberedStep("user-1"), STEP.activate);
  assert.equal(readRememberedStep("user-2"), null);

  window.localStorage.setItem("wm:enable-banking-setup:step:user-2", "not-a-step");
  assert.equal(readRememberedStep("user-2"), null);

  forgetRememberedStep("user-1");
  assert.equal(readRememberedStep("user-1"), null);

  // Without a signed-in id nothing is read or written.
  rememberStep(undefined, STEP.activate);
  assert.equal(window.localStorage.length, 1);
  assert.equal(readRememberedStep(undefined), null);

  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  assert.doesNotThrow(() => rememberStep("user-1", STEP.activate));
  assert.equal(readRememberedStep("user-1"), null);
  assert.doesNotThrow(() => forgetRememberedStep("user-1"));
});

test.each([
  ["enable_banking_application_not_activated", STEP.activate],
  ["enable_banking_application_not_found", STEP.createApplication],
  ["enable_banking_application_sandbox", STEP.createApplication],
  ["enable_banking_pending_credential_missing", STEP.createApplication],
  ["enable_banking_credential_refused", STEP.createApplication],
  ["totp_required", null],
  ["invalid_totp", null],
  ["session_not_fresh", null],
  ["something_else", null],
])("%s points to step %s", (code, step) => {
  assert.equal(revisitStepForError({ response: { data: { code } } }), step);
});
