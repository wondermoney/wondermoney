import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildHoldingActivitySummary,
  buildHoldingPositionSummary,
} from "./holding-detail-summary";

test("buildHoldingPositionSummary derives invested amount and preserves values", () => {
  const summary = buildHoldingPositionSummary({
    currentPrice: 12.5,
    currentValue: 250,
    financialAssetKey: 1,
    financialAssetName: "Example Corp",
    financialAssetSymbol: "EXM",
    financialAssetType: "STOCK",
    financialAssetLogoUrl: "https://example.com/logo.png",
    quantity: 20,
    averageBuyPrice: 10,
    allocation: 0.25,
    currency: "USD",
    unrealizedGains: 50,
    unrealizedGainsPercentage: 0.25,
    isInvalid: true,
    invalidReason: "stale-price",
  } as any);

  assert.equal(summary.symbol, "EXM");
  assert.equal(summary.name, "Example Corp");
  assert.equal(summary.type, "STOCK");
  assert.equal(summary.logoUrl, "https://example.com/logo.png");
  assert.equal(summary.currency, "USD");
  assert.equal(summary.quantity, 20);
  assert.equal(summary.averageCost, 10);
  assert.equal(summary.investedAmount, 200);
  assert.equal(summary.currentValue, 250);
  assert.equal(summary.unrealizedGains, 50);
  assert.equal(summary.unrealizedGainsPercentage, 0.25);
  assert.equal(summary.portfolioWeight, 0.25);
  assert.equal(summary.isInvalid, true);
  assert.equal(summary.invalidReason, "stale-price");
});

test("buildHoldingPositionSummary keeps pending values null", () => {
  const summary = buildHoldingPositionSummary({
    currentPrice: null,
    currentValue: null,
    financialAssetKey: 1,
    financialAssetName: "Example Corp",
    financialAssetSymbol: "EXM",
    financialAssetType: "STOCK",
    quantity: 3,
    averageBuyPrice: 4,
    allocation: null,
    currency: "USD",
    unrealizedGains: null,
    unrealizedGainsPercentage: null,
  } as any);

  assert.equal(summary.currentValue, null);
  assert.equal(summary.currentPrice, null);
  assert.equal(summary.portfolioWeight, null);
  assert.equal(summary.unrealizedGains, null);
  assert.equal(summary.unrealizedGainsPercentage, null);
});

