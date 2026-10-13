import assert from "node:assert/strict";

import { test } from "vitest";

import { mobileMoreAccountsItems } from "./mobile-more-nav-items";

test("mobile More sheet exposes all enabled Accounts destinations", () => {
  assert.deepEqual(mobileMoreAccountsItems, [
    {
      id: "accounts.overview",
      href: "/accounts",
      labelKey: "navigation.overview",
    },
    {
      id: "accounts.transactions",
      href: "/accounts/transactions",
      labelKey: "navigation.transactions",
    },
    {
      id: "accounts.recurring",
      href: "/accounts/recurring",
      labelKey: "navigation.bills-subscriptions",
    },
  ]);
});
