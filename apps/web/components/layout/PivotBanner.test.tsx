// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import PivotBanner from "./PivotBanner";

vi.mock("@/components/ui/Link", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(cleanup);

function renderBanner(props: { enabled?: boolean } = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PivotBanner {...props} />
    </NextIntlClientProvider>,
  );
}

test("the hosted service shows its open-source announcement", () => {
  renderBanner({ enabled: true });
  assert.ok(screen.queryByText(enMessages.pivotBanner.message));
});

test("an instance that has not turned the announcement on shows nothing", () => {
  renderBanner({ enabled: false });
  assert.equal(screen.queryByText(enMessages.pivotBanner.message), null);
});

test("a build without NEXT_PUBLIC_SHOW_PIVOT_BANNER shows nothing", () => {
  renderBanner();
  assert.equal(screen.queryByText(enMessages.pivotBanner.message), null);
});