test("buildHoldingActivitySummary summarizes transaction activity", () => {
  const transactions: any[] = [
    {
      itemType: "TRANSACTION",
      transactionKey: 1,
      transactionDate: new Date("2024-01-10"),
      quantity: "2",
      currencyKey: { code: "USD", currencyKey: 1 },
      financialTransactionTypeKey: { name: "Buy", financialTransactionTypeKey: 1 },
      financialBrokerKey: { name: "Broker", financialBrokerKey: 1 },
      originalAmount: "20",
      originalCurrencyKey: { code: "USD", currencyKey: 1 },
      originalUnitAmount: "10",
      settlementUnitAmount: "11",
      settlementAmount: "22",
      settlementCurrencyKey: { code: "USD", currencyKey: 1 },
      settlementExchangeRate: "1",
      appuserUnitAmount: "10",
      appuserSettlementAmount: "21",
      appuserCurrencyExchangeRate: "1",
      feeAmount: "0",
      feeCurrencyKey: { code: "USD", currencyKey: 1 },
      financialAssetKey: { name: "Example", symbol: "EXM" },
      financialAssetExchangeKey: { name: "NYSE" },
      portfolioKey: { name: "Main", portfolioKey: 1 },
    } as any,
    {
      itemType: "TRANSACTION",
      transactionKey: 2,
      transactionDate: new Date("2024-02-15"),
      quantity: "1",
      currencyKey: { code: "USD", currencyKey: 1 },
      financialTransactionTypeKey: { name: "Sell", financialTransactionTypeKey: 2 },
      financialBrokerKey: { name: "Broker", financialBrokerKey: 1 },
      originalAmount: "15",
      originalCurrencyKey: { code: "USD", currencyKey: 1 },
      originalUnitAmount: "15",
      settlementUnitAmount: "14",
      settlementAmount: "14",
      settlementCurrencyKey: { code: "USD", currencyKey: 1 },
      settlementExchangeRate: "1",
      appuserUnitAmount: "15",
      appuserSettlementAmount: "-13.5",
      appuserCurrencyExchangeRate: "1",
      feeAmount: "0",
      feeCurrencyKey: { code: "USD", currencyKey: 1 },
      financialAssetKey: { name: "Example", symbol: "EXM" },
      financialAssetExchangeKey: { name: "NYSE" },
      portfolioKey: { name: "Main", portfolioKey: 1 },
    } as any,
    {
      itemType: "TRANSACTION",
      transactionKey: 3,
      transactionDate: new Date("2024-02-20"),
      quantity: "0",
      currencyKey: { code: "USD", currencyKey: 1 },
      financialTransactionTypeKey: { name: "Dividend", financialTransactionTypeKey: 3 },
      financialBrokerKey: { name: "Broker", financialBrokerKey: 1 },
      originalAmount: "5",
      originalCurrencyKey: { code: "USD", currencyKey: 1 },
      originalUnitAmount: "5",
      settlementUnitAmount: "5",
      settlementAmount: "5",
      settlementCurrencyKey: { code: "USD", currencyKey: 1 },
      settlementExchangeRate: "1",
      appuserUnitAmount: "5",
      appuserSettlementAmount: "5.5",
      appuserCurrencyExchangeRate: "1",
      feeAmount: "0",
      feeCurrencyKey: { code: "USD", currencyKey: 1 },
      financialAssetKey: { name: "Example", symbol: "EXM" },
      financialAssetExchangeKey: { name: "NYSE" },
      portfolioKey: { name: "Main", portfolioKey: 1 },
    } as any,
    {
      id: "split-1",
      itemType: "STOCK_SPLIT",
      transactionDate: "2024-03-01",
      financialAssetKey: { financialAssetKey: 1, name: "Example", symbol: "EXM", logoUrl: undefined, esgScore: undefined },
      numerator: 2,
      denominator: 1,
      splitRatio: "2:1",
      editable: false,
    } as any,
  ];
  const summary = buildHoldingActivitySummary(transactions);

  assert.equal(summary.transactionCount, 4);
  assert.equal(summary.firstTransactionDate?.toISOString(), "2024-01-10T00:00:00.000Z");
  assert.equal(summary.lastTransactionDate?.toISOString(), "2024-03-01T00:00:00.000Z");
  assert.equal(summary.totalBought, 21);
  assert.equal(summary.totalSold, 13.5);
  assert.equal(summary.dividendsReceived, 5.5);
  assert.equal(summary.netInvested, 7.5);
});

