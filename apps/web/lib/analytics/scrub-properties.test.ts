import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { scrubEventProperties } from "./scrub-properties";

describe("web analytics property scrub", () => {
  it("drops identifiers, sensitive fields, objects and email values", () => {
    const scrubbed = scrubEventProperties({
      accountKey: 12,
      budget_key: 4,
      transactionIds: [1, 2],
      requisition_id: "abc",
      email: "person@example.com",
      note: "write to person@example.com",
      data: { amount: 120, description: "Rent" },
      files: [{ name: "receipt.pdf" }],
      field: "amount",
      count: 3,
      allMatching: false,
      changes: ["categoryId", "reviewed"],
      monkey: "a word ending in key",
    });

    assert.deepEqual(scrubbed, {
      field: "amount",
      count: 3,
      allMatching: false,
      changes: ["categoryId", "reviewed"],
      monkey: "a word ending in key",
    });
  });

  it("leaves PostHog's own properties alone, but for the page's address", () => {
    const posthogOwn = {
      $host: "app.example.com",
      $session_id: "s1",
      $device_id: "d1",
      distinct_id: "anon-1",
      token: "phc_public",
    };

    assert.deepEqual(
      scrubEventProperties({
        ...posthogOwn,
        $current_url: "https://app.example.com/en/accounts/123",
        $pathname: "/en/accounts/123",
        $referrer: "https://app.example.com/en/budgets?code=abc",
        $initial_current_url: "https://app.example.com/en/accounts/123",
        $initial_pathname: "/en/accounts/123",
        $initial_referrer: "$direct",
        $referring_domain: "bank.example",
        $session_entry_url: "https://app.example.com/en/join?token=abc",
        $session_entry_pathname: "/en/join",
        $session_entry_referrer: "https://bank.example/consent?code=abc",
        $session_entry_referring_domain: "bank.example",
        $session_entry_host: "app.example.com",
        $prev_pageview_pathname: "/en/accounts/123",
      }),
      posthogOwn,
    );
  });
});
