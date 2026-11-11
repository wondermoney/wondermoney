// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import enCommon from "../../messages/en/common.json";
import enRules from "../../messages/en/rules.json";
import { ImportRulesDialog } from "./ImportRulesDialog";

const state = vi.hoisted(() => ({ importRules: vi.fn() }));

vi.mock("@/lib/api/rule/useRules", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    importRules: state.importRules,
    useImportRules: () => ({ isPending: false, mutateAsync: state.importRules }),
  };
});

const file = { format: "wondermoney-rules", rules: [], version: 1 };

const plan = {
  categoriesToCreate: [] as string[],
  creates: [{ active: true, name: "Spotify" }],
  dryRun: true,
  duplicates: [{ name: "Netflix" }],
  imported: 0,
  mode: "append" as const,
  removed: 0,
  unresolved: [
    { kind: "category" as const, reference: "Missing", ruleName: "Missing rule" },
  ],
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  state.importRules.mockReset();
});

function renderDialog(onImported = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ ...enCommon, ...enRules }}>
        <ImportRulesDialog open onOpenChange={vi.fn()} onImported={onImported} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onImported };
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText(enRules.rules.import["file-label"]),
    new File([JSON.stringify(file)], "rules.json", {
      type: "application/json",
    }),
  );
}

test("a chosen file is checked and its summary shown before anything is written", async () => {
  state.importRules.mockResolvedValue(plan);
  const user = userEvent.setup();
  renderDialog();

  await chooseFile(user);

  await screen.findByText("1 rule will be created");
  screen.getByText("1 rule already exists and will be skipped");
  screen.getByText("1 reference was not found");
  screen.getByText("Category: Missing — Missing rule");
  assert.deepEqual(state.importRules.mock.calls[0]?.[0], {
    createCategories: false,
    dryRun: true,
    file,
    mode: "append",
  });
  assert.equal(
    state.importRules.mock.calls.filter(
      ([request]) => request.dryRun === false,
    ).length,
    0,
  );
});

test("confirming imports with the dry run's choices", async () => {
  state.importRules
    .mockResolvedValueOnce(plan)
    .mockResolvedValueOnce({ ...plan, dryRun: false, imported: 1 });
  const user = userEvent.setup();
  const { onImported } = renderDialog();

  await chooseFile(user);
  await screen.findByText("1 rule will be created");
  await user.click(screen.getByRole("button", { name: "Import 1 rule" }));

  await waitFor(() => assert.equal(state.importRules.mock.calls.length, 2));
  assert.deepEqual(state.importRules.mock.calls[1]?.[0], {
    confirm: false,
    createCategories: false,
    dryRun: false,
    file,
    mode: "append",
  });
  assert.equal(onImported.mock.calls.length, 1);
});

test("replace mode says how many rules it removes and confirms the replacement", async () => {
  state.importRules
    .mockResolvedValueOnce({ ...plan, removed: 0 })
    .mockResolvedValueOnce({ ...plan, removed: 3 })
    .mockResolvedValueOnce({
      ...plan,
      dryRun: false,
      imported: 1,
      mode: "replace",
      removed: 3,
    });
  const user = userEvent.setup();
  renderDialog();

  await chooseFile(user);
  await screen.findByText("1 rule will be created");
  await user.click(
    screen.getByRole("combobox", {
      name: enRules.rules.import["mode-label"],
    }),
  );
  await user.click(
    await screen.findByRole("option", {
      name: enRules.rules.import["mode-replace"],
    }),
  );

  await screen.findByText("This removes the 3 rules already here.");
  await user.click(
    screen.getByRole("button", { name: "Replace with 1 rule" }),
  );

  await waitFor(() => assert.equal(state.importRules.mock.calls.length, 3));
  assert.deepEqual(state.importRules.mock.calls[2]?.[0], {
    confirm: true,
    createCategories: false,
    dryRun: false,
    file,
    mode: "replace",
  });
});

test("creating the missing categories re-checks the file with them", async () => {
  state.importRules
    .mockResolvedValueOnce({
      ...plan,
      categoriesToCreate: ["Brand new"],
      creates: [],
      unresolved: [
        { kind: "category", reference: "Brand new", ruleName: "New" },
      ],
    })
    .mockResolvedValueOnce({
      ...plan,
      categoriesToCreate: ["Brand new"],
      creates: [{ active: true, name: "New" }],
      unresolved: [],
    });
  const user = userEvent.setup();
  renderDialog();

  await chooseFile(user);
  const checkbox = await screen.findByRole("checkbox", {
    name: "Create the missing categories: Brand new",
  });
  await user.click(checkbox);

  await waitFor(() => assert.equal(state.importRules.mock.calls.length, 2));
  assert.equal(state.importRules.mock.calls[1]?.[0].createCategories, true);
  await screen.findByText("1 rule will be created");
});

test("a file that is not JSON is refused before it is sent", async () => {
  const user = userEvent.setup();
  renderDialog();

  await user.upload(
    screen.getByLabelText(enRules.rules.import["file-label"]),
    new File(["not json"], "rules.json", { type: "application/json" }),
  );

  await screen.findByText(enRules.rules.import["file-invalid"]);
  assert.equal(state.importRules.mock.calls.length, 0);
});
