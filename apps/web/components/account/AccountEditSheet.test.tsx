// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import type {
  AccountOwnershipMember,
  AccountOwnershipResponse,
} from "@/lib/api/account/useAccountOwnership";
import type {
  AccountShareMember,
  AccountSharesResponse,
} from "@/lib/api/account/useAccountShares";
import type { HouseholdMember } from "@/lib/api/household/types";

import commonMessages from "../../messages/en/common.json";
import householdMessages from "../../messages/en/household.json";
import AccountEditSheet from "./AccountEditSheet";

const api = vi.hoisted(() => ({
  shares: undefined as AccountSharesResponse | undefined,
  ownership: undefined as AccountOwnershipResponse | undefined,
  editAccount: vi.fn(),
  updateShares: vi.fn(),
  updateOwnership: vi.fn(),
  toastError: vi.fn(),
  householdMembers: [] as HouseholdMember[],
}));

vi.mock("sonner", () => ({
  toast: { error: api.toastError, success: () => {} },
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
}));
vi.mock("@/lib/api/account/useEditAccount", () => ({
  default: () => ({ mutateAsync: api.editAccount }),
}));
vi.mock("@/lib/api/account/useUpdateCreditCard", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/household/useHouseholdMembers", () => ({
  useHouseholdMembers: () => ({
    members: api.householdMembers.length > 1 ? api.householdMembers : [],
    viewerAppuserKey: api.householdMembers[0]?.appuserKey ?? null,
  }),
}));
vi.mock("@/lib/api/account/useAccountShares", () => ({
  default: () => ({
    data: api.shares,
    isLoading: false,
    isError: api.shares === undefined,
  }),
  useUpdateAccountShares: () => ({ mutateAsync: api.updateShares }),
}));
vi.mock("@/lib/api/account/useAccountOwnership", () => ({
  default: () => ({
    data: api.ownership,
    isLoading: false,
    isError: api.ownership === undefined,
  }),
  useUpdateAccountOwnership: () => ({ mutateAsync: api.updateOwnership }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  api.editAccount.mockReset().mockResolvedValue(undefined);
  api.updateShares.mockReset().mockResolvedValue(undefined);
  api.updateOwnership.mockReset().mockResolvedValue(undefined);
  api.ownership = undefined;
  api.householdMembers = [];
});
afterEach(cleanup);

const member = (
  appuserKey: number,
  firstName: string,
  role: AccountShareMember["role"],
  overrides: Partial<AccountShareMember> = {},
): AccountShareMember => ({
  appuserKey,
  firstName,
  lastName: null,
  role,
  isAccountOwner: false,
  share: null,
  access: "hidden",
  ...overrides,
});

const ana = member(3, "Ana", "owner", {
  isAccountOwner: true,
  access: "owner",
});
const rui = member(4, "Rui", "member");
const eva = member(5, "Eva", "viewer");

function shares(
  overrides: Partial<AccountSharesResponse> = {},
): AccountSharesResponse {
  return {
    accountKey: 7,
    isPrivate: false,
    canManage: true,
    members: [ana, { ...rui, access: "write" }, { ...eva, access: "read" }],
    ...overrides,
  };
}

function renderSheet(
  creditCard: Parameters<typeof AccountEditSheet>[0]["creditCard"] = null,
) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...commonMessages, ...householdMessages }}
    >
      <AccountEditSheet
        accountKey={7}
        accountName="Everyday card"
        creditCard={creditCard}
        isOpen
        onOpenChange={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

const accessFor = (name: string) =>
  screen.getByRole("combobox", {
    name: `Access for ${name}`,
  }) as HTMLSelectElement;

const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

describe("credit card settings in the account edit sheet", () => {
  beforeEach(() => {
    api.shares = shares();
  });

  test("offers a card toggle and asks for the cycle once it is on", () => {
    renderSheet(null);

    const toggle = screen.getByRole("switch", { name: "Credit card account" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByLabelText("Statement closes on")).toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByLabelText("Statement closes on")).toBeTruthy();
    expect(screen.getByLabelText("Payment due on")).toBeTruthy();
    expect(screen.getByLabelText("Credit limit")).toBeTruthy();
  });

  test("prefills the cycle of an account that is already a card and locks the toggle", () => {
    renderSheet({
      statementCloseDay: 25,
      paymentDueDay: 10,
      creditLimit: 1500,
      minimumPaymentPercent: 5,
    });

    const toggle = screen.getByRole("switch", { name: "Credit card account" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText("Statement closes on") as HTMLInputElement).value,
    ).toBe("25");
    expect(
      (screen.getByLabelText("Payment due on") as HTMLInputElement).value,
    ).toBe("10");
    expect(
      (screen.getByLabelText("Credit limit") as HTMLInputElement).value,
    ).toBe("1500");
  });
});

describe("sharing in the account edit sheet", () => {
  test("lists the account owner as Owner and every other member with their access", () => {
    api.shares = shares();
    renderSheet();

    const sharing = screen.getByRole("region", { name: "Sharing" });
    expect(within(sharing).getByText("Ana")).toBeTruthy();
    expect(within(sharing).getByText("Owner")).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: "Access for Ana" }),
    ).toBeNull();
    // A shared account starts with everyone at the most they can have.
    expect(accessFor("Rui").value).toBe("write");
    expect(accessFor("Eva").value).toBe("read");
    expect(
      within(sharing).getByText(/People who join your household later/),
    ).toBeTruthy();
  });

  test("offers a viewer only Hidden and Can view", () => {
    api.shares = shares();
    renderSheet();

    const options = (select: HTMLSelectElement) =>
      Array.from(select.options).map((option) => option.textContent);
    expect(options(accessFor("Eva"))).toEqual(["Hidden", "Can view"]);
    expect(options(accessFor("Rui"))).toEqual([
      "Hidden",
      "Can view",
      "Can edit",
    ]);
  });

  test("everyone back at their maximum shares the account with the household", async () => {
    api.shares = shares({
      isPrivate: true,
      members: [ana, { ...rui, share: "read", access: "read" }, eva],
    });
    renderSheet();

    fireEvent.change(accessFor("Rui"), { target: { value: "write" } });
    fireEvent.change(accessFor("Eva"), { target: { value: "read" } });
    save();

    await waitFor(() =>
      expect(api.updateShares).toHaveBeenCalledWith({
        isPrivate: false,
        shares: [],
      }),
    );
    expect(api.editAccount).toHaveBeenCalledWith({
      accountKey: 7,
      accountName: "Everyday card",
    });
  });

  test("a member below their maximum makes the account private, with each visible member's share", async () => {
    api.shares = shares();
    renderSheet();

    fireEvent.change(accessFor("Rui"), { target: { value: "read" } });
    fireEvent.change(accessFor("Eva"), { target: { value: "hidden" } });
    save();

    await waitFor(() =>
      expect(api.updateShares).toHaveBeenCalledWith({
        isPrivate: true,
        shares: [{ appuserKey: 4, access: "read" }],
      }),
    );
  });

  test("saving without touching the sharing sends no sharing change", async () => {
    api.shares = shares();
    renderSheet();

    save();

    await waitFor(() => expect(api.editAccount).toHaveBeenCalled());
    expect(api.updateShares).not.toHaveBeenCalled();
  });

  test("someone who cannot manage the sharing sees it without the controls", async () => {
    api.shares = shares({
      canManage: false,
      isPrivate: true,
      members: [
        ana,
        { ...rui, share: "write", access: "write" },
        { ...eva, access: "hidden" },
      ],
    });
    renderSheet();

    const sharing = screen.getByRole("region", { name: "Sharing" });
    expect(within(sharing).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(sharing).getByText("Can edit")).toBeTruthy();
    expect(within(sharing).getByText("Hidden")).toBeTruthy();
    expect(
      within(sharing).getByText(
        "Only the account's owner or the household owner can change who has access.",
      ),
    ).toBeTruthy();

    save();
    await waitFor(() => expect(api.editAccount).toHaveBeenCalled());
    expect(api.updateShares).not.toHaveBeenCalled();
  });

  test("with nobody else in the household, a private switch stands in for the list", async () => {
    api.shares = shares({ members: [ana] });
    renderSheet();

    expect(
      screen.getByText(
        "There's nobody else in your household to share this account with yet.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Private account" }));
    save();

    await waitFor(() =>
      expect(api.updateShares).toHaveBeenCalledWith({
        isPrivate: true,
        shares: [],
      }),
    );
  });
});

