// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import enMessages from "../../messages/en/common.json";
import { PreviewPill } from "./PreviewPill";

afterEach(cleanup);

test("names the gated entry point in the reader's language", () => {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PreviewPill />
    </NextIntlClientProvider>,
  );

  assert.ok(screen.getByText("Preview"));
});
