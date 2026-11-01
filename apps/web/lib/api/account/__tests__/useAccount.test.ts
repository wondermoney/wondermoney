import assert from "node:assert/strict";

import type { AxiosInstance } from "axios";
import { test } from "vitest";

import { getAccount, normalizeAccountResponse } from "../useAccount";

const requiredAccountFields = {
  accountKey: 132,
  currencyKey: { code: "EUR" },
  accountOwnerAppuserKey: { currencyKey: { code: "USD" } },
};

test("fetches account by id without mutating the route parameter", async () => {
  const requestedUrls: string[] = [];
  const apiClient = {
    get: async (url: string) => {
      requestedUrls.push(url);
      return { data: { account: requiredAccountFields } };
    },
  } as unknown as AxiosInstance;

  await getAccount(132, apiClient);

  assert.deepEqual(requestedUrls, ["/v1/account/132"]);
});

test("normalizes nullable account detail fields without inventing values", () => {
  const response = normalizeAccountResponse({
    account: {
      ...requiredAccountFields,
      accountName: null,
      accountFinancialInstitutionKey: null,
      balance: null,
      appuserCurrencyBalance: null,
      refreshedAt: null,
      source: "open_banking",
    },
  });

  assert.equal(response.account.accountName, null);
  assert.equal(response.account.accountFinancialInstitutionKey, null);
  assert.equal(response.account.balance, null);
  assert.equal(response.account.appuserCurrencyBalance, null);
  assert.equal(response.account.refreshedAt, null);
  assert.equal(response.account.source, "open_banking");
});

test("normalizes nullable institution metadata", () => {
  const response = normalizeAccountResponse({
    account: {
      ...requiredAccountFields,
      accountFinancialInstitutionKey: {
        displayName: null,
        logoUrl: null,
      },
    },
  });

  assert.deepEqual(response.account.accountFinancialInstitutionKey, {
    displayName: null,
    logoUrl: null,
  });
});

test("preserves zero original and converted balances", () => {
  const response = normalizeAccountResponse({
    account: {
      ...requiredAccountFields,
      balance: 0,
      appuserCurrencyBalance: 0,
    },
  });

  assert.equal(response.account.balance, 0);
  assert.equal(response.account.appuserCurrencyBalance, 0);
});

test("supports legacy detail payloads that omit additive fields", () => {
  const response = normalizeAccountResponse({
    account: {
      ...requiredAccountFields,
      accountName: "Daily account",
      accountFinancialInstitutionKey: { displayName: "Example Bank" },
      balance: 25,
      appuserCurrencyBalance: 30,
    },
  });

  assert.deepEqual(response.account.accountFinancialInstitutionKey, {
    displayName: "Example Bank",
    logoUrl: null,
  });
  assert.equal(response.account.refreshedAt, null);
  assert.equal(response.account.source, "manual");
});

test("supports finalized detail payloads", async () => {
  const finalizedAccount = {
    ...requiredAccountFields,
    accountName: "Daily account",
    accountFinancialInstitutionKey: {
      displayName: "Example Bank",
      logoUrl: "https://example.com/logo.svg",
    },
    balance: 25,
    appuserCurrencyBalance: 30,
    refreshedAt: "2026-07-17T10:00:00.000Z",
    source: "open_banking",
    isPrivate: false,
    isOwnedByViewer: false,
    ownerFirstName: null,
  };
  const apiClient = {
    get: async () => ({ data: { account: finalizedAccount } }),
  } as unknown as AxiosInstance;

  const response = await getAccount(132, apiClient);

  // The normalizer fills the three balance/sync fields the detail payload can
  // omit, so a finalized payload round-trips with those defaults added rather
  // than byte-identical. This file was never wired into a `test:*` script, so
  // the expectation went stale when normalizeAccountsResponse gained them.
  assert.deepEqual(response.account, {
    ...finalizedAccount,
    appuserCurrencyAvailableBalance: null,
    csvImportFormat: "generic",
    availableBalance: null,
    syncStatus: null,
  });
});
