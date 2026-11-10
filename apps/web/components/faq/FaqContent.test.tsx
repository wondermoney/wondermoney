// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import { FaqContent } from "./FaqContent";

const instance = vi.hoisted(() => ({ sponsorUrl: null as null | string, supportEmail: null as null | string }));

vi.mock("@/lib/api/instance/useInstance", () => ({
  useSponsorUrl: () => instance.sponsorUrl,
  useSupportEmail: () => instance.supportEmail,
}));
vi.mock("@/lib/utils/useHydrated", () => ({ useHydrated: () => true }));
vi.mock("@/components/layout/Logo", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  instance.sponsorUrl = null;
  instance.supportEmail = null;
});

function renderFaq() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <FaqContent />
    </NextIntlClientProvider>,
  );
}

test("links to the instance's sponsor page when it has one", () => {
  instance.sponsorUrl = "https://opencollective.com/example";
  renderFaq();
  assert.ok(screen.getByText(enMessages.faq.supportTitle));
  assert.equal(screen.getByRole("link").getAttribute("href"), "https://opencollective.com/example");
});

test("leaves the question out on an instance with no sponsor page", () => {
  renderFaq();
  assert.equal(screen.queryByText(enMessages.faq.supportTitle), null);
  assert.equal(screen.queryByRole("link"), null);
});
