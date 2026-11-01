export type BrokerImportCase = {
  readonly brokerLabel: string;
  readonly expectedFeeTotal: number;
  readonly expectedHoldingQuantities: readonly number[];
  readonly expectedIsins: readonly string[];
  readonly expectedRealizedGain?: number;
  readonly expectedRows: number;
  readonly expectedTerminalStatus: "succeeded" | "partial";
  readonly expectedTerminalKind: "success" | "partial_success";
  readonly expectedImportedRows: number;
  readonly expectedFailedRows: number;
  readonly expectedSkippedRows: number;
  readonly expectedRejectedTransaction?: {
    readonly symbol: string;
    readonly transactionId: string;
    readonly date: string;
    readonly quantity: number;
    readonly reason: RegExp;
  };
  readonly expectedHoldingIdentities?: readonly {
    readonly symbol: string;
    readonly isin: string;
    readonly quantity: number;
  }[];
  readonly expectedFeesByCurrency?: Readonly<Record<string, number>>;
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
  readonly fixtureIsBase64?: boolean;
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
  expectedTerminalStatus: "succeeded",
  expectedTerminalKind: "success",
  expectedImportedRows: 9,
  expectedFailedRows: 0,
  expectedSkippedRows: 0,
  fixtureIsBase64: true,
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

const ibkrPartialImport: BrokerImportCase = {
  brokerLabel: "Interactive Broker",
  // The raw nominal mixed-currency broker checksum is 22.545189575. Persisted
  // fees use numeric(18,4), so quantizing each accepted row before summing gives 22.5457.
  expectedFeeTotal: 22.5457,
  // The original export is incomplete for AMD: its 2024-01-24 sell of 6
  // exceeds the 4 shares bought in this file. Do not seed opening holdings.
  expectedHoldingQuantities: [5, 6, 9, 12, 31, 51, 330],
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
  expectedRows: 77,
  expectedImportedRows: 30,
  expectedFailedRows: 1,
  expectedSkippedRows: 46,
  expectedTerminalStatus: "partial",
  expectedTerminalKind: "partial_success",
  expectedRejectedTransaction: {
    symbol: "AMD",
    transactionId: "TEST-TRANSACTIONID-007",
    date: "20240124",
    quantity: -6,
    reason: /sell quantity exceeds available holdings/i,
  },
  expectedUnsupportedAssets: [{ symbol: "EUR.USD", skippedRows: 46 }],
  expectedTransactionDetails: {
    hasFractionalQuantity: false,
    settlementCurrencies: ["EUR", "USD"],
  },
  fileName: "ibkr-flex-query.csv",
  fixture: "portfolio-import/ibkr-flex-query.csv.base64",
  fixtureIsBase64: true,
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

const ibkrCompleteSyntheticImport: BrokerImportCase = {
  brokerLabel: "Interactive Broker",
  // Raw fee check sums nominal EUR and USD fees without conversion.
  expectedFeeTotal: 0.5,
  expectedHoldingQuantities: [0.5, 0.75],
  expectedIsins: ["IE000XZSV718", "US0079031078"],
  expectedRealizedGain: 139.66,
  expectedRows: 6,
  expectedImportedRows: 5,
  expectedFailedRows: 0,
  expectedSkippedRows: 1,
  expectedTerminalStatus: "partial",
  expectedTerminalKind: "partial_success",
  expectedHoldingIdentities: [
    { symbol: "SPYL", isin: "IE000XZSV718", quantity: 0.75 },
    { symbol: "AMD", isin: "US0079031078", quantity: 0.5 },
  ],
  expectedFeesByCurrency: { EUR: 0.4, USD: 0.1 },
  expectedUnsupportedAssets: [{ symbol: "EUR.USD", skippedRows: 1 }],
  expectedTransactionDetails: {
    hasFractionalQuantity: true,
    settlementCurrencies: ["EUR", "USD"],
  },
  fileName: "ibkr-complete-synthetic.csv",
  fixture: "portfolio-import/ibkr-complete-synthetic.csv",
  mapping: {
    columnMapping: {
      assetName: "Description",
      brokerExchange: "ListingExchange",
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

export const BROKER_IMPORT_CASES = [
  degiroImport,
  ibkrCompleteSyntheticImport,
  ibkrPartialImport,
] as const;
