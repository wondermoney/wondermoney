// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { Tag } from "@/lib/api/tag/useTags";

import enCommon from "../../messages/en/common.json";
import enTransactions from "../../messages/en/transactions.json";
import { TagChipList } from "./TagChip";
import { TagPicker } from "./TagPicker";

const state = vi.hoisted(() => ({
  tags: [] as Tag[],
  create: vi.fn(),
  getTags: vi.fn(),
}));

vi.mock("@/lib/api/tag/useTags", () => ({
  MAX_TAGS_PER_TRANSACTION: 50,
  tagsKey: ["tags"],
  default: () => ({
    data: { tags: state.tags },
    isLoading: false,
    isError: false,
  }),
  getTags: state.getTags,
  useCreateTag: () => ({ mutateAsync: state.create, isPending: false }),
}));

beforeAll(() => {
  // jsdom lacks the layout APIs that Radix Popper and cmdk call.
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
  state.create.mockReset();
  state.getTags.mockReset();
});

const trip: Tag = { tagKey: 1, name: "Trip to Porto", color: "#ef4444" };
const work: Tag = { tagKey: 2, name: "Work", color: "#94a3b8" };

/** The picker, controlled, with the latest selection exposed for assertions. */
function renderPicker(initial: number[] = []) {
  const seen: number[][] = [];
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <TagPicker
        value={value}
        onChange={(next) => {
          seen.push(next);
          setValue(next);
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enTransactions }}
      >
        <Harness />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { seen };
}

test("adds and removes tags from the household list", async () => {
  state.tags = [trip, work];
  const user = userEvent.setup();
  const { seen } = renderPicker([2]);

  // The trigger names what is chosen, so a screen reader hears the value.
  await user.click(screen.getByRole("combobox", { name: "Tags, Work" }));
  await user.click(
    await screen.findByRole("option", { name: /Trip to Porto/ }),
  );
  assert.deepEqual(seen.at(-1), [2, 1]);

  await user.click(screen.getByRole("option", { name: /Work/ }));
  assert.deepEqual(seen.at(-1), [1]);
});

test("creates a tag inline from a name no tag has yet and selects it", async () => {
  state.tags = [work];
  state.create.mockResolvedValue({
    tagKey: 9,
    name: "Holiday",
    color: "#94a3b8",
  });
  const user = userEvent.setup();
  const { seen } = renderPicker();

  await user.click(screen.getByRole("combobox", { name: "Tags, none" }));
  await user.type(
    screen.getByPlaceholderText("Search or create a tag…"),
    "  Holiday ",
  );
  await user.click(
    await screen.findByRole("option", { name: "Create tag “Holiday”" }),
  );

  await waitFor(() => assert.deepEqual(seen.at(-1), [9]));
  assert.deepEqual(state.create.mock.calls[0][0], { name: "Holiday" });
});

test("offers no create for a name that differs from an existing tag only in case", async () => {
  state.tags = [work];
  const user = userEvent.setup();
  renderPicker();

  await user.click(screen.getByRole("combobox", { name: "Tags, none" }));
  await user.type(
    screen.getByPlaceholderText("Search or create a tag…"),
    "WORK",
  );

  assert.equal(screen.queryByRole("option", { name: /Create tag/ }), null);
  screen.getByRole("option", { name: /Work/ });
});

test("a name another member just took selects their tag instead of failing", async () => {
  state.tags = [];
  state.create.mockRejectedValue({
    response: {
      status: 409,
      data: { code: "tag_name_taken", message: "taken" },
    },
  });
  state.getTags.mockResolvedValue({
    tags: [{ tagKey: 4, name: "Groceries", color: "#22c55e" }],
  });
  const user = userEvent.setup();
  const { seen } = renderPicker();

  await user.click(screen.getByRole("combobox", { name: "Tags, none" }));
  await user.type(
    screen.getByPlaceholderText("Search or create a tag…"),
    "groceries",
  );
  await user.click(
    await screen.findByRole("option", { name: "Create tag “groceries”" }),
  );

  await waitFor(() => assert.deepEqual(seen.at(-1), [4]));
});

test("a chip list collapses the overflow into a count", () => {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...enCommon, ...enTransactions }}
    >
      <TagChipList
        tags={[
          trip,
          work,
          { tagKey: 3, name: "Gifts", color: "#000000" },
          { tagKey: 4, name: "Kids", color: "#ffffff" },
        ]}
        max={2}
      />
    </NextIntlClientProvider>,
  );

  const list = screen.getByRole("list", {
    name: "Tags: Trip to Porto, Work, Gifts, Kids",
  });
  assert.equal(list.querySelectorAll('[role="listitem"]').length, 3);
  screen.getByText("+2");
  assert.equal(screen.queryByText("Gifts"), null);
});
