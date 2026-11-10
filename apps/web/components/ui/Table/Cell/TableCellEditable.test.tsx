// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { Row } from "../features";
import TableCellEditable from "./TableCellEditable";

afterEach(cleanup);

type Data = { key: number };
const row = { id: "0", original: { key: 1 }, depth: 0 } as Row<Data>;
type UpdateData = (row: Row<Data>, columnId: string, value: string) => boolean | void;

function renderCell(value: string | number, updateData: UpdateData, locale = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <TableCellEditable row={row} column={{ id: "budgeted" }} value={value} updateData={updateData} />
      <button type="button">elsewhere</button>
    </NextIntlClientProvider>,
  );
  return screen.getByRole("textbox") as HTMLInputElement;
}

async function editAndBlur(updateData: UpdateData) {
  const input = renderCell("10.00", updateData);
  await userEvent.clear(input);
  await userEvent.type(input, "0");
  await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));
  return input;
}

test("a rejected commit puts the previous value back in the cell", async () => {
  const updateData = vi.fn(() => false);
  const input = await editAndBlur(updateData);

  assert.deepEqual(updateData.mock.calls, [[row, "budgeted", "0"]]);
  assert.equal(input.value, "10.00");
});

test("an accepted commit keeps what the user typed", async () => {
  const input = await editAndBlur(() => true);

  assert.equal(input.value, "0");
});

/*
 * A pt reader writes 1.234 as "1,234"; shown as "1.234" and committed untouched, the budget
 * would be read back as 1234.
 */
test("a number is shown and committed in the reader's format", async () => {
  const updateData = vi.fn(() => true);
  const input = renderCell(1.234, updateData, "pt");

  assert.equal(input.value, "1,234");
  await userEvent.click(input);
  await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));

  assert.deepEqual(updateData.mock.calls, [[row, "budgeted", "1,234"]]);
});
