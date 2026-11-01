// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import UserAccountDelete from "./UserAccountDelete";

const deps = vi.hoisted(() => ({
  deleteAccount: vi.fn(async (..._args: unknown[]) => ({})),
  signOut: vi.fn(async () => ({})),
  push: vi.fn(),
}));

vi.mock("@/lib/api/user/useDeleteUserAccount", () => ({
  default: () => ({ mutateAsync: deps.deleteAccount, isPending: false }),
}));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut: deps.signOut } }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: deps.push }) }));
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ reset: () => {} }) }));
vi.mock("@/components/instance/InstanceNameProvider", () => ({
  useInstanceName: () => "WonderMoney",
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  deps.deleteAccount.mockReset();
  deps.deleteAccount.mockImplementation(async () => ({}));
  deps.signOut.mockClear();
  deps.push.mockClear();
});

const t = createTranslator({ locale: "en", messages: enMessages });
const confirmLabel = t("delete-wondermoney-account-confirm", { instanceName: "WonderMoney" });

function renderDialog(queryClient: QueryClient) {
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <UserAccountDelete isOpen closeModal={() => {}} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("deleting the account signs out and leaves none of the user's data cached", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["accounts"], { accounts: [{ accountKey: 1 }] });
  renderDialog(queryClient);

  await userEvent.click(screen.getByRole("button", { name: confirmLabel }));

  await vi.waitFor(() => assert.deepEqual(deps.push.mock.calls, [["/auth/login"]]));
  assert.deepEqual(deps.deleteAccount.mock.calls, [[]], "the current user is deleted, not one named by id");
  assert.equal(deps.signOut.mock.calls.length, 1);
  assert.equal(queryClient.getQueryCache().getAll().length, 0);
});

test("a failed deletion keeps the user signed in and says it did not work", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  deps.deleteAccount.mockImplementation(async () => {
    throw new Error("server error");
  });
  renderDialog(new QueryClient());

  await userEvent.click(screen.getByRole("button", { name: confirmLabel }));

  await screen.findByText(t("delete-wondermoney-account-error", { instanceName: "WonderMoney" }));
  assert.equal(deps.signOut.mock.calls.length, 0);
  assert.equal(deps.push.mock.calls.length, 0);
});
