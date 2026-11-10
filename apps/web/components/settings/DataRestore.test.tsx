// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type {
  DataRestore as DataRestoreItem,
  DataRestoreOverview,
} from "@/lib/api/user/useDataRestore";

import enCommon from "../../messages/en/common.json";
import DataRestore, { shouldOfferRestore } from "./DataRestore";

const state = vi.hoisted(() => ({
  commit: vi.fn(),
  overview: null as DataRestoreOverview | null,
  reload: vi.fn(),
  upload: vi.fn(),
  validate: vi.fn(),
}));

vi.mock("@/lib/api/user/useDataRestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/user/useDataRestore")>()),
  useCommitDataRestore: () => ({ mutateAsync: state.commit, isPending: false }),
  useDataRestoreOverview: () => ({ data: state.overview }),
  useReloadAfterRestore: () => state.reload,
  useUploadDataRestore: () => ({ mutateAsync: state.upload, isPending: false }),
  useValidateDataRestore: () => ({
    mutateAsync: state.validate,
    isPending: false,
  }),
}));

afterEach(() => {
  cleanup();
  for (const mock of [state.commit, state.reload, state.upload, state.validate])
    mock.mockReset();
  state.overview = null;
});

const base: DataRestoreItem = {
  createdAt: "2026-11-09T10:00:00.000Z",
  encrypted: null,
  error: null,
  expiresAt: null,
  export: null,
  finishedAt: null,
  id: "user.data-restore:1",
  status: "awaiting_upload",
  summary: null,
  upload: null,
};

const eligible = (restore?: Partial<DataRestoreItem>): DataRestoreOverview => ({
  availability: { eligible: true, reason: null },
  restores: restore ? [{ ...base, ...restore }] : [],
});

function renderRestore(onRestored = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enCommon}>
      <DataRestore
        onRestored={onRestored}
        restoredAction={<span>onwards</span>}
      />
    </NextIntlClientProvider>,
  );
  return onRestored;
}

test("uploads the chosen file to be checked", async () => {
  state.overview = eligible();
  state.upload.mockResolvedValue({ ...base, status: "validating" });
  const user = userEvent.setup();
  renderRestore();
  const file = new File(["zip"], "wondermoney-export.zip", {
    type: "application/zip",
  });

  await user.upload(
    screen.getByLabelText(enCommon["privacy-data-restore-choose"]),
    file,
  );
  await user.click(
    screen.getByRole("button", { name: enCommon["privacy-data-restore-cta"] }),
  );

  await waitFor(() => assert.equal(state.upload.mock.calls.length, 1));
  assert.equal(state.upload.mock.calls[0][0], file);
});

test("asks for the password of a protected export and sends it with the check", async () => {
  state.overview = eligible({
    error: { code: "password_required" },
    status: "invalid",
  });
  state.validate.mockResolvedValue({ ...base, status: "validating" });
  const user = userEvent.setup();
  renderRestore();

  screen.getByText(enCommon["privacy-data-restore-error-password_required"]);
  await user.type(
    screen.getByLabelText(enCommon["privacy-data-restore-password"]),
    "a long enough backup password",
  );
  await user.click(
    screen.getByRole("button", {
      name: enCommon["privacy-data-restore-unlock"],
    }),
  );

  await waitFor(() => assert.equal(state.validate.mock.calls.length, 1));
  assert.deepEqual(state.validate.mock.calls[0][0], {
    id: base.id,
    password: "a long enough backup password",
  });
  // The password does not linger in the form.
  assert.equal(
    (
      screen.getByLabelText(
        enCommon["privacy-data-restore-password"],
      ) as HTMLInputElement
    ).value,
    "",
  );
});

test("shows what a checked file holds, with its warnings, before restoring it", async () => {
  state.overview = eligible({
    status: "ready",
    summary: {
      counts: { accounts: 3, transactions: 1204 },
      warnings: [
        { code: "bank_linked_accounts", count: 1, values: ["Current account"] },
      ],
    },
  });
  state.commit.mockResolvedValue({ ...base, status: "restoring" });
  const user = userEvent.setup();
  renderRestore();

  screen.getByText("1204");
  screen.getByText(/Current account/u);
  await user.click(
    screen.getByRole("button", {
      name: enCommon["privacy-data-restore-commit"],
    }),
  );

  await waitFor(() => assert.equal(state.commit.mock.calls.length, 1));
  assert.equal(state.commit.mock.calls[0][0], base.id);
});

test("explains why a file cannot be restored, and offers another", () => {
  state.overview = eligible({
    error: { code: "corrupt", file: "data/accounts.json" },
    status: "invalid",
  });

  renderRestore();

  screen.getByText(enCommon["privacy-data-restore-error-corrupt"]);
  screen.getByLabelText(enCommon["privacy-data-restore-choose"]);
});

test("reloads everything and moves on once the data is back", async () => {
  state.overview = {
    availability: { eligible: false, reason: "household_not_empty" },
    restores: [
      {
        ...base,
        status: "restored",
        summary: { counts: { accounts: 1 }, warnings: [] },
      },
    ],
  };

  const onRestored = renderRestore();

  await waitFor(() => assert.equal(onRestored.mock.calls.length, 1));
  assert.equal(state.reload.mock.calls.length, 1);
  screen.getByText("onwards");
});

test("is offered only while the household is empty, or while a restore is under way or just done", () => {
  assert.equal(shouldOfferRestore(eligible()), true);
  assert.equal(
    shouldOfferRestore({
      availability: { eligible: false, reason: "household_not_empty" },
      restores: [],
    }),
    false,
  );
  assert.equal(
    shouldOfferRestore({
      availability: { eligible: false, reason: "household_not_empty" },
      restores: [{ ...base, status: "restored" }],
    }),
    true,
  );
  assert.equal(
    shouldOfferRestore({
      availability: { eligible: false, reason: "owner_required" },
      restores: [],
    }),
    false,
  );
});
