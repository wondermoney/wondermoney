// @vitest-environment jsdom
import assert from "node:assert/strict";

import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { test, vi } from "vitest";

import messages from "../../../messages/en/common.json";
import TickerExplorerAutoComplete from "../TickerExplorerAutoComplete";

vi.mock("@/lib/api/financial-markets/useTickerSearch", () => ({
  getTickerSearch: async () => [],
}));

function Explorer() {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <TickerExplorerAutoComplete onTickerSelected={() => {}} />
    </NextIntlClientProvider>
  );
}

test("the explorer search box hydrates without a mismatch, however many pages the server rendered first", async () => {
  // A long-lived server renders the box for many visitors before this one.
  renderToString(<Explorer />);
  renderToString(<Explorer />);
  const container = document.createElement("div");
  container.innerHTML = renderToString(<Explorer />);
  document.body.appendChild(container);

  const recoverableErrors: unknown[] = [];
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => {
    hydrateRoot(container, <Explorer />, {
      onRecoverableError: (error) => recoverableErrors.push(error),
    });
  });
  const hydrationLogs = consoleError.mock.calls.filter((args) =>
    /hydrat/i.test(String(args[0])),
  );
  consoleError.mockRestore();

  assert.deepEqual(recoverableErrors, []);
  assert.deepEqual(hydrationLogs, []);
  assert.ok(container.querySelector('input[type="search"]'));
});
