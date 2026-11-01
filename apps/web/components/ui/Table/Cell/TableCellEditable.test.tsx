// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, test, vi } from "vitest";

import type { Row } from "../features";
import TableCellEditable from "./TableCellEditable";

afterEach(cleanup);

type Data = { key: number };
const row = { id: "0", original: { key: 1 }, depth: 0 } as Row<Data>;

async function editAndBlur(updateData: (row: Row<Data>, columnId: string, value: string) => boolean | void) {
  render(
    <>
      <TableCellEditable row={row} column={{ id: "budgeted" }} value="10.00" updateData={updateData} />
      <button type="button">elsewhere</button>
    </>,
  );
  const input = screen.getByRole("textbox") as HTMLInputElement;
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
