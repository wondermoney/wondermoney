// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { Tag } from "@/lib/api/tag/useTags";

import enCommon from "../../messages/en/common.json";
import enTransactions from "../../messages/en/transactions.json";
import Tags from "./Tags";

const state = vi.hoisted(() => ({
  tags: [] as Tag[],
  create: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/api/tag/useTags", () => ({
  DEFAULT_TAG_COLOR: "#94a3b8",
  MAX_TAGS_PER_TRANSACTION: 50,
  tagsKey: ["tags"],
  default: () => ({
    data: { tags: state.tags },
    isLoading: false,
    isError: false,
    refetch: () => {},
  }),
  getTags: vi.fn(),
  invalidateTags: state.invalidate,
  useCreateTag: () => ({ mutateAsync: state.create, isPending: false }),
  useEditTag: () => ({ mutateAsync: state.edit, isPending: false }),
  useDeleteTag: () => ({ mutateAsync: state.remove, isPending: false }),
}));

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
  for (const mock of [state.create, state.edit, state.remove, state.invalidate])
    mock.mockReset();
});

const m = enTransactions.transactionTags;

function renderTags(tags: Tag[]) {
  state.tags = tags;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enTransactions }}
      >
        <Tags />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const trip: Tag = { tagKey: 1, name: "Trip", color: "#ef4444" };
const work: Tag = { tagKey: 2, name: "Work", color: "#94a3b8" };

test("renames a tag, sending only the field that changed", async () => {
  state.edit.mockResolvedValue({ ...trip, name: "Porto trip" });
  const user = userEvent.setup();
  renderTags([trip, work]);

  await user.click(screen.getByRole("button", { name: "Edit Trip" }));
  const [name] = screen.getAllByLabelText(m.name);
  await user.clear(name);
  await user.type(name, "Porto trip");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => assert.equal(state.edit.mock.calls.length, 1));
  assert.deepEqual(state.edit.mock.calls[0][0], {
    tagKey: 1,
    name: "Porto trip",
  });
  assert.equal(state.invalidate.mock.calls.length, 1);
});

test("refuses a rename onto another tag's name before asking the API", async () => {
  const user = userEvent.setup();
  renderTags([trip, work]);

  await user.click(screen.getByRole("button", { name: "Edit Trip" }));
  const [name] = screen.getAllByLabelText(m.name);
  await user.clear(name);
  await user.type(name, "work ");
  await user.click(screen.getByRole("button", { name: "Save" }));

  screen.getByText(m.errors["name-taken"]);
  assert.equal(state.edit.mock.calls.length, 0);
});

test("deletes a tag only after confirming", async () => {
  state.remove.mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderTags([trip, work]);

  await user.click(screen.getByRole("button", { name: "Delete Work" }));
  screen.getByText(m["delete-description"]);
  assert.equal(state.remove.mock.calls.length, 0);
  await user.click(screen.getByRole("button", { name: m.delete }));

  await waitFor(() => assert.deepEqual(state.remove.mock.calls[0], [2]));
});

test("adds a tag with the default colour", async () => {
  state.create.mockResolvedValue({
    tagKey: 3,
    name: "Gifts",
    color: "#94a3b8",
  });
  const user = userEvent.setup();
  renderTags([]);

  screen.getByText(m["empty-settings"]);
  await user.type(screen.getByLabelText(m.name), "Gifts");
  await user.click(screen.getByRole("button", { name: m.add }));

  await waitFor(() =>
    assert.deepEqual(state.create.mock.calls[0][0], {
      name: "Gifts",
      color: "#94a3b8",
    }),
  );
});