test("buildHoldingActivitySummary falls back to settlement amount when appuser settlement amount is missing", () => {
  const summary = buildHoldingActivitySummary([
    {
      itemType: "TRANSACTION",
      transactionKey: 5,
      transactionDate: new Date("2024-05-01"),
      quantity: "1",
      currencyKey: { code: "USD", currencyKey: 1 },
      financialTransactionTypeKey: { name: "Buy", financialTransactionTypeKey: 1 },
      financialBrokerKey: { name: "Broker", financialBrokerKey: 1 },
      originalAmount: "10",
      originalCurrencyKey: { code: "USD", currencyKey: 1 },
      originalUnitAmount: "10",
      settlementUnitAmount: "10",
      settlementAmount: "10",
      settlementCurrencyKey: { code: "USD", currencyKey: 1 },
      settlementExchangeRate: "1",
      appuserUnitAmount: "",
      appuserSettlementAmount: "",
      appuserCurrencyExchangeRate: "1",
      feeAmount: "0",
      feeCurrencyKey: { code: "USD", currencyKey: 1 },
      financialAssetKey: { name: "Example", symbol: "EXM" },
      financialAssetExchangeKey: { name: "NYSE" },
      portfolioKey: { name: "Main", portfolioKey: 1 },
    },
    {
      itemType: "TRANSACTION",
      transactionKey: 6,
      transactionDate: new Date("2024-05-02"),
      quantity: "1",
      currencyKey: { code: "USD", currencyKey: 1 },
      financialTransactionTypeKey: { name: "Sell", financialTransactionTypeKey: 2 },
      financialBrokerKey: { name: "Broker", financialBrokerKey: 1 },
      originalAmount: "8",
      originalCurrencyKey: { code: "USD", currencyKey: 1 },
      originalUnitAmount: "8",
      settlementUnitAmount: "8",
      settlementAmount: "8",
      settlementCurrencyKey: { code: "USD", currencyKey: 1 },
      settlementExchangeRate: "1",
      appuserUnitAmount: null as any,
      appuserSettlementAmount: null as any,
      appuserCurrencyExchangeRate: "1",
      feeAmount: "0",
      feeCurrencyKey: { code: "USD", currencyKey: 1 },
      financialAssetKey: { name: "Example", symbol: "EXM" },
      financialAssetExchangeKey: { name: "NYSE" },
      portfolioKey: { name: "Main", portfolioKey: 1 },
    },
    {
      itemType: "TRANSACTION",
      transactionKey: 7,
      transactionDate: new Date("2024-05-03"),
      quantity: "0",
      currencyKey: { code: "USD", currencyKey: 1 },
      financialTransactionTypeKey: { name: "Dividend", financialTransactionTypeKey: 3 },
      financialBrokerKey: { name: "Broker", financialBrokerKey: 1 },
      originalAmount: "3",
      originalCurrencyKey: { code: "USD", currencyKey: 1 },
      originalUnitAmount: "3",
      settlementUnitAmount: "3",
      settlementAmount: "3",
      settlementCurrencyKey: { code: "USD", currencyKey: 1 },
      settlementExchangeRate: "1",
      appuserUnitAmount: undefined as any,
      appuserSettlementAmount: undefined as any,
      appuserCurrencyExchangeRate: "1",
      feeAmount: "0",
      feeCurrencyKey: { code: "USD", currencyKey: 1 },
      financialAssetKey: { name: "Example", symbol: "EXM" },
      financialAssetExchangeKey: { name: "NYSE" },
      portfolioKey: { name: "Main", portfolioKey: 1 },
    },
  ]);

  assert.equal(summary.totalBought, 10);
  assert.equal(summary.totalSold, 8);
  assert.equal(summary.dividendsReceived, 3);
  assert.equal(summary.netInvested, 2);
});

test("buildHoldingActivitySummary handles empty transactions", () => {
  const summary = buildHoldingActivitySummary([]);

  assert.equal(summary.transactionCount, 0);
  assert.equal(summary.firstTransactionDate, null);
  assert.equal(summary.lastTransactionDate, null);
  assert.equal(summary.totalBought, 0);
  assert.equal(summary.totalSold, 0);
  assert.equal(summary.dividendsReceived, 0);
  assert.equal(summary.netInvested, 0);
});

test("buildHoldingActivitySummary ignores unknown types for totals but keeps date range", () => {
  const summary = buildHoldingActivitySummary([
    {
      itemType: "TRANSACTION",
      transactionKey: 4,
      transactionDate: new Date("2024-04-01"),
      quantity: "1",
      currencyKey: { code: "USD", currencyKey: 1 },
      financialTransactionTypeKey: { name: "Bonus", financialTransactionTypeKey: 4 },
      financialBrokerKey: { name: "Broker", financialBrokerKey: 1 },
      originalAmount: "abc",
      originalCurrencyKey: { code: "USD", currencyKey: 1 },
      originalUnitAmount: "def",
      settlementUnitAmount: "ghi",
      settlementAmount: "jkl",
      settlementCurrencyKey: { code: "USD", currencyKey: 1 },
      settlementExchangeRate: "1",
      appuserUnitAmount: "mno",
      appuserSettlementAmount: "pqr",
      appuserCurrencyExchangeRate: "1",
      feeAmount: "0",
      feeCurrencyKey: { code: "USD", currencyKey: 1 },
      financialAssetKey: { name: "Example", symbol: "EXM" },
      financialAssetExchangeKey: { name: "NYSE" },
      portfolioKey: { name: "Main", portfolioKey: 1 },
    },
  ]);

  assert.equal(summary.transactionCount, 1);
  assert.equal(summary.firstTransactionDate?.toISOString(), "2024-04-01T00:00:00.000Z");
  assert.equal(summary.lastTransactionDate?.toISOString(), "2024-04-01T00:00:00.000Z");
  assert.equal(summary.totalBought, 0);
  assert.equal(summary.totalSold, 0);
  assert.equal(summary.dividendsReceived, 0);
  assert.equal(summary.netInvested, 0);
});
