import type { BrokerImportCase } from "./cases";

export type PortfolioContext = {
  readonly accessToken: string;
  readonly portfolioId: number;
};

export type ImportPreview = {
  readonly rows: {
    readonly duplicate: readonly ImportPreviewRow[];
    readonly failed: readonly ImportPreviewRow[];
    readonly invalid: readonly ImportPreviewRow[];
    readonly needsAssetReview: readonly ImportPreviewRow[];
    readonly ready: readonly ImportPreviewRow[];
  };
  readonly summary: {
    readonly failedRows: number;
    readonly needsAssetReviewRows: number;
    readonly totalRows: number;
    readonly unsupportedAssets?: readonly {
      readonly symbol: string;
      readonly skippedRows: number;
    }[];
  };
};

type ImportPreviewRow = {
  readonly failureReason?: string;
  readonly id: number;
  readonly normalized?: Record<string, unknown>;
  readonly raw: Record<string, unknown>;
  readonly rowNumber: number;
  readonly skipReason?: string;
  readonly status: string;
};

type PortfolioTransaction = {
  readonly feeAmount?: number | string;
  readonly financialAssetKey: { readonly symbol: string };
  readonly itemType?: string;
  readonly quantity: number | string;
  readonly settlementCurrencyKey: { readonly code: string };
};

type ExpectedRejectedTransaction = NonNullable<
  BrokerImportCase["expectedRejectedTransaction"]
>;

export function unsupportedAssetsFromPreview(
  preview: Pick<ImportPreview, "summary">,
): NonNullable<ImportPreview["summary"]["unsupportedAssets"]> {
  return preview.summary.unsupportedAssets ?? [];
}

export function assertRejectedTransactionInPreview(
  preview: ImportPreview,
  expected: ExpectedRejectedTransaction,
  expectedFailedRows: number,
): ImportPreviewRow {
  if (!Array.isArray(preview.rows?.failed)) {
    throw new Error(
      "Import preview contract is missing rows.failed; cannot verify rejected transaction",
    );
  }
  if (preview.rows.failed.length !== expectedFailedRows) {
    throw new Error(
      `Import preview rows.failed expected ${expectedFailedRows} rows, got ${preview.rows.failed.length}`,
    );
  }

  const expectedDate = expected.date.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!expectedDate) {
    throw new Error(`Rejected transaction ${expected.transactionId} has an invalid expected date`);
  }
  const expectedNormalizedDate = `${expectedDate[1]}-${expectedDate[2]}-${expectedDate[3]}T00:00:00.000Z`;
  const expectedDirection = expected.quantity < 0 ? "SELL" : "BUY";
  const failedRow = preview.rows.failed.find((row) => {
    const normalized = row.normalized;
    if (!normalized) return false;

    const normalizedTicker = normalized["ticker"];
    const normalizedAssetSymbol = normalized["assetSymbol"];
    const hasExpectedAssetIdentity =
      (normalizedTicker === expected.symbol ||
        normalizedAssetSymbol === expected.symbol) &&
      (normalizedTicker === undefined || normalizedTicker === expected.symbol) &&
      (normalizedAssetSymbol === undefined ||
        normalizedAssetSymbol === expected.symbol);
    const raw = row.raw;
    const rawIdentityIsConsistent =
      (raw["TransactionID"] === undefined ||
        raw["TransactionID"] === expected.transactionId) &&
      (raw["Symbol"] === undefined || raw["Symbol"] === expected.symbol) &&
      (raw["TradeDate"] === undefined || raw["TradeDate"] === expected.date) &&
      (raw["Quantity"] === undefined ||
        Number(raw["Quantity"]) === expected.quantity);

    return (
      normalized["externalTransactionId"] === expected.transactionId &&
      hasExpectedAssetIdentity &&
      normalized["date"] === expectedNormalizedDate &&
      Number(normalized["quantity"]) === Math.abs(expected.quantity) &&
      normalized["transactionType"] === expectedDirection &&
      rawIdentityIsConsistent
    );
  });
  if (!failedRow) {
    throw new Error(
      `Import preview rows.failed is missing ${expected.symbol} transaction ${expected.transactionId} (${expected.date}, quantity ${expected.quantity})`,
    );
  }
  if (failedRow.status !== "failed") {
    throw new Error(
      `Rejected transaction ${expected.transactionId} has status ${failedRow.status}, expected failed`,
    );
  }
  if (
    !failedRow.failureReason ||
    !expected.reason.test(failedRow.failureReason)
  ) {
    throw new Error(
      `Rejected transaction ${expected.transactionId} failure reason did not match ${expected.reason}`,
    );
  }
  return failedRow;
}

export function persistedUnsupportedAssetSymbols(
  transactions: readonly PortfolioTransaction[],
  unsupportedAssets: readonly { readonly symbol: string }[],
): string[] {
  const skippedSymbols = new Set(unsupportedAssets.map(({ symbol }) => symbol));
  return transactions
    .map(({ financialAssetKey }) => financialAssetKey.symbol)
    .filter((symbol) => skippedSymbols.has(symbol));
}

