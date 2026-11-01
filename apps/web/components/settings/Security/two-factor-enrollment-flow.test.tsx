// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../../messages/en/common.json";
import esMessages from "../../../messages/es/common.json";
import ptMessages from "../../../messages/pt/common.json";
import { useTwoFactorEnrollmentFlow } from "./useTwoFactorEnrollmentFlow";

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    twoFactor: {
      enable: vi.fn(async () => ({
        data: {
          method: "totp",
          totpURI: "otpauth://totp/WonderMoney:test?secret=JBSWY3DPEHPK3PXP",
          backupCodes: ["aaaa-bbbb", "cccc-dddd"],
        },
        error: null,
      })),
      verifyTotp: vi.fn(),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// input-otp polls the caret position; jsdom has no layout.
document.elementFromPoint = () => null;

afterEach(cleanup);

/** Lays the hook out the way the dialog does: description, step body, footer outside the form. */
function Flow() {
  const { stepDescription, content, footer } = useTwoFactorEnrollmentFlow();
  return (
    <div>
      <p data-testid="description">{stepDescription}</p>
      {content}
      {footer}
    </div>
  );
}

const locales = [
  { locale: "en", messages: enMessages },
  { locale: "pt", messages: ptMessages },
  { locale: "es", messages: esMessages },
] as const;

for (const { locale, messages } of locales) {
  test(`each enrolment step describes what is on screen (${locale})`, async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <Flow />
      </NextIntlClientProvider>,
    );
    const description = () => screen.getByTestId("description").textContent;

    await user.type(screen.getByPlaceholderText(messages.password), "password");
    await user.click(screen.getByRole("button", { name: messages.submit }));

    // The QR code is on the setup step, so that is where the scan instruction belongs.
    await waitFor(() => assert.ok(document.querySelector("svg")));
    assert.equal(description(), messages["scan-qr-code-using-mfa-app"]);

    const continueButton = screen.getByRole("button", { name: messages.continue });
    await user.click(continueButton);

    // The verify step has no QR code: it asks for the code, and nothing has been typed yet, so
    // there is nothing to complain about.
    await waitFor(() => assert.equal(description(), messages["2fa-verify-description"]));
    assert.equal(document.querySelector("svg"), null);
    // In a real browser React re-renders between the click handler and the click's default
    // action. Had the Continue button been reused as the verify form's submit button, that
    // default action would submit the empty code and show a length error straight away. jsdom
    // runs the default action first, so check the button was replaced rather than reused.
    assert.equal(continueButton.isConnected, false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(document.querySelector('[id$="-form-item-message"]'), null);
  });
}
