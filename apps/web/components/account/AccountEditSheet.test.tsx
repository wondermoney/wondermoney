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
  AccountShareMember,
  AccountSharesResponse,
} from "@/lib/api/account/useAccountShares";

import commonMessages from "../../messages/en/common.json";
import householdMessages from "../../messages/en/household.json";
import AccountEditSheet from "./AccountEditSheet";

const api = vi.hoisted(() => ({
  shares: undefined as AccountSharesResponse | undefined,
  editAccount: vi.fn(),
  updateShares: vi.fn(),
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
vi.mock("@/lib/api/account/useAccountShares", () => ({
  default: () => ({
    data: api.shares,
    isLoading: false,
    isError: api.shares === undefined,
  }),
  useUpdateAccountShares: () => ({ mutateAsync: api.updateShares }),
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
