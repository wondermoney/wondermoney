// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import MfaForm from "./MfaForm";

const APP_ORIGIN = "http://localhost:3000";

const { apiPost, authClient } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  authClient: {
    twoFactor: { verifyBackupCode: vi.fn(), verifyTotp: vi.fn() },
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
}));
vi.mock("@/lib/auth/client", () => ({ authClient }));
vi.mock("@/lib/api/api", () => ({ default: { post: apiPost } }));

// input-otp polls the caret position; jsdom has no layout.
document.elementFromPoint = () => null;

const originalLocation = window.location;
const assign = vi.fn();

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...originalLocation,
      assign,
      origin: APP_ORIGIN,
      search: `?next=${encodeURIComponent("/en/budgets")}`,
    },
  });
  apiPost.mockResolvedValue({ data: { outcome: "login", method: "email" } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MfaForm />
    </NextIntlClientProvider>,
  );
}

function switchToBackupCode(): HTMLInputElement {
  fireEvent.click(screen.getByRole("button", { name: enMessages["mfa-use-backup-code"] }));
  return screen.getByLabelText(enMessages["mfa-backup-code-label"]) as HTMLInputElement;
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: enMessages.submit }));
}

test("a backup code signs in through verifyBackupCode and returns to next", async () => {
  authClient.twoFactor.verifyBackupCode.mockResolvedValue({ data: {}, error: null });
  renderForm();

  const input = switchToBackupCode();
  fireEvent.change(input, { target: { value: " abcde12345 " } });
  submit();

  await waitFor(() => assert.equal(assign.mock.calls.length, 1));
  assert.deepEqual(authClient.twoFactor.verifyBackupCode.mock.calls, [[{ code: "abcde-12345" }]]);
  assert.equal(authClient.twoFactor.verifyTotp.mock.calls.length, 0);
  assert.equal(String(assign.mock.calls[0]![0]), `${APP_ORIGIN}/en/budgets`);
});

test("a refused backup code is cleared and explained, and nobody is signed in", async () => {
  authClient.twoFactor.verifyBackupCode.mockResolvedValue({
    data: null,
    error: { code: "INVALID_BACKUP_CODE", status: 401, message: "Invalid backup code" },
  });
  renderForm();

  const input = switchToBackupCode();
  fireEvent.change(input, { target: { value: "abcde-12345" } });
  submit();

  await screen.findByText(enMessages["mfa-backup-code-invalid"]);
  assert.equal(input.value, "");
  assert.equal(apiPost.mock.calls.length, 0);
  assert.equal(assign.mock.calls.length, 0);
});

test("too many wrong codes sends the person back to login", async () => {
  authClient.twoFactor.verifyBackupCode.mockResolvedValue({
    data: null,
    error: { code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", status: 400 },
  });
  renderForm();

  fireEvent.change(switchToBackupCode(), { target: { value: "abcde-12345" } });
  submit();

  await screen.findByText(enMessages["mfa-error-too-many-attempts"]);
});

test("an empty backup code is not sent", async () => {
  renderForm();

  switchToBackupCode();
  submit();

  await screen.findByText(enMessages["mfa-backup-code-required"]);
  assert.equal(authClient.twoFactor.verifyBackupCode.mock.calls.length, 0);
});

test("the authenticator code is one click away, and the typed backup code does not survive the switch", () => {
  renderForm();

  fireEvent.change(switchToBackupCode(), { target: { value: "abcde-12345" } });
  fireEvent.click(screen.getByRole("button", { name: enMessages["mfa-use-authenticator-code"] }));

  assert.ok(screen.getByText(enMessages["enter-code-from-authenticator-app"]));
  assert.equal(screen.queryByLabelText(enMessages["mfa-backup-code-label"]), null);

  const input = switchToBackupCode();
  assert.equal(input.value, "");
});

test("a refused authenticator code is cleared and its message stays on screen", async () => {
  authClient.twoFactor.verifyTotp.mockResolvedValue({
    data: null,
    error: { code: "INVALID_CODE", status: 401 },
  });
  renderForm();

  const input = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "123456" } });
  submit();

  await screen.findByText(enMessages["invalid-code"]);
  assert.equal(input.value, "");
  assert.equal(authClient.twoFactor.verifyBackupCode.mock.calls.length, 0);
});
