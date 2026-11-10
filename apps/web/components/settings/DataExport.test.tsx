// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { DataExport as DataExportItem } from "@/lib/api/user/useDataExport";

import enCommon from "../../messages/en/common.json";
import DataExport from "./DataExport";

const state = vi.hoisted(() => ({
  latest: null as DataExportItem | null,
  start: vi.fn(),
}));

vi.mock("@/lib/api/user/useDataExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/user/useDataExport")>()),
  downloadStreamedDataExport: vi.fn(),
  useLatestDataExport: () => ({ data: state.latest }),
  useRefreshDataExports: () => () => Promise.resolve(),
  useStartDataExport: () => ({ mutateAsync: state.start, isPending: false }),
}));

afterEach(() => {
  cleanup();
  state.start.mockReset();
  state.latest = null;
});

const queued: DataExportItem = {
  createdAt: "2026-11-08T10:00:00.000Z",
  delivery: "storage",
  downloadUrl: null,
  encrypted: true,
  expiresAt: null,
  fileName: "wondermoney-export-2026-11-08.zip",
  finishedAt: null,
  id: "user.data-export:1",
  status: "queued",
};

function renderExport() {
  render(
    <NextIntlClientProvider locale="en" messages={enCommon}>
      <DataExport />
    </NextIntlClientProvider>,
  );
}

async function protectWith(password: string, confirmation = password) {
  const user = userEvent.setup();
  renderExport();
  await user.click(
    screen.getByRole("checkbox", { name: enCommon["privacy-data-export-protect"] }),
  );
  await user.type(
    screen.getByLabelText(enCommon["privacy-data-export-password"]),
    password,
  );
  await user.type(
    screen.getByLabelText(enCommon["privacy-data-export-password-confirm"]),
    confirmation,
  );
  await user.click(
    screen.getByRole("button", { name: enCommon["privacy-data-export-cta"] }),
  );
}

test("starts an unprotected export by default", async () => {
  state.start.mockResolvedValue({ ...queued, encrypted: false });
  const user = userEvent.setup();
  renderExport();

  await user.click(
    screen.getByRole("button", { name: enCommon["privacy-data-export-cta"] }),
  );

  await waitFor(() => assert.equal(state.start.mock.calls.length, 1));
  assert.deepEqual(state.start.mock.calls[0][0], {});
});

test("sends the password with the request that starts a protected export", async () => {
  state.start.mockResolvedValue(queued);

  await protectWith("correct horse battery staple");

  await waitFor(() => assert.equal(state.start.mock.calls.length, 1));
  assert.deepEqual(state.start.mock.calls[0][0], {
    password: "correct horse battery staple",
  });
});

test("refuses a password shorter than 16 characters before asking the API", async () => {
  await protectWith("fifteen chars!!");

  screen.getByRole("alert");
  assert.equal(state.start.mock.calls.length, 0);
});

test("refuses passwords that do not match before asking the API", async () => {
  await protectWith("correct horse battery staple", "correct horse battery stapel");

  screen.getByText(enCommon["privacy-data-export-password-mismatch"]);
  assert.equal(state.start.mock.calls.length, 0);
});

test("says when the export being prepared is password protected", () => {
  state.latest = queued;

  renderExport();

  screen.getByText(enCommon["privacy-data-export-protected"]);
});
