// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type { Household, HouseholdMember } from "@/lib/api/household/types";

import enHousehold from "../../messages/en/household.json";
import { MemberFilterControl } from "./MemberFilterSelect";

const state = vi.hoisted(() => ({
  household: undefined as Household | undefined,
  search: "",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("@/lib/api/household/useHousehold", () => ({
  default: () => ({ data: state.household }),
}));

const member = (appuserKey: number, firstName: string): HouseholdMember => ({
  appuserKey,
  emailAddress: `member${appuserKey}@example.com`,
  firstName,
  role: appuserKey === 1 ? "owner" : "member",
});

const householdOf = (members: HouseholdMember[]): Household => ({
  maxMembers: 5,
  members,
  pendingInvites: [],
  viewerAppuserKey: 1,
});

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  state.household = householdOf([member(1, "Ana"), member(2, "Rui")]);
  state.search = "from=2026-10-01T00%3A00%3A00.000Z";
  state.replace.mockReset();
});

afterEach(cleanup);

function renderControl() {
  render(
    <NextIntlClientProvider locale="en" messages={enHousehold}>
      <MemberFilterControl />
    </NextIntlClientProvider>,
  );
}

async function choose(index: number) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));
  const options = await screen.findAllByRole("option");
  await user.click(options[index]);
}

/** The query string the control navigated to. */
const navigatedTo = () => {
  assert.equal(state.replace.mock.calls.length, 1);
  return new URLSearchParams(String(state.replace.mock.calls[0][0]).slice(1));
};

test("a household of one gets no member filter", () => {
  state.household = householdOf([member(1, "Ana")]);
  renderControl();

  assert.ok(screen.queryByRole("combobox") === null);
});

test("lists everyone, each member and Shared", async () => {
  renderControl();
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));

  const options = (await screen.findAllByRole("option")).map(
    (option) => option.textContent,
  );
  assert.deepEqual(options, [
    enHousehold.household.attribution.everyone,
    "Ana",
    "Rui",
    enHousehold.household.attribution.shared,
  ]);
});

test("picking a member puts their key in the URL and keeps the other filters", async () => {
  renderControl();
  await choose(2);

  const params = navigatedTo();
  assert.equal(params.get("member"), "2");
  assert.equal(params.get("from"), "2026-10-01T00:00:00.000Z");
});

test("picking Shared puts shared in the URL", async () => {
  renderControl();
  await choose(3);

  assert.equal(navigatedTo().get("member"), "shared");
});

test("picking Everyone drops the parameter", async () => {
  state.search = "member=2";
  renderControl();
  await choose(0);

  assert.equal(navigatedTo().has("member"), false);
});

test("a link to someone no longer in the household reads as Everyone", () => {
  state.search = "member=9";
  renderControl();

  assert.equal(
    screen.getByRole("combobox").textContent,
    enHousehold.household.attribution.everyone,
  );
});
