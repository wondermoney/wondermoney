// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import OpenBankingNotice from "./OpenBankingNotice";

const instance = vi.hoisted(() => ({
  privacyUrl: null as null | string,
  termsUrl: null as null | string,
}));

vi.mock("@/lib/instance", () => ({ instanceConfig: instance }));

afterEach(() => {
  cleanup();
  instance.privacyUrl = null;
  instance.termsUrl = null;
});

function renderNotice() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OpenBankingNotice />
    </NextIntlClientProvider>,
  );
}

test("an instance without published terms links to no legal pages", () => {
  renderNotice();

  assert.equal(screen.queryByRole("link", { name: "Terms of Service" }), null);
  assert.equal(screen.queryByRole("link", { name: "Privacy Policy" }), null);
  assert.ok(screen.getByRole("link", { name: "Enable Banking" }));
});

test("an instance with published terms links to its own legal pages", () => {
  instance.termsUrl = "https://example.org/terms";
  instance.privacyUrl = "https://example.org/privacy";

  renderNotice();

  assert.equal(
    screen.getByRole("link", { name: "Terms of Service" }).getAttribute("href"),
    "https://example.org/terms",
  );
  assert.equal(
    screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href"),
    "https://example.org/privacy",
  );
});
