// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import type { Account } from "@/lib/api/account/useAccounts";

import StatementImportFlow from "./StatementImportFlow";

type OfflineProps = {
  isOpen: boolean;
  closeModal: () => void;
  onCancel?: () => void;
  onSuccess?: () => void;
};
type ImportProps = {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  accounts: Account[];
  onImportSuccess?: () => void;
};

const h = vi.hoisted(() => ({
  accounts: [] as Partial<Account>[],
  offline: null as null | OfflineProps,
  import: null as null | ImportProps,
}));

vi.mock("@/lib/api/account/useAccounts", () => ({
  default: () => ({ data: { accounts: h.accounts }, isSuccess: true }),
}));
vi.mock("@/components/account/AccountCreateOfflineModal", () => ({
  default: (props: OfflineProps) => {
    h.offline = props;
    return props.isOpen ? <div data-testid="offline-modal" /> : null;
  },
}));
vi.mock("@/components/account/AccountTransactionImportModal", () => ({
  default: (props: ImportProps) => {
    h.import = props;
    return props.isOpen ? <div data-testid="import-modal" /> : null;
  },
}));

afterEach(() => {
  cleanup();
  h.accounts = [];
  h.offline = null;
  h.import = null;
});

function renderFlow({ open = true }: { open?: boolean } = {}) {
  const props = {
    open,
    onClose: vi.fn(),
    onImported: vi.fn(),
    onAccountAdded: vi.fn(),
  };
  const view = render(<StatementImportFlow {...props} />);
  return { ...view, props };
}

test("with no account to import into, the manual-account dialog comes first", () => {
  renderFlow();

  screen.getByTestId("offline-modal");
  assert.equal(screen.queryByTestId("import-modal"), null);
});

test("an account shared only to view does not take an import", () => {
  h.accounts = [{ accountKey: 1, myAccess: "read" }];
  renderFlow();

  screen.getByTestId("offline-modal");
});

test("once the account exists, the import opens on it", () => {
  const { props, rerender } = renderFlow();

  act(() => h.offline!.onSuccess?.());
  assert.equal(props.onAccountAdded.mock.calls.length, 1);

  h.accounts = [{ accountKey: 7, myAccess: "owner" }];
  rerender(<StatementImportFlow {...props} />);

  assert.equal(screen.queryByTestId("offline-modal"), null);
  screen.getByTestId("import-modal");
  assert.deepEqual(
    h.import!.accounts.map((account) => account.accountKey),
    [7],
  );
});

test("with an account already, the import opens directly", () => {
  h.accounts = [{ accountKey: 3, myAccess: "owner" }];
  renderFlow();

  screen.getByTestId("import-modal");
  assert.equal(screen.queryByTestId("offline-modal"), null);
});

test("leaving either dialog closes the flow; an import that wrote its rows says so", () => {
  const first = renderFlow();
  act(() => h.offline!.onCancel?.());
  assert.equal(first.props.onClose.mock.calls.length, 1);
  first.unmount();

  h.accounts = [{ accountKey: 3, myAccess: "owner" }];
  const second = renderFlow();
  act(() => h.import!.onImportSuccess?.());
  assert.equal(second.props.onImported.mock.calls.length, 1);
  act(() => h.import!.setOpen(false));
  assert.equal(second.props.onClose.mock.calls.length, 1);
});

test("closed, it shows nothing", () => {
  renderFlow({ open: false });

  assert.equal(screen.queryByTestId("offline-modal"), null);
  assert.equal(screen.queryByTestId("import-modal"), null);
});
