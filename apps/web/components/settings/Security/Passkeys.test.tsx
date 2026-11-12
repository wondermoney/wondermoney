// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import enCommon from "../../../messages/en/common.json";
import Passkeys from "./Passkeys";

// The boundary is better-auth's client: the list, rename, delete and add calls the passkey
// plugin exposes. Everything above it (the hooks, the error mapping) is the real code.
const { authClient, toast } = vi.hoisted(() => ({
  authClient: {
    passkey: {
      addPasskey: vi.fn(),
      deletePasskey: vi.fn(),
      listUserPasskeys: vi.fn(),
      updatePasskey: vi.fn(),
    },
  },
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/auth/client", () => ({ authClient }));
vi.mock("sonner", () => ({ toast }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // DrawerDialog picks a dialog on wide screens.
  window.matchMedia ??= (query: string) =>
    ({
      addEventListener() {},
      matches: true,
      media: query,
      removeEventListener() {},
    }) as unknown as MediaQueryList;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: function PublicKeyCredential() {},
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "PublicKeyCredential");
});

const laptop = {
  aaguid: "00000000-0000-0000-0000-000000000000",
  createdAt: "2026-03-04T10:00:00.000Z",
  id: "pk-laptop",
  lastUsedAt: "2026-05-06T08:30:00.000Z",
  name: "Laptop",
};
const unnamed = {
  aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
  createdAt: "2026-04-01T10:00:00.000Z",
  id: "pk-phone",
  lastUsedAt: null,
  name: null,
};

function renderPanel(passkeys: unknown[]) {
  authClient.passkey.listUserPasskeys.mockResolvedValue({
    data: passkeys,
    error: null,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider locale="en" messages={enCommon}>
        <Passkeys />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("lists each passkey with its name, when it was added and when it was last used", async () => {
  renderPanel([laptop, unnamed]);

  const items = await screen.findAllByRole("listitem");
  assert.equal(items.length, 2);
  within(items[0]!).getByText("Laptop");
  within(items[0]!).getByText(/^Added .*Mar/);
  within(items[0]!).getByText(/^Last used .*May/);
  // No name: the password manager it reported, and no use yet.
  within(items[1]!).getByText("Google Password Manager");
  within(items[1]!).getByText(enCommon["passkeys-never-used"]);
});

test("says so when there are no passkeys", async () => {
  renderPanel([]);

  await screen.findByText(enCommon["passkeys-empty"]);
});

test("adds a passkey and shows it", async () => {
  renderPanel([]);
  await screen.findByText(enCommon["passkeys-empty"]);
  authClient.passkey.addPasskey.mockResolvedValue({
    data: laptop,
    error: null,
  });
  authClient.passkey.listUserPasskeys.mockResolvedValue({
    data: [laptop],
    error: null,
  });

  await userEvent.click(
    screen.getByRole("button", { name: enCommon["passkeys-add"] }),
  );

  await screen.findByText("Laptop");
  assert.equal(authClient.passkey.addPasskey.mock.calls.length, 1);
  assert.equal(toast.success.mock.calls[0]![0], enCommon["passkeys-added"]);
});

test("asks for a fresh sign-in when the API says the session is too old to add a passkey", async () => {
  renderPanel([]);
  await screen.findByText(enCommon["passkeys-empty"]);
  authClient.passkey.addPasskey.mockResolvedValue({
    data: null,
    error: {
      code: "SESSION_NOT_FRESH",
      message: "Session is not fresh",
      status: 403,
    },
  });

  await userEvent.click(
    screen.getByRole("button", { name: enCommon["passkeys-add"] }),
  );

  await waitFor(() =>
    assert.equal(
      toast.error.mock.calls[0]![0],
      enCommon["passkeys-error-session-not-fresh"],
    ),
  );
});

test("a closed browser prompt adds nothing and reports nothing", async () => {
  renderPanel([]);
  await screen.findByText(enCommon["passkeys-empty"]);
  authClient.passkey.addPasskey.mockResolvedValue({
    data: null,
    error: {
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      message: "Not allowed",
      status: 400,
    },
  });

  await userEvent.click(
    screen.getByRole("button", { name: enCommon["passkeys-add"] }),
  );

  await waitFor(() =>
    assert.equal(authClient.passkey.addPasskey.mock.calls.length, 1),
  );
  assert.equal(toast.error.mock.calls.length, 0);
});

test("renames a passkey", async () => {
  renderPanel([laptop]);
  authClient.passkey.updatePasskey.mockResolvedValue({
    data: { passkey: { ...laptop, name: "Work laptop" } },
    error: null,
  });

  await userEvent.click(
    await screen.findByRole("button", { name: "Rename Laptop" }),
  );
  const name = screen.getByLabelText(enCommon["passkeys-name"]);
  await userEvent.clear(name);
  await userEvent.type(name, "Work laptop");
  authClient.passkey.listUserPasskeys.mockResolvedValue({
    data: [{ ...laptop, name: "Work laptop" }],
    error: null,
  });
  await userEvent.click(screen.getByRole("button", { name: enCommon.save }));

  await screen.findByText("Work laptop");
  assert.deepEqual(authClient.passkey.updatePasskey.mock.calls[0]![0], {
    id: "pk-laptop",
    name: "Work laptop",
  });
});

test("deletes a passkey after confirming", async () => {
  renderPanel([laptop]);
  authClient.passkey.deletePasskey.mockResolvedValue({
    data: { status: true },
    error: null,
  });

  await userEvent.click(
    await screen.findByRole("button", { name: "Delete Laptop" }),
  );
  authClient.passkey.listUserPasskeys.mockResolvedValue({
    data: [],
    error: null,
  });
  await userEvent.click(
    screen.getByRole("button", { name: enCommon["passkeys-delete-confirm"] }),
  );

  await screen.findByText(enCommon["passkeys-empty"]);
  assert.deepEqual(authClient.passkey.deletePasskey.mock.calls[0]![0], {
    id: "pk-laptop",
  });
});

test("a browser without WebAuthn lists passkeys but cannot add one", async () => {
  Reflect.deleteProperty(window, "PublicKeyCredential");
  renderPanel([laptop]);

  await screen.findByText("Laptop");
  assert.equal(
    screen.queryByRole("button", { name: enCommon["passkeys-add"] }),
    null,
  );
  screen.getByText(enCommon["passkeys-unsupported"]);
});
