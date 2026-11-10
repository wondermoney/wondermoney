// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import EmailVerificationNotice from "./EmailVerificationNotice";

const auth = vi.hoisted(() => ({ sendVerificationEmail: vi.fn() }));

vi.mock("@/lib/auth/client", () => ({ authClient: auth }));
vi.mock("@/lib/auth/user-context", () => ({
  useUser: () => ({ email: "ana@example.test", email_confirmed_at: null, id: "u1" }),
}));

beforeEach(() => auth.sendVerificationEmail.mockReset());
afterEach(cleanup);

function renderNotice() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <EmailVerificationNotice />
    </NextIntlClientProvider>,
  );
}

test("names the address the link went to", () => {
  renderNotice();
  assert.ok(screen.getByTestId("email-verification-notice").textContent?.includes("ana@example.test"));
});

test("resends the link to the signed-in address and confirms it went", async () => {
  auth.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
  renderNotice();

  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => assert.ok(screen.getByRole("status")));
  assert.deepEqual(auth.sendVerificationEmail.mock.calls[0]?.[0], { email: "ana@example.test" });
  assert.equal(screen.queryByRole("button"), null);
});

test("says so when the resend fails, and lets the user try again", async () => {
  auth.sendVerificationEmail.mockResolvedValue({ data: null, error: { status: 429 } });
  renderNotice();

  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => assert.ok(screen.getByRole("alert")));
  assert.equal((screen.getByRole("button") as HTMLButtonElement).disabled, false);
});