export function assertImportPreview(
  preview: ImportPreview,
  input: BrokerImportCase,
): void {
  expect(preview.summary.totalRows).to.equal(input.expectedRows);
  expect(preview.summary.needsAssetReviewRows).to.equal(0);
  expect(unsupportedAssetsFromPreview(preview)).to.deep.equal(
    input.expectedUnsupportedAssets ?? [],
  );
  const isins = preview.rows.ready.flatMap((row) => {
    const value = row.normalized?.["isin"];
    return typeof value === "string" && value.length > 0 ? [value] : [];
  });
  expect([...new Set(isins)].sort()).to.deep.equal(
    [...input.expectedIsins].sort(),
  );
  if (input.expectedHoldingIdentities) {
    for (const expected of input.expectedHoldingIdentities) {
      expect(
        preview.rows.ready.some(
          (row) =>
            row.normalized?.["ticker"] === expected.symbol &&
            row.normalized?.["isin"] === expected.isin,
        ),
        `${expected.symbol} identity ${expected.isin}`,
      ).to.equal(true);
    }
  }
}

export function assertImportedTransactions(
  context: PortfolioContext,
  input: BrokerImportCase,
  apiBaseUrl: string,
): void {
  cy.request<{ transactions: PortfolioTransaction[] }>({
    failOnStatusCode: false,
    headers: { Authorization: `Bearer ${context.accessToken}` },
    log: false,
    url: `${apiBaseUrl}/v1/portfolio/${context.portfolioId}/transactions`,
  }).then(({ body, status }) => {
    expect(status, "portfolio transactions status").to.equal(200);
    const transactions = body.transactions.filter(
      (transaction) => transaction.itemType !== "STOCK_SPLIT",
    );
    expect(transactions).to.have.length(
      input.expectedImportedRows ?? input.expectedRows,
    );
    const fees = transactions.reduce(
      (total, transaction) =>
        total + Math.abs(Number(transaction.feeAmount ?? 0)),
      0,
    );
    expect(fees).to.be.closeTo(input.expectedFeeTotal, 0.000001);
    if (input.expectedFeesByCurrency) {
      const feesByCurrency = transactions.reduce<Record<string, number>>(
        (totals, transaction) => {
          const currency = transaction.settlementCurrencyKey.code;
          totals[currency] =
            (totals[currency] ?? 0) +
            Math.abs(Number(transaction.feeAmount ?? 0));
          return totals;
        },
        {},
      );
      expect(feesByCurrency).to.deep.equal(input.expectedFeesByCurrency);
    }

    if (input.expectedUnsupportedAssets?.length) {
      expect(
        persistedUnsupportedAssetSymbols(
          transactions,
          input.expectedUnsupportedAssets,
        ),
        "unsupported assets must not be persisted as transactions",
      ).to.deep.equal([]);
    }

    if (input.expectedTransactionDetails) {
      expect(
        transactions.some(
          (transaction) => !Number.isInteger(Number(transaction.quantity)),
        ),
      ).to.equal(input.expectedTransactionDetails.hasFractionalQuantity);
      expect(
        [
          ...new Set(
            transactions.map(
              (transaction) => transaction.settlementCurrencyKey.code,
            ),
          ),
        ].sort(),
      ).to.deep.equal([
        ...input.expectedTransactionDetails.settlementCurrencies,
      ]);
    }
  });
}

export function assertImportedHoldingQuantities(
  context: PortfolioContext,
  input: BrokerImportCase,
  apiBaseUrl: string,
): void {
  cy.request<{
    holdings: { financialAssetSymbol: string; quantity: number }[];
  }>({
    failOnStatusCode: false,
    headers: { Authorization: `Bearer ${context.accessToken}` },
    log: false,
    url: `${apiBaseUrl}/v1/portfolio/${context.portfolioId}/holdings`,
  }).then(({ body, status }) => {
    expect(status, "portfolio holdings status").to.equal(200);
    expect(
      body.holdings.map((holding) => holding.quantity).sort((a, b) => a - b),
    ).to.deep.equal([...input.expectedHoldingQuantities].sort((a, b) => a - b));
    if (input.expectedHoldingIdentities) {
      expect(
        body.holdings
          .map(({ financialAssetSymbol, quantity }) => ({
            symbol: financialAssetSymbol,
            quantity,
          }))
          .sort((a, b) => a.symbol.localeCompare(b.symbol)),
      ).to.deep.equal(
        input.expectedHoldingIdentities
          .map(({ symbol, quantity }) => ({ symbol, quantity }))
          .sort((a, b) => a.symbol.localeCompare(b.symbol)),
      );
    }
  });
}

export function assertRealizedGains(
  context: PortfolioContext,
  input: BrokerImportCase,
  apiBaseUrl: string,
): void {
  const expectedRealizedGain = input.expectedRealizedGain;
  if (expectedRealizedGain === undefined) return;
  cy.request<{ summary: { currency: string; realizedGains: number } }>({
    failOnStatusCode: false,
    headers: { Authorization: `Bearer ${context.accessToken}` },
    log: false,
    url: `${apiBaseUrl}/v1/portfolio/${context.portfolioId}/dashboard?period=ALL`,
  }).then(({ body, status }) => {
    expect(status, "portfolio dashboard status").to.equal(200);
    expect(body.summary.currency, "realized gain currency").to.equal("EUR");
    expect(body.summary.realizedGains).to.be.closeTo(
      expectedRealizedGain,
      0.01,
    );
  });
}
