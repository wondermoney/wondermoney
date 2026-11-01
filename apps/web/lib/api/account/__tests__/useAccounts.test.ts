import assert from "node:assert/strict";

import { test } from "vitest";

import { normalizeAccountsResponse } from "../useAccounts";

const requiredAccountFields = (accountKey: number) => ({
  accountKey,
  currencyKey: { code: "EUR" },
  accountOwnerAppuserKey: { currencyKey: { code: "USD" } },
});

test("normalizes omitted legacy fields and derives source when omitted", () => {
  const response = normalizeAccountsResponse({
    accounts: [
      requiredAccountFields(1),
      {
        ...requiredAccountFields(2),
        refreshedAt: "2026-07-17T10:00:00.000Z",
      },
    ],
  });

  assert.deepEqual(response.accounts[0], {
    ...requiredAccountFields(1),
    accountName: null,
    accountFinancialInstitutionKey: null,
    balance: null,
    appuserCurrencyBalance: null,
    refreshedAt: null,
    source: "manual",
    csvImportFormat: "generic",
    isPrivate: false,
    isOwnedByViewer: false,
    ownerFirstName: null,
    availableBalance: null,
    appuserCurrencyAvailableBalance: null,
    syncStatus: null,
  });
  assert.equal(response.accounts[1].source, "open_banking");
});

test("derives transitional source when legacy source is null", () => {
  const response = normalizeAccountsResponse({
    accounts: [
      { ...requiredAccountFields(1), source: null },
      {
        ...requiredAccountFields(2),
        refreshedAt: "2026-07-17T10:00:00.000Z",
        source: null,
      },
    ],
  });

  assert.equal(response.accounts[0].source, "manual");
  assert.equal(response.accounts[1].source, "open_banking");
});

test("normalizes explicit nulls and omitted institution fields", () => {
  const response = normalizeAccountsResponse({
    accounts: [
      {
        ...requiredAccountFields(1),
        accountName: null,
        accountFinancialInstitutionKey: {},
        balance: null,
        appuserCurrencyBalance: null,
        refreshedAt: null,
        source: null,
      },
    ],
  });

  assert.equal(response.accounts[0].accountName, null);
  assert.equal(response.accounts[0].balance, null);
  assert.equal(response.accounts[0].appuserCurrencyBalance, null);
  assert.equal(response.accounts[0].refreshedAt, null);
  assert.deepEqual(response.accounts[0].accountFinancialInstitutionKey, {
    displayName: null,
    logoUrl: null,
  });
});

test("preserves zero balances", () => {
  const response = normalizeAccountsResponse({
    accounts: [
      {
        ...requiredAccountFields(1),
        balance: 0,
        appuserCurrencyBalance: 0,
      },
    ],
  });

  assert.equal(response.accounts[0].balance, 0);
  assert.equal(response.accounts[0].appuserCurrencyBalance, 0);
});

test("canonical source overrides the transitional refreshedAt heuristic", () => {
  const response = normalizeAccountsResponse({
    accounts: [
      {
        ...requiredAccountFields(1),
        refreshedAt: "2026-07-17T10:00:00.000Z",
        source: "manual",
      },
      {
        ...requiredAccountFields(2),
        refreshedAt: null,
        source: "open_banking",
      },
    ],
  });

  assert.equal(response.accounts[0].source, "manual");
  assert.equal(response.accounts[1].source, "open_banking");
});

test("preserves a valid refreshedAt string exactly", () => {
  const refreshedAt = "Fri, 17 Jul 2026 10:00:00 GMT";
  const response = normalizeAccountsResponse({
    accounts: [{ ...requiredAccountFields(1), refreshedAt }],
  });

  assert.equal(response.accounts[0].refreshedAt, refreshedAt);
});

test("preserves server account order", () => {
  const response = normalizeAccountsResponse({
    accounts: [requiredAccountFields(3), requiredAccountFields(1)],
  });

  assert.deepEqual(
    response.accounts.map((account) => account.accountKey),
    [3, 1],
  );
});

test("rejects malformed response envelopes and required fields", () => {
  const malformedResponses = [
    undefined,
    null,
    {},
    { accounts: null },
    { accounts: [{ ...requiredAccountFields(1), accountKey: 0 }] },
    { accounts: [{ ...requiredAccountFields(1), accountKey: 1.5 }] },
    {
      accounts: [{ ...requiredAccountFields(1), currencyKey: { code: "eur" } }],
    },
    {
      accounts: [
        {
          ...requiredAccountFields(1),
          accountOwnerAppuserKey: { currencyKey: { code: "EURO" } },
        },
      ],
    },
  ];

  for (const response of malformedResponses) {
    assert.throws(
      () => normalizeAccountsResponse(response),
      /^Error: Invalid accounts response$/,
    );
  }
});

test("rejects malformed and non-finite balances", () => {
  for (const balance of ["0", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        normalizeAccountsResponse({
          accounts: [{ ...requiredAccountFields(1), balance }],
        }),
      /^Error: Invalid accounts response$/,
    );
    assert.throws(
      () =>
        normalizeAccountsResponse({
          accounts: [
            { ...requiredAccountFields(1), appuserCurrencyBalance: balance },
          ],
        }),
      /^Error: Invalid accounts response$/,
    );
  }
});

test("rejects invalid refreshedAt values with a sanitized error", () => {
  for (const refreshedAt of ["", "   ", "not-a-date"]) {
    assert.throws(
      () =>
        normalizeAccountsResponse({
          accounts: [{ ...requiredAccountFields(1), refreshedAt }],
        }),
      /^Error: Invalid accounts response$/,
    );
  }
});

test("rejects present noncanonical sources instead of inferring", () => {
  for (const source of ["legacy-sync", "", { kind: "manual" }]) {
    assert.throws(
      () =>
        normalizeAccountsResponse({
          accounts: [
            {
              ...requiredAccountFields(1),
              refreshedAt: "2026-07-17T10:00:00.000Z",
              source,
            },
          ],
        }),
      /^Error: Invalid accounts response$/,
    );
  }
});

test("keeps the account's CSV import format, reading anything unknown as generic", () => {
  const response = normalizeAccountsResponse({
    accounts: [
      { ...requiredAccountFields(1), csvImportFormat: "bank" },
      { ...requiredAccountFields(2), csvImportFormat: "generic" },
      { ...requiredAccountFields(3), csvImportFormat: "something-new" },
    ],
  });

  assert.deepEqual(
    response.accounts.map((account) => account.csvImportFormat),
    ["bank", "generic", "generic"],
  );
});
