// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import { queryClientWithInstance } from "@/lib/api/instance/instance-fixture";

import enCommon from "../../messages/en/common.json";
import VersionInfo from "./VersionInfo";

// The build under test is a release, so a different server version is comparable.
vi.mock("@/lib/version", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/version")>();
  return {
    ...actual,
    appBuild: { commit: "abc1234", version: "1.1.0" },
  };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const writeText = vi.fn().mockResolvedValue(undefined);

beforeAll(() => {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});
afterEach(() => {
  cleanup();
  writeText.mockClear();
});

function renderVersionInfo(serverVersion: string) {
  render(
    <QueryClientProvider
      client={queryClientWithInstance(undefined, {
        commit: "def5678",
        version: serverVersion,
      })}
    >
      <NextIntlClientProvider locale="en" messages={enCommon}>
        <VersionInfo />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("shows no mismatch note when the web app and the server run the same version", () => {
  renderVersionInfo("1.1.0");

  assert.equal(screen.queryByText(enCommon.version.mismatch), null);
});

test("shows a mismatch note when the web app and the server run different versions", () => {
  renderVersionInfo("1.0.0");

  screen.getByText(enCommon.version.mismatch);
});

test("the copy action writes one line with both versions and commits", async () => {
  renderVersionInfo("1.0.0");

  fireEvent.click(screen.getByRole("button", { name: enCommon.version.copy }));

  assert.equal(
    writeText.mock.calls[0]?.[0],
    "WonderMoney app 1.1.0 (abc1234), server 1.0.0 (def5678)",
  );
});
