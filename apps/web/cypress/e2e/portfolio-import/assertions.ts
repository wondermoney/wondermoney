import type { BrokerImportCase } from "./cases";

export type PortfolioContext = {
  readonly accessToken: string;
  readonly portfolioId: number;
};

export type ImportPreview = {
  readonly rows: {
    readonly ready: readonly {
      readonly normalized?: Record<string, unknown>;
    }[];
  };
  readonly summary: {
    readonly needsAssetReviewRows: number;
    readonly totalRows: number;
    readonly unsupportedAssets?: readonly {
      readonly symbol: string;
      readonly skippedRows: number;
    }[];
  };
};

type PortfolioTransaction = {
  readonly feeAmount?: number | string;
  readonly itemType?: string;
  readonly quantity: number | string;
  readonly settlementCurrencyKey: { readonly code: string };
};

export function assertImportPreview(
  preview: ImportPreview,
  input: BrokerImportCase,
): void {
  expect(preview.summary.totalRows).to.equal(input.expectedRows);
  expect(preview.summary.needsAssetReviewRows).to.equal(0);
  expect(preview.summary.unsupportedAssets ?? []).to.deep.equal(
    input.expectedUnsupportedAssets ?? [],
  );
  const isins = preview.rows.ready.flatMap((row) => {
    const value = row.normalized?.["isin"];
    return typeof value === "string" && value.length > 0 ? [value] : [];
  });
  expect([...new Set(isins)].sort()).to.deep.equal(
    [...input.expectedIsins].sort(),
  );
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
      ).to.deep.equal([...input.expectedTransactionDetails.settlementCurrencies]);
    }
  });
}

export function assertImportedHoldingQuantities(
  context: PortfolioContext,
  input: BrokerImportCase,
  apiBaseUrl: string,
): void {
  cy.request<{ holdings: { quantity: number }[] }>({
    failOnStatusCode: false,
    headers: { Authorization: `Bearer ${context.accessToken}` },
    log: false,
    url: `${apiBaseUrl}/v1/portfolio/${context.portfolioId}/holdings`,
  }).then(({ body, status }) => {
    expect(status, "portfolio holdings status").to.equal(200);
    expect(
      body.holdings.map((holding) => holding.quantity).sort((a, b) => a - b),
    ).to.deep.equal(
      [...input.expectedHoldingQuantities].sort((a, b) => a - b),
    );
  });
}

export function assertRealizedGains(
  context: PortfolioContext,
  input: BrokerImportCase,
  apiBaseUrl: string,
): void {
  cy.request<{ summary: { realizedGains: number } }>({
    failOnStatusCode: false,
    headers: { Authorization: `Bearer ${context.accessToken}` },
    log: false,
    url: `${apiBaseUrl}/v1/portfolio/${context.portfolioId}/dashboard?period=ALL`,
  }).then(({ body, status }) => {
    expect(status, "portfolio dashboard status").to.equal(200);
    expect(body.summary.realizedGains).to.be.closeTo(
      input.expectedRealizedGain,
      0.01,
    );
  });
}