const householdMember = (
  appuserKey: number,
  firstName: string,
): HouseholdMember => ({
  appuserKey,
  emailAddress: `member${appuserKey}@example.com`,
  firstName,
  role: appuserKey === 3 ? "owner" : "member",
});

const jointLabel = householdMessages.household.attribution.jointAccount;

function renderOwnership({
  isOwner,
  isJoint = false,
}: {
  isOwner: boolean;
  isJoint?: boolean;
}) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...commonMessages, ...householdMessages }}
    >
      <AccountEditSheet
        accountKey={7}
        accountName="Everyday card"
        isOpen
        isOwner={isOwner}
        isJoint={isJoint}
        onOpenChange={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

describe("the joint account switch", () => {
  beforeEach(() => {
    api.shares = shares();
    api.householdMembers = [householdMember(3, "Ana"), householdMember(4, "Rui")];
  });

  test("the owner of a multi-member household can mark the account joint, and saving sends it", async () => {
    renderOwnership({ isOwner: true });

    const toggle = screen.getByRole("switch", { name: jointLabel });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    save();

    await waitFor(() => expect(api.editAccount).toHaveBeenCalled());
    expect(api.editAccount.mock.calls[0][0]).toMatchObject({
      accountKey: 7,
      isJoint: true,
    });
  });

  test("saving without touching it does not send isJoint", async () => {
    renderOwnership({ isOwner: true, isJoint: true });

    expect(
      screen.getByRole("switch", { name: jointLabel }).getAttribute("aria-checked"),
    ).toBe("true");
    save();

    await waitFor(() => expect(api.editAccount).toHaveBeenCalled());
    expect("isJoint" in api.editAccount.mock.calls[0][0]).toBe(false);
  });

  test("someone who does not own the account does not get the switch", () => {
    renderOwnership({ isOwner: false });

    expect(screen.queryByRole("switch", { name: jointLabel })).toBeNull();
  });

  test("a household of one has no switch, even for the owner", () => {
    api.householdMembers = [householdMember(3, "Ana")];
    renderOwnership({ isOwner: true });

    expect(screen.queryByRole("switch", { name: jointLabel })).toBeNull();
  });
});

const ownedBy = (
  appuserKey: number,
  firstName: string,
  overrides: Partial<AccountOwnershipMember> = {},
): AccountOwnershipMember => ({
  appuserKey,
  canSee: true,
  displayName: firstName,
  firstName,
  isAccountOwner: appuserKey === 3,
  lastName: null,
  percent: 0,
  role: appuserKey === 3 ? "owner" : "member",
  ...overrides,
});

function ownership(
  overrides: Partial<AccountOwnershipResponse> = {},
): AccountOwnershipResponse {
  return {
    accountKey: 7,
    canManage: true,
    formerMembersPercent: 0,
    isJoint: false,
    isSplit: false,
    members: [ownedBy(3, "Ana"), ownedBy(4, "Rui")],
    ...overrides,
  };
}

const shareFor = (name: string) =>
  screen.getByRole("textbox", { name: `Share for ${name}, in percent` }) as HTMLInputElement;

describe("ownership in the account edit sheet", () => {
  beforeEach(() => {
    api.shares = shares();
    api.householdMembers = [householdMember(3, "Ana"), householdMember(4, "Rui")];
  });

  test("splits the account between members and saves the percentages", async () => {
    api.ownership = ownership();
    renderOwnership({ isOwner: true });

    const region = screen.getByRole("region", { name: "Ownership" });
    fireEvent.click(within(region).getByRole("switch", { name: "Split between members" }));
    expect(shareFor("Ana").value).toBe("100");
    fireEvent.change(shareFor("Ana"), { target: { value: "60" } });
    fireEvent.change(shareFor("Rui"), { target: { value: "40" } });
    expect(within(region).getByRole("status").textContent).toBe("Total: 100% of 100%");
    save();

    await waitFor(() =>
      expect(api.updateOwnership).toHaveBeenCalledWith([
        { appuserKey: 3, percent: 60 },
        { appuserKey: 4, percent: 40 },
      ]),
    );
  });

  test("refuses to save shares that do not add up to 100%", async () => {
    api.ownership = ownership({
      isSplit: true,
      members: [ownedBy(3, "Ana", { percent: 50 }), ownedBy(4, "Rui", { percent: 50 })],
    });
    renderOwnership({ isOwner: true });

    fireEvent.change(shareFor("Rui"), { target: { value: "40" } });
    expect(screen.getByRole("status").textContent).toBe("Total: 90% of 100%");
    save();

    await waitFor(() => expect(api.toastError).toHaveBeenCalledWith("The shares must add up to 100%."));
    expect(api.updateOwnership).not.toHaveBeenCalled();
    expect(api.editAccount).not.toHaveBeenCalled();
  });

  test("switching the split off stops splitting the account", async () => {
    api.ownership = ownership({
      isSplit: true,
      members: [ownedBy(3, "Ana", { percent: 50 }), ownedBy(4, "Rui", { percent: 50 })],
    });
    renderOwnership({ isOwner: true });

    fireEvent.click(screen.getByRole("switch", { name: "Split between members" }));
    save();

    await waitFor(() => expect(api.updateOwnership).toHaveBeenCalledWith([]));
  });

  test("saving without touching it sends no ownership change", async () => {
    api.ownership = ownership();
    renderOwnership({ isOwner: true });

    save();

    await waitFor(() => expect(api.editAccount).toHaveBeenCalled());
    expect(api.updateOwnership).not.toHaveBeenCalled();
  });

  test("someone who cannot change it sees the shares without the controls", () => {
    api.ownership = ownership({
      canManage: false,
      formerMembersPercent: 10,
      isSplit: true,
      members: [ownedBy(3, "Ana", { percent: 60 }), ownedBy(4, "Rui", { percent: 30 })],
    });
    renderOwnership({ isOwner: false });

    const region = screen.getByRole("region", { name: "Ownership" });
    expect(within(region).queryByRole("switch")).toBeNull();
    expect(within(region).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(region).getByText("60%")).toBeTruthy();
    expect(within(region).getByText(/10% belongs to people who have left/)).toBeTruthy();
  });

  test("a household of one has no ownership section", () => {
    api.householdMembers = [householdMember(3, "Ana")];
    api.ownership = ownership();
    renderOwnership({ isOwner: true });

    expect(screen.queryByRole("region", { name: "Ownership" })).toBeNull();
  });
});
