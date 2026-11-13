// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enCommon from "../../messages/en/common.json";
import enHousehold from "../../messages/en/household.json";
import { JoinInviteConfirm, type JoinInviteConfirmProps } from "./JoinInviteConfirm";

type Callbacks = { onError?: (error: unknown) => void };

const state = vi.hoisted(() => ({
  accepts: [] as Array<{ token: string; callbacks?: Callbacks }>,
  signOuts: 0,
}));

vi.mock("@/lib/api/household/useAcceptHouseholdInvite", () => ({
  default: () => ({
    isPending: false,
    isSuccess: false,
    mutate: (token: string, callbacks?: Callbacks) =>
      state.accepts.push({ token, callbacks }),
  }),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    signOut: async () => {
      state.signOuts += 1;
    },
  },
}));
vi.mock("@/components/ui/Link", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
  state.accepts = [];
  state.signOuts = 0;
});

const m = enHousehold.household;
const fill = (message: string, values: Record<string, string>) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, value),
    message,
  );

function renderConfirm(props: Partial<JoinInviteConfirmProps> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enHousehold }}
      >
        <JoinInviteConfirm
          token="tok"
          locale="en"
          instanceName="WonderMoney"
          invitedEmail="eva@x.test"
          signedInEmail="Eva@x.test"
          householdName="The Silvas"
          inviterName="Ana"
          role="viewer"
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("names the household and the role, and accepts only on the Join click", async () => {
  const user = userEvent.setup();
  renderConfirm();

  assert.ok(
    screen.getByRole("heading", {
      name: fill(m.join.confirmTitleNamed, { household: "The Silvas" }),
    }),
  );
  assert.ok(
    screen.getByText((text) =>
      text.includes(fill(m.join.confirmRole, { role: m.roles.viewer })),
    ),
  );
  assert.ok(screen.getByText(m.join.dataStaysBehind));
  assert.equal(state.accepts.length, 0);

  await user.click(screen.getByRole("button", { name: m.join.accept }));
  assert.deepEqual(
    state.accepts.map((call) => call.token),
    ["tok"],
  );
});

test("falls back to the inviter's name, then to a generic title", () => {
  renderConfirm({ householdName: null });
  assert.ok(
    screen.getByRole("heading", {
      name: fill(m.join.confirmTitleInviter, { name: "Ana" }),
    }),
  );
  cleanup();
  renderConfirm({ householdName: null, inviterName: null });
  assert.ok(screen.getByRole("heading", { name: m.join.confirmTitleGeneric }));
});

test("a refusal shows its own message; a final one removes the Join button", async () => {
  const user = userEvent.setup();
  renderConfirm();

  await user.click(screen.getByRole("button", { name: m.join.accept }));
  act(() =>
    state.accepts[0]!.callbacks!.onError!({
      response: { data: { code: "household_has_data" }, status: 409 },
    }),
  );
  assert.ok(screen.getByText(m.errors.household_has_data));
  // Delete the data and try again: still possible.
  assert.ok(screen.getByRole("button", { name: m.join.accept }));

  await user.click(screen.getByRole("button", { name: m.join.accept }));
  act(() =>
    state.accepts[1]!.callbacks!.onError!({
      response: { data: { code: "invite_expired" }, status: 400 },
    }),
  );
  assert.ok(screen.getByText(m.errors.invite_expired));
  assert.equal(screen.queryByRole("button", { name: m.join.accept }), null);
});

test("signed in with another email: no Join, only sign out and switch", async () => {
  const user = userEvent.setup();
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign, pathname: "/en/join" });
  try {
    renderConfirm({ signedInEmail: "someone@x.test" });

    assert.equal(screen.queryByRole("button", { name: m.join.accept }), null);
    assert.ok(screen.getByRole("heading", { name: m.join.emailMismatchTitle }));

    await user.click(
      screen.getByRole("button", { name: m.join.useDifferentAccount }),
    );
    assert.equal(state.signOuts, 1);
    assert.deepEqual(assign.mock.calls, [["/en/join?token=tok"]]);
    assert.equal(state.accepts.length, 0);
  } finally {
    vi.unstubAllGlobals();
  }
});
