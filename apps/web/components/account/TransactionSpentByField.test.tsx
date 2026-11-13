// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type {
  Transaction,
  TransactionAttribution,
} from "@/lib/api/account/useTransactions";
import type { HouseholdMember } from "@/lib/api/household/types";

import enCommon from "../../messages/en/common.json";
import enHousehold from "../../messages/en/household.json";
import { TransactionSpentByField } from "./TransactionSpentByField";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api/api", () => ({ default: apiMock }));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const household = vi.hoisted(() => ({ members: [] as HouseholdMember[] }));
vi.mock("@/lib/household/useHouseholdMembers", () => ({
  useHouseholdMembers: () => ({
    members: household.members.length > 1 ? household.members : [],
    viewerAppuserKey: household.members[0]?.appuserKey ?? null,
  }),
}));

const ana: HouseholdMember = {
  appuserKey: 1,
  emailAddress: "ana@example.com",
  firstName: "Ana",
  role: "owner",
};
const rui: HouseholdMember = {
  appuserKey: 2,
  emailAddress: "rui@example.com",
  firstName: "  ",
  role: "member",
};

const ACCOUNT_KEY = 10;
/** `GET /v1/account`'s row for the transaction's account: Ana's own. */
const accountWire = {
  accountKey: ACCOUNT_KEY,
  currencyKey: { code: "EUR" },
  accountOwnerAppuserKey: { currencyKey: { code: "EUR" } },
  isJoint: false,
  ownerAppuserKey: 1,
  attribution: { appuserKey: 1, displayName: "Ana" },
};

const row = (attribution: TransactionAttribution): Transaction =>
  ({
    transactionKey: 55,
    accountKey: {
      accountKey: ACCOUNT_KEY,
      accountName: "Current account",
      currencyKey: { code: "EUR" },
    },
    attribution,
  }) as Transaction;

const followsAccount: TransactionAttribution = {
  appuserKey: 1,
  displayName: "Ana",
  overridden: false,
};

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  household.members = [ana, rui];
  apiMock.get.mockImplementation(async (url: string) => {
    if (url === "/v1/account") return { data: { accounts: [accountWire] } };
    throw new Error(`unexpected GET ${url}`);
  });
  apiMock.patch.mockImplementation(
    async (_url: string, body: { attributedAppuserKey: number | "shared" | null }) => ({
      data: {
        transaction: {
          transactionKey: 55,
          attribution:
            body.attributedAppuserKey === null
              ? followsAccount
              : body.attributedAppuserKey === "shared"
                ? { appuserKey: null, displayName: null, overridden: true }
                : {
                    appuserKey: body.attributedAppuserKey,
                    displayName: "Rui",
                    overridden: true,
                  },
        },
      },
    }),
  );
});

afterEach(cleanup);

function renderField(transaction: Transaction) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enHousehold }}
      >
        <TransactionSpentByField transaction={transaction} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function choose(index: number) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));
  const options = await screen.findAllByRole("option");
  await user.click(options[index]);
}

const patchedBody = () => {
  assert.equal(apiMock.patch.mock.calls.length, 1);
  const [url, body] = apiMock.patch.mock.calls[0];
  assert.equal(url, "/v1/account/transaction/55");
  return body;
};

test("offers the account's default first, then each member, then Shared", async () => {
  renderField(row(followsAccount));
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));

  const options = (await screen.findAllByRole("option")).map(
    (option) => option.textContent,
  );
  assert.equal(options.length, 4);
  // The default names whose the account is; a member with a blank first name shows their email.
  await waitFor(() => assert.ok(apiMock.get.mock.calls.length > 0));
  assert.ok(options[0]?.includes("Ana"));
  assert.equal(options[1], "Ana");
  assert.equal(options[2], "rui@example.com");
  assert.equal(options[3], enHousehold.household.attribution.shared);
});

test("picking a member sends their appuser key", async () => {
  renderField(row(followsAccount));
  await choose(2);

  await waitFor(() => assert.equal(apiMock.patch.mock.calls.length, 1));
  assert.deepEqual(patchedBody(), { attributedAppuserKey: 2 });
});

test("picking Shared sends shared", async () => {
  renderField(row(followsAccount));
  await choose(3);

  await waitFor(() => assert.equal(apiMock.patch.mock.calls.length, 1));
  assert.deepEqual(patchedBody(), { attributedAppuserKey: "shared" });
});

test("picking the account default on an overridden row sends null", async () => {
  renderField(row({ appuserKey: 2, displayName: "Rui", overridden: true }));
  await choose(0);

  await waitFor(() => assert.equal(apiMock.patch.mock.calls.length, 1));
  assert.deepEqual(patchedBody(), { attributedAppuserKey: null });
});

test("picking what is already set sends nothing", async () => {
  renderField(row(followsAccount));
  await choose(0);

  assert.equal(apiMock.patch.mock.calls.length, 0);
});

test("a row on an account shared to view only has no Spent by field", async () => {
  apiMock.get.mockImplementation(async (url: string) => {
    if (url === "/v1/account") {
      return { data: { accounts: [{ ...accountWire, myAccess: "read" }] } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  renderField(row(followsAccount));

  await waitFor(() => assert.ok(screen.queryByRole("combobox") === null));
});

test("a household of one has no Spent by field", () => {
  household.members = [ana];
  renderField(row(followsAccount));

  assert.ok(screen.queryByRole("combobox") === null);
});
