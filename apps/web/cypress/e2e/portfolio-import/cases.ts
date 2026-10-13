export type BrokerImportCase = {
  readonly brokerLabel: string;
  readonly expectedFeeTotal: number;
  readonly expectedHoldingQuantities: readonly number[];
  readonly expectedIsins: readonly string[];
  readonly expectedRealizedGain: number;
  readonly expectedRows: number;
  readonly expectedImportedRows?: number;
  readonly expectedUnsupportedAssets?: readonly {
    readonly symbol: string;
    readonly skippedRows: number;
  }[];
  readonly expectedTransactionDetails?: {
    readonly hasFractionalQuantity: boolean;
    readonly settlementCurrencies: readonly string[];
  };
  readonly fileName: string;
  readonly fixture: string;
  readonly mapping: Record<string, unknown>;
  readonly mimeType: string;
};

const degiroImport: BrokerImportCase = {
  brokerLabel: "Degiro",
  expectedFeeTotal: 15,
  expectedHoldingQuantities: [17, 18],
  expectedIsins: ["IE00B4L5Y983", "IE00BLNMYC90"],
  expectedRealizedGain: 962.305,
  expectedRows: 9,
  fileName: "degiro-transactions.xlsx",
  fixture: "portfolio-import/degiro-transactions.xlsx.base64",
  mapping: {
    columnMapping: {
      assetName: "Product",
      brokerExchange: "Venue",
      feeAmount: "Transaction and/or third party fees EUR",
      isin: "ISIN",
      quantity: "Quantity",
      totalAmount: "Value EUR",
      transactionDate: "Date",
      unitPrice: "Price ",
    },
    derivedValues: { transactionType: "quantitySign" },
    fixedValues: { currency: "EUR" },
    layout: { dataStartRowIndex: 1, headerRowIndex: 0 },
    transformations: {
      dateFormat: "dd-MM-yyyy",
      decimalSeparator: ".",
      quantitySignIndicatesDirection: true,
      thousandsSeparator: "none",
    },
  },
  mimeType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const ibkrImport: BrokerImportCase = {
  brokerLabel: "Interactive Broker",
  expectedFeeTotal: 22.893478825,
  expectedHoldingQuantities: [5, 6, 6, 9, 31, 51, 330],
  expectedIsins: [
    "IE000XZSV718",
    "IE00BFMXXD54",
    "US0079031078",
    "US2546871060",
    "IE00BFM6TC58",
    "US36467W1099",
    "US02079K3059",
    "IE00BJ5JPG56",
    "US4581401001",
    "US75734B1008",
    "US88080T1043",
  ],
  expectedRealizedGain: 144.276636,
  expectedRows: 77,
  expectedImportedRows: 31,
  expectedUnsupportedAssets: [{ symbol: "EUR.USD", skippedRows: 46 }],
  expectedTransactionDetails: {
    hasFractionalQuantity: true,
    settlementCurrencies: ["EUR", "USD"],
  },
  fileName: "ibkr-flex-query.csv",
  fixture: "portfolio-import/ibkr-flex-query.csv.base64",
  mapping: {
    columnMapping: {
      assetName: "Description",
      brokerExchange: "Exchange",
      currency: "CurrencyPrimary",
      externalTransactionId: "TransactionID",
      feeAmount: "IBCommission",
      isin: "ISIN",
      quantity: "Quantity",
      ticker: "Symbol",
      transactionDate: "TradeDate",
      transactionType: "Buy/Sell",
      unitPrice: "TradePrice",
    },
    layout: { dataStartRowIndex: 1, headerRowIndex: 0 },
    transformations: {
      dateFormat: "yyyyMMdd",
      decimalSeparator: ".",
      thousandsSeparator: "none",
    },
  },
  mimeType: "text/csv",
};

export const BROKER_IMPORT_CASES = [degiroImport, ibkrImport] as const;
