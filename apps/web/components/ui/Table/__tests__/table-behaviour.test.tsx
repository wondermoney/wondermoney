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
import { afterEach, beforeEach, test, vi } from "vitest";

import { Table } from "@/components/ui/Table";
import {
  type ColumnDef,
  createColumnHelper,
  type Row,
  type Table as TableInstance,
} from "@/components/ui/Table/features";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

// What a user gets from the shared <Table> that every list in the app renders
// through: which rows show, in what order, and what selecting or expanding
// them does. These depend on TanStack Table v9 specifics (features registered
// up front, row models not switched off by leaving them out).

vi.mock("next/navigation", async () => {
  const React = await import("react");
  const subscribe = (callback: () => void) => {
    window.addEventListener("popstate", callback);
    return () => window.removeEventListener("popstate", callback);
  };
  const getSearch = () => window.location.search;
  return {
    usePathname: () => window.location.pathname,
    useRouter: () => ({ push: navigation.push }),
    useSearchParams: () => {
      const search = React.useSyncExternalStore(subscribe, getSearch, getSearch);
      return new URLSearchParams(search);
    },
  };
});

const nativePushState = window.history.pushState.bind(window.history);
const nativeReplaceState = window.history.replaceState.bind(window.history);

beforeEach(() => {
  vi.spyOn(window.history, "pushState").mockImplementation((state, unused, url) => {
    nativePushState(state, unused, url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  vi.spyOn(window.history, "replaceState").mockImplementation((state, unused, url) => {
    nativeReplaceState(state, unused, url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/en/test");
});

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

async function settle() {
  await act(async () => {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  });
}

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

test("URL page index survives settling and footer Next advances it", async () => {
  const manyItems: Item[] = Array.from({ length: 120 }, (_, index) => ({
    name: `Item ${String(index + 1).padStart(3, "0")}`,
    amount: index,
  }));
  window.history.replaceState(null, "", "/en/test?size=50&page=2");
  const queueMicrotask = globalThis.queueMicrotask.bind(globalThis);
  let queued = 0;
  vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => {
    queued += 1;
    // Preserve real queued work but bound a regression's self-rescheduling loop.
    if (queued <= 40) queueMicrotask(callback);
  });

  try {
    const table = <Table columns={columns} data={manyItems} withPagination />;
    const view = renderTable(table);

    await settle();
    assert.ok(queued < 40, `pagination reset queued ${queued} microtasks`);
    assert.equal(shownNames()[0], "Item 051");

    fireEvent.click(screen.getByText("go-to-next-page").closest("button")!);
    await settle();
    assert.ok(queued < 40, `pagination reset queued ${queued} microtasks`);
    assert.equal(shownNames()[0], "Item 101");
  } finally {
    cleanup();
  }
});

test("URL paging preserves unrelated state and Back/Forward restores pages", async () => {
  const manyItems = Array.from({ length: 120 }, (_, index) => ({
    name: `Item ${String(index + 1).padStart(3, "0")}`,
    amount: index,
  }));
  window.history.replaceState(
    null,
    "",
    "/en/test?keep=here&size=50&page=1#table",
  );
  renderTable(<Table columns={columns} data={manyItems} withPagination />);

  fireEvent.click(screen.getByText("go-to-next-page").closest("button")!);
  await settle();
  assert.equal(shownNames()[0], "Item 051");
  assert.equal(window.location.search, "?keep=here&size=50&page=2");
  assert.equal(window.location.hash, "#table");

  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  assert.equal(shownNames()[0], "Item 001");

  await act(async () => {
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  assert.equal(shownNames()[0], "Item 051");
});

test("custom pagination keys isolate two tables on the same page", async () => {
  const manyItems = Array.from({ length: 120 }, (_, index) => ({
    name: `Item ${String(index + 1).padStart(3, "0")}`,
    amount: index,
  }));
  window.history.replaceState(
    null,
    "",
    "/en/test?leftPage=1&leftSize=50&rightPage=1&rightSize=10&keep=yes",
  );
  renderTable(
    <>
      <div data-testid="left-table">
        <Table
          columns={columns}
          data={manyItems}
          withPagination
          pageParamName="leftPage"
          pageSizeParamName="leftSize"
        />
      </div>
      <div data-testid="right-table">
        <Table
          columns={columns}
          data={manyItems}
          withPagination
          pageParamName="rightPage"
          pageSizeParamName="rightSize"
        />
      </div>
    </>,
  );

  fireEvent.click(
    screen.getAllByText("go-to-next-page")[0].closest("button")!,
  );
  await settle();
  const params = new URLSearchParams(window.location.search);
  assert.equal(params.get("leftPage"), "2");
  assert.equal(params.get("rightPage"), "1");
  assert.equal(params.get("keep"), "yes");
  assert.equal(
    screen.getAllByTestId("name")[0].textContent,
    "Item 051",
  );
});

test("sibling corrections preserve a reset written earlier in the same commit", async () => {
  const manyItems = Array.from({ length: 120 }, (_, index) => ({
    name: `Item ${String(index + 1).padStart(3, "0")}`,
    amount: index,
  }));
  window.history.replaceState(
    null,
    "",
    "/en/test?leftPage=2&leftSize=50&rightPage=3&rightSize=10&keep=yes",
  );
  const tables = (left: Item[], right: Item[]) => (
    <>
      <Table
        columns={columns}
        data={left}
        withPagination
        pageParamName="leftPage"
        pageSizeParamName="leftSize"
      />
      <Table
        columns={columns}
        data={right}
        withPagination
        pageParamName="rightPage"
        pageSizeParamName="rightSize"
      />
    </>
  );
  const view = renderTable(tables(manyItems, items));
  await settle();
  assert.equal(new URLSearchParams(window.location.search).get("leftPage"), "2");
  assert.equal(new URLSearchParams(window.location.search).get("rightPage"), "3");

  view.rerender(
    <NextIntlClientProvider locale="en" messages={{}} onError={() => {}}>
      {tables(manyItems.map((item) => ({ ...item })), items.slice(0, 15))}
    </NextIntlClientProvider>,
  );
  await settle();
  const params = new URLSearchParams(window.location.search);
  assert.equal(params.get("leftPage"), "1");
  assert.equal(params.get("rightPage"), "1");
  assert.equal(params.get("keep"), "yes");
});

test("sequential functional pagination updates compose from the current URL", async () => {
  const manyItems = Array.from({ length: 120 }, (_, index) => ({
    name: `Item ${String(index + 1).padStart(3, "0")}`,
    amount: index,
  }));
  const tableRef = createRef<TableInstance<Item> | null>() as {
    current: TableInstance<Item> | null;
  };
  window.history.replaceState(null, "", "/en/test?size=50&page=1");
  renderTable(
    <Table
      columns={columns}
      data={manyItems}
      withPagination
      tableRef={tableRef}
    />,
  );

  act(() => {
    tableRef.current?.setPageIndex((pageIndex) => pageIndex + 1);
    tableRef.current?.setPageIndex((pageIndex) => pageIndex + 1);
  });
  await settle();
  assert.equal(new URLSearchParams(window.location.search).get("page"), "3");
  assert.equal(shownNames()[0], "Item 101");
});

test("a no-op pagination updater does not create a URL entry", async () => {
  const tableRef = createRef<TableInstance<Item> | null>() as {
    current: TableInstance<Item> | null;
  };
  window.history.replaceState(null, "", "/en/test?keep=yes");
  renderTable(
    <Table columns={columns} data={items} withPagination tableRef={tableRef} />,
  );
  const push = vi.spyOn(window.history, "pushState");
  push.mockClear();

  act(() => tableRef.current?.setPagination((current) => current));
  await settle();
  assert.equal(window.location.search, "?keep=yes");
  assert.equal(push.mock.calls.length, 0);
});

test("a size update is one URL entry and resets to page one", async () => {
  const manyItems = Array.from({ length: 120 }, (_, index) => ({
    name: `Item ${String(index + 1).padStart(3, "0")}`,
    amount: index,
  }));
  const tableRef = createRef<TableInstance<Item> | null>() as {
    current: TableInstance<Item> | null;
  };
  window.history.replaceState(null, "", "/en/test?keep=here&size=10&page=2");
  renderTable(
    <Table
      columns={columns}
      data={manyItems}
      withPagination
      tableRef={tableRef}
    />,
  );
  const push = vi.spyOn(window.history, "pushState");
  push.mockClear();

  act(() => tableRef.current?.setPagination({ pageIndex: 0, pageSize: 50 }));
  await settle();
  assert.equal(push.mock.calls.length, 1);
  const params = new URLSearchParams(window.location.search);
  assert.equal(params.get("keep"), "here");
  assert.equal(params.get("page"), "1");
  assert.equal(params.get("size"), "50");
  assert.equal(shownNames()[0], "Item 001");
});

test("new outer arrays with same rows retain paging; row/filter changes replace to page one", async () => {
  const manyItems = Array.from({ length: 120 }, (_, index) => ({
    name: `Item ${String(index + 1).padStart(3, "0")}`,
    amount: index,
  }));
  window.history.replaceState(null, "", "/en/test?size=50&page=2");
  const view = renderTable(
    <Table
      columns={columns}
      data={manyItems}
      withPagination
      paginationResetKey="filter-a"
    />,
  );
  await settle();
  view.rerender(
    <NextIntlClientProvider locale="en" messages={{}} onError={() => {}}>
      <Table
        columns={columns}
        data={[...manyItems]}
        withPagination
        paginationResetKey="filter-a"
      />
    </NextIntlClientProvider>,
  );
  await settle();
  assert.equal(new URLSearchParams(window.location.search).get("page"), "2");

  const replace = vi.spyOn(window.history, "replaceState");
  const push = vi.spyOn(window.history, "pushState");
  replace.mockClear();
  push.mockClear();
  view.rerender(
    <NextIntlClientProvider locale="en" messages={{}} onError={() => {}}>
      <Table
        columns={columns}
        data={manyItems.map((item) => ({ ...item }))}
        withPagination
        paginationResetKey="filter-a"
      />
    </NextIntlClientProvider>,
  );
  await settle();
  assert.equal(new URLSearchParams(window.location.search).get("page"), "1");
  assert.equal(replace.mock.calls.length, 1);
  assert.equal(push.mock.calls.length, 0);

  window.history.pushState(null, "", "/en/test?size=50&page=2");
  replace.mockClear();
  push.mockClear();
  view.rerender(
    <NextIntlClientProvider locale="en" messages={{}} onError={() => {}}>
      <Table
        columns={columns}
        data={manyItems}
        withPagination
        paginationResetKey="filter-b"
      />
    </NextIntlClientProvider>,
  );
  await settle();
  assert.equal(new URLSearchParams(window.location.search).get("page"), "1");
  assert.equal(replace.mock.calls.length, 1);
  assert.equal(push.mock.calls.length, 0);
});

test("a real sorting change resets the URL page with replace", async () => {
  const manyItems = Array.from({ length: 120 }, (_, index) => ({
    name: `Item ${String(120 - index).padStart(3, "0")}`,
    amount: index,
  }));
  window.history.replaceState(null, "", "/en/test?size=50&page=2");
  renderTable(
    <Table columns={columns} data={manyItems} withPagination withSorting />,
  );
  await settle();
  const replace = vi.spyOn(window.history, "replaceState");
  const push = vi.spyOn(window.history, "pushState");
  replace.mockClear();
  push.mockClear();
  fireEvent.click(screen.getByText("sort by name"));
  await settle();
  assert.equal(new URLSearchParams(window.location.search).get("page"), "1");
  assert.equal(shownNames()[0], "Item 001");
  assert.equal(replace.mock.calls.length, 1);
  assert.equal(push.mock.calls.length, 0);
});

test("first available rows preserve a valid deep link", async () => {
  const manyItems = Array.from({ length: 120 }, (_, index) => ({
    name: `Item ${String(index + 1).padStart(3, "0")}`,
    amount: index,
  }));
  function LoadingTable() {
    const [ready, setReady] = useState(false);
    const [revised, setRevised] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setReady(true)}>
          make data ready
        </button>
        <button type="button" onClick={() => setRevised(true)}>
          replace ready rows
        </button>
        <Table
          columns={columns}
          data={ready ? (revised ? manyItems.map((item) => ({ ...item })) : manyItems) : []}
          withPagination
          paginationDataReady={ready}
        />
      </>
    );
  }
  window.history.replaceState(null, "", "/en/test?size=50&page=2");
  renderTable(<LoadingTable />);
  fireEvent.click(screen.getByText("make data ready"));
  await settle();
  assert.equal(new URLSearchParams(window.location.search).get("page"), "2");
  assert.equal(shownNames()[0], "Item 051");

  fireEvent.click(screen.getByText("replace ready rows"));
  await settle();
  assert.equal(new URLSearchParams(window.location.search).get("page"), "1");
  assert.equal(shownNames()[0], "Item 001");
});

test("invalid URL values are removed and known out-of-range pages correct to one", async () => {
  window.history.replaceState(null, "", "/en/test?page=0&size=10x&keep=yes");
  const view = renderTable(
    <Table columns={columns} data={items} withPagination />,
  );
  await settle();
  assert.equal(window.location.search, "?keep=yes");
  assert.equal(shownNames()[0], "Item 25");

  window.history.replaceState(null, "", "/en/test?page=9&size=10");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await settle();
  assert.equal(window.location.search, "?page=1&size=10");
  assert.equal(shownNames()[0], "Item 25");

  window.history.replaceState(null, "", "/en/test?page=9&size=10");
  window.dispatchEvent(new PopStateEvent("popstate"));
  view.rerender(
    <NextIntlClientProvider locale="en" messages={{}} onError={() => {}}>
      <Table columns={columns} data={[]} withPagination />
    </NextIntlClientProvider>,
  );
  await settle();
  assert.equal(window.location.search, "?page=1&size=10");
});

test("partial bounds keep a deep page; non-paginated tables never write URL", async () => {
  window.history.replaceState(null, "", "/en/test?page=9&size=10");
  renderTable(
    <Table
      columns={columns}
      data={items}
      withPagination
      paginationBoundsKnown={false}
    />,
  );
  await settle();
  assert.equal(window.location.search, "?page=9&size=10");

  cleanup();
  window.history.replaceState(null, "", "/en/test?keep=yes");
  const replace = vi.spyOn(window.history, "replaceState");
  const push = vi.spyOn(window.history, "pushState");
  replace.mockClear();
  push.mockClear();
  renderTable(<Table columns={columns} data={items} />);
  await settle();
  assert.equal(push.mock.calls.length, 0);
  assert.equal(replace.mock.calls.length, 0);
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

test("disabling sorting clears the active sort and restores input order", () => {
  function SortableTable() {
    const [withSorting, setWithSorting] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setWithSorting(false)}>
          disable sorting
        </button>
        <Table columns={columns} data={items.slice(0, 3)} withSorting={withSorting} />
      </>
    );
  }

  renderTable(<SortableTable />);
  fireEvent.click(screen.getByText("sort by name"));
  assert.deepEqual(shownNames(), ["Item 23", "Item 24", "Item 25"]);

  fireEvent.click(screen.getByText("disable sorting"));
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
