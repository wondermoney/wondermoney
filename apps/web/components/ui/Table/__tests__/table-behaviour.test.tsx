// @vitest-environment jsdom
import assert from "node:assert/strict";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createRef, type ReactNode, useState } from "react";
import { afterEach, test, vi } from "vitest";

import { Table } from "@/components/ui/Table";
import {
  type ColumnDef,
  createColumnHelper,
  type Row,
  type Table as TableInstance,
} from "@/components/ui/Table/features";

// What a user gets from the shared <Table> that every list in the app renders
// through: which rows show, in what order, and what selecting or expanding
// them does. These depend on TanStack Table v9 specifics (features registered
// up front, row models not switched off by leaving them out).

vi.mock("next/navigation", () => ({
  usePathname: () => "/en/test",
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

interface Item {
  name: string;
  amount: number;
  subRows?: Item[];
}

const helper = createColumnHelper<Item>();

const columns: ColumnDef<Item>[] = [
  helper.display({
    id: "expand",
    cell: ({ row }) =>
      row.getCanExpand() ? (
        <button type="button" onClick={row.getToggleExpandedHandler()}>
          {`toggle ${row.original.name}`}
        </button>
      ) : null,
  }),
  helper.display({
    id: "select",
    cell: ({ row }) => (
      <input
        type="checkbox"
        aria-label={`select ${row.original.name}`}
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
      />
    ),
  }),
  helper.accessor("name", {
    header: ({ column }) => (
      <button
        type="button"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        sort by name
      </button>
    ),
    cell: ({ getValue }) => <span data-testid="name">{getValue()}</span>,
  }),
  helper.accessor("amount", { cell: ({ getValue }) => getValue() }),
];

const items: Item[] = Array.from({ length: 25 }, (_, index) => ({
  name: `Item ${String(25 - index).padStart(2, "0")}`,
  amount: index,
}));

function renderTable(table: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={{}} onError={() => {}}>
      {table}
    </NextIntlClientProvider>,
  );
}

const shownNames = () =>
  screen.queryAllByTestId("name").map((cell) => cell.textContent);

test("a table without pagination shows every row", () => {
  renderTable(<Table columns={columns} data={items} />);

  assert.equal(shownNames().length, 25);
});

test("a paginated table shows ten rows a page and moves to the next page", () => {
  renderTable(<Table columns={columns} data={items} withPagination />);

  assert.deepEqual(
    shownNames(),
    items.slice(0, 10).map((item) => item.name),
  );

  fireEvent.click(screen.getByText("go-to-next-page").closest("button")!);

  assert.deepEqual(
    shownNames(),
    items.slice(10, 20).map((item) => item.name),
  );
});

test("sorting reorders the rows only when the table allows it", () => {
  renderTable(<Table columns={columns} data={items.slice(0, 3)} withSorting />);
  assert.deepEqual(shownNames(), ["Item 25", "Item 24", "Item 23"]);

  fireEvent.click(screen.getByText("sort by name"));
  assert.deepEqual(shownNames(), ["Item 23", "Item 24", "Item 25"]);

  cleanup();
  renderTable(<Table columns={columns} data={items.slice(0, 3)} />);
  fireEvent.click(screen.getByText("sort by name"));
  assert.deepEqual(shownNames(), ["Item 25", "Item 24", "Item 23"]);
});

const grouped: Item[] = [
  {
    name: "Housing",
    amount: 900,
    subRows: [
      { name: "Rent", amount: 800 },
      { name: "Utilities", amount: 100 },
    ],
  },
  { name: "Leisure", amount: 50 },
];

test("expandable rows hide their sub-rows until expanded", () => {
  renderTable(<Table columns={columns} data={grouped} withExpandableRows />);
  assert.deepEqual(shownNames(), ["Housing", "Leisure"]);

  fireEvent.click(screen.getByText("toggle Housing"));
  assert.deepEqual(shownNames(), ["Housing", "Rent", "Utilities", "Leisure"]);
});

test("defaultExpanded opens every group on first render", () => {
  renderTable(
    <Table
      columns={columns}
      data={grouped}
      withExpandableRows
      defaultExpanded
    />,
  );

  assert.deepEqual(shownNames(), ["Housing", "Rent", "Utilities", "Leisure"]);
});

test("selecting rows reports them, and the table ref can clear the selection", () => {
  const selections: string[][] = [];
  const tableRef = createRef<TableInstance<Item> | null>() as {
    current: TableInstance<Item> | null;
  };
  renderTable(
    <Table
      columns={columns}
      data={items.slice(0, 3)}
      withSelectRow
      withMultiSelectRow
      tableRef={tableRef}
      onRowSelectionChange={(rows: Row<Item>[]) =>
        selections.push(rows.map((row) => row.original.name))
      }
    />,
  );

  fireEvent.click(screen.getByLabelText("select Item 24"));
  fireEvent.click(screen.getByLabelText("select Item 23"));
  assert.deepEqual(selections.at(-1), ["Item 24", "Item 23"]);

  act(() => tableRef.current?.resetRowSelection());
  assert.deepEqual(selections.at(-1), []);
  assert.equal(
    (screen.getByLabelText("select Item 24") as HTMLInputElement).checked,
    false,
  );
});

test("a parent that keeps the reported selection in state renders without looping", () => {
  let reports = 0;
  function Parent() {
    const [selected, setSelected] = useState<Item[]>([]);
    return (
      <>
        <span data-testid="selected-count">{selected.length}</span>
        <Table
          columns={columns}
          data={items.slice(0, 3)}
          withSelectRow
          onRowSelectionChange={(rows: Row<Item>[]) => {
            reports += 1;
            setSelected(rows.map((row) => row.original));
          }}
        />
      </>
    );
  }

  renderTable(<Parent />);
  assert.ok(reports <= 2, `selection reported ${reports} times on mount`);

  fireEvent.click(screen.getByLabelText("select Item 24"));
  assert.equal(screen.getByTestId("selected-count").textContent, "1");
});
