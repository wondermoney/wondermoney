// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type {
  Household as HouseholdData,
  HouseholdMember,
  HouseholdRole,
} from "@/lib/api/household/types";

import enCommon from "../../messages/en/common.json";
import enHousehold from "../../messages/en/household.json";
import Household from "./Household";

type Callbacks = {
  onError?: (error: unknown) => void;
  onSuccess?: (data?: unknown) => void;
};

const mutation = () => {
  const calls: Array<{ variables: unknown; callbacks?: Callbacks }> = [];
  return {
    calls,
    hook: () => ({
      isPending: false,
      mutate: (variables: unknown, callbacks?: Callbacks) =>
        calls.push({ variables, callbacks }),
      variables: undefined,
    }),
  };
};

const state = vi.hoisted(() => ({
  household: undefined as unknown,
  mutations: {} as Record<string, ReturnType<typeof mutation>>,
  signOut: [] as string[],
  toasts: [] as Array<{ kind: string; message: string }>,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => state.toasts.push({ kind: "error", message }),
    success: (message: string) =>
      state.toasts.push({ kind: "success", message }),
  },
}));
vi.mock("@/lib/auth/user-context", () => ({ useUser: () => null }));
vi.mock("@/lib/auth/useSignOut", () => ({
  useSignOut: () => async (destination: string) => {
    state.signOut.push(destination);
  },
}));
vi.mock("@/lib/api/household/useHousehold", () => ({
  default: () => ({ data: state.household, error: null, isLoading: false }),
}));
vi.mock("@/lib/api/household/useCreateHouseholdInvite", () => ({
  default: () => state.mutations.useCreateHouseholdInvite!.hook(),
}));
vi.mock("@/lib/api/household/useRemoveHouseholdMember", () => ({
  default: () => state.mutations.useRemoveHouseholdMember!.hook(),
}));
vi.mock("@/lib/api/household/useResendHouseholdInvite", () => ({
  default: () => state.mutations.useResendHouseholdInvite!.hook(),
}));
vi.mock("@/lib/api/household/useRevokeHouseholdInvite", () => ({
  default: () => state.mutations.useRevokeHouseholdInvite!.hook(),
}));
vi.mock("@/lib/api/household/useTransferHouseholdOwnership", () => ({
  default: () => state.mutations.useTransferHouseholdOwnership!.hook(),
}));
vi.mock("@/lib/api/household/useUpdateHouseholdMemberRole", () => ({
  default: () => state.mutations.useUpdateHouseholdMemberRole!.hook(),
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
  state.signOut = [];
  state.toasts = [];
});

const m = enHousehold.household;

const person = (
  appuserKey: number,
  role: HouseholdRole,
  firstName: string,
): HouseholdMember => ({
  appuserKey,
  emailAddress: `${firstName.toLowerCase()}@x.test`,
  firstName,
  role,
});

const ana = person(1, "owner", "Ana");
const bea = person(2, "admin", "Bea");
const caio = person(3, "member", "Caio");
const dina = person(4, "viewer", "Dina");

function renderAs(me: HouseholdMember, overrides: Partial<HouseholdData> = {}) {
  state.household = {
    maxMembers: 6,
    members: [ana, bea, caio, dina],
    pendingInvites: [
      {
        email: "eva@x.test",
        expiresAt: "2026-11-20T10:00:00.000Z",
        householdInviteKey: 7,
        role: "viewer",
      },
    ],
    viewerAppuserKey: me.appuserKey,
    ...overrides,
  } satisfies HouseholdData;
  state.mutations = Object.fromEntries(
    [
      "useCreateHouseholdInvite",
      "useRemoveHouseholdMember",
      "useResendHouseholdInvite",
      "useRevokeHouseholdInvite",
      "useTransferHouseholdOwnership",
      "useUpdateHouseholdMemberRole",
    ].map((name) => [name, mutation()]),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enHousehold }}
        timeZone="UTC"
      >
        <Household />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const actionsFor = (member: HouseholdMember) =>
  screen.queryByRole("button", {
    name: m.members.actionsLabel.replace("{name}", member.firstName!),
  });

const roleRadios = () =>
  screen
    .queryAllByRole("radio")
    .map((radio) => (radio as HTMLInputElement).value);

test("the owner invites as admin, member or viewer, member by default", async () => {
  const user = userEvent.setup();
  renderAs(ana);

  assert.deepEqual(roleRadios(), ["admin", "member", "viewer"]);
  const member = screen.getByRole("radio", {
    name: new RegExp(`^${m.roles.member}`),
  }) as HTMLInputElement;
  assert.equal(member.checked, true);

  await user.type(screen.getByLabelText(m.invite.emailLabel), "new@x.test");
  await user.click(screen.getByRole("button", { name: m.invite.submit }));
  await waitFor(() =>
    assert.equal(state.mutations.useCreateHouseholdInvite!.calls.length, 1),
  );
  assert.deepEqual(state.mutations.useCreateHouseholdInvite!.calls[0]!.variables, {
    email: "new@x.test",
    role: "member",
  });
  // A sent invite clears the form for the next one.
  act(() =>
    state.mutations.useCreateHouseholdInvite!.calls[0]!.callbacks!.onSuccess!(),
  );
  assert.equal(
    (screen.getByLabelText(m.invite.emailLabel) as HTMLInputElement).value,
    "",
  );

  await user.click(
    screen.getByRole("radio", { name: new RegExp(`^${m.roles.viewer}`) }),
  );
  await user.type(screen.getByLabelText(m.invite.emailLabel), "other@x.test");
  await user.click(screen.getByRole("button", { name: m.invite.submit }));
  await waitFor(() =>
    assert.equal(state.mutations.useCreateHouseholdInvite!.calls.length, 2),
  );
  assert.deepEqual(state.mutations.useCreateHouseholdInvite!.calls[1]!.variables, {
    email: "other@x.test",
    role: "viewer",
  });
});

test("a refused invite says why in the user's language", async () => {
  const user = userEvent.setup();
  renderAs(ana);
  await user.type(screen.getByLabelText(m.invite.emailLabel), "new@x.test");
  await user.click(screen.getByRole("button", { name: m.invite.submit }));
  await waitFor(() =>
    assert.equal(state.mutations.useCreateHouseholdInvite!.calls.length, 1),
  );
  state.mutations.useCreateHouseholdInvite!.calls[0]!.callbacks!.onError!({
    response: { data: { code: "household_full", message: "full" }, status: 409 },
  });
  assert.deepEqual(state.toasts, [
    { kind: "error", message: m.errors.household_full },
  ]);
});

test("an admin invites only members and viewers and manages only those below them", () => {
  renderAs(bea);

  assert.deepEqual(roleRadios(), ["member", "viewer"]);
  assert.equal(actionsFor(ana), null);
  assert.equal(actionsFor(bea), null);
  assert.ok(actionsFor(caio));
  assert.ok(actionsFor(dina));

  // The viewer invite is below admin, so an admin can resend or revoke it.
  assert.ok(screen.getByRole("button", { name: m.pending.resend }));
  assert.ok(screen.getByRole("button", { name: m.actions.leave }));
});

test("a member sees the household but manages nothing, and can leave", () => {
  renderAs(caio);

  assert.equal(screen.queryByLabelText(m.invite.emailLabel), null);
  assert.deepEqual(roleRadios(), []);
  for (const member of [ana, bea, caio, dina]) {
    assert.equal(actionsFor(member), null);
  }
  // Pending invites are visible to everyone, actionable only by managers.
  assert.ok(screen.getByText(m.pending.sentTo.replace("{email}", "eva@x.test")));
  assert.equal(screen.queryByRole("button", { name: m.pending.resend }), null);
  assert.ok(screen.getByRole("button", { name: m.actions.leave }));
});

test("the owner cannot leave, and every member gets their role badge", () => {
  renderAs(ana);
  assert.equal(screen.queryByRole("button", { name: m.actions.leave }), null);
  for (const role of ["owner", "admin", "member"] as const) {
    assert.ok(screen.getAllByText(m.roles[role]).length > 0, role);
  }
  assert.ok(screen.getByText(m.members.you));
});

test("a full household hides the invite form", () => {
  renderAs(ana, { maxMembers: 5 });
  assert.equal(screen.queryByLabelText(m.invite.emailLabel), null);
  assert.ok(screen.getByText(m.invite.full.replace("{max}", "5")));
});

test("transferring ownership names the member and asks before it happens", async () => {
  const user = userEvent.setup();
  renderAs(ana);

  await user.click(actionsFor(caio)!);
  await user.click(await screen.findByRole("menuitem", { name: m.members.makeOwner }));

  const dialog = await screen.findByRole("alertdialog");
  assert.ok(
    within(dialog).getByText(m.transferDialog.title.replace("{name}", "Caio")),
  );
  assert.equal(state.mutations.useTransferHouseholdOwnership!.calls.length, 0);

  await user.click(
    within(dialog).getByRole("button", {
      name: m.transferDialog.confirm.replace("{name}", "Caio"),
    }),
  );
  assert.deepEqual(
    state.mutations.useTransferHouseholdOwnership!.calls.map((c) => c.variables),
    [3],
  );
});

test("an admin moves a member to viewer", async () => {
  const user = userEvent.setup();
  renderAs(bea);

  await user.click(actionsFor(caio)!);
  await user.click(await screen.findByRole("menuitem", { name: m.members.changeRole }));
  const dialog = await screen.findByRole("dialog");
  const save = within(dialog).getByRole("button", { name: m.roleDialog.save });
  // Unchanged role: nothing to save.
  assert.equal((save as HTMLButtonElement).disabled, true);

  await user.click(
    within(dialog).getByRole("radio", { name: new RegExp(`^${m.roles.viewer}`) }),
  );
  await user.click(save);
  assert.deepEqual(
    state.mutations.useUpdateHouseholdMemberRole!.calls.map((c) => c.variables),
    [{ appuserKey: 3, role: "viewer" }],
  );
});

test("leaving removes yourself and then signs you out", async () => {
  const user = userEvent.setup();
  renderAs(dina);

  await user.click(screen.getByRole("button", { name: m.actions.leave }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(
    within(dialog).getByRole("button", { name: m.leaveDialog.confirm }),
  );
  const [call] = state.mutations.useRemoveHouseholdMember!.calls;
  assert.equal(call!.variables, 4);
  call!.callbacks!.onSuccess!();
  assert.deepEqual(state.signOut, ["/auth/login"]);
});
