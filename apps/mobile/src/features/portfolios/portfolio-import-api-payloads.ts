/**
 * Real API responses for the portfolio CSV import, captured so the mobile contract is tested
 * against what the server sends rather than against hand-written guesses (the asset-review
 * step shipped against a made-up shape and a route that does not exist).
 *
 * Provenance: captured on 2026-11-12 from `apps/api` at develop da31837 (after #290, so with
 * `importType` and the positions-mode fields this trades-only app ignores) by driving the real
 * routers (`@route/portfolio`, `@route/portfolio-import-session`) through `tenantHttp` against
 * the throwaway-Postgres test harness (`pg-test-db.ts`). Only the edges were stubbed: object
 * storage (a fixed CSV), the market-data search (two listings for one ISIN), the queue, and the
 * AI-availability gate on the suggest route. Everything else (validators, controllers, the
 * preview and asset-mapping services, MikroORM hydration, so `null` for empty columns) is
 * production code, and the values are the JSON bodies exactly as sent.
 *
 * - The upload-to-review flow: create session, trigger parse, the preview while the session needs
 *   column mapping, the column-mapping suggestion (local heuristic), the confirm response, and
 *   the preview after mapping (one ambiguous group, one unsupported asset skipped by the server).
 * - The asset review: a seeded session with ambiguous (recommended candidate, a candidate without
 *   a symbol), unmatched, provider-error and matched groups; the `PATCH .../asset-mappings`
 *   response for `use_existing_asset` + `skip_group`; and the preview after it.
 *
 * When the API changes these responses, recapture rather than hand-edit.
 */

export const createSession = {
  correlationId: 'portfolio.csv-import-session:1:1:feb696ff9c924c75b4d33abc6fea5117',
  expiresAt: '2026-11-19T17:04:06.899Z',
  importSessionId: 1,
  importType: 'trades',
  maxUploadSizeBytes: 5242880,
  s3Bucket: 'portfolio-csv-bucket',
  s3Key: 'portfolio-import-sessions/1/1/feb696ff9c924c75b4d33abc6fea5117.csv',
  status: 'waiting_for_upload',
  uploadHeaders: {
    'Content-Type': 'text/csv'
  },
  uploadMethod: 'PUT',
  uploadUrl: 'https://storage.example.test/upload'
} as const

export const triggerParse = {
  correlationId: 'portfolio.csv-parse-preview:1:43564cfe5b9b4ed4880ee474e96d0084',
  importSessionId: 1,
  status: 'parsing'
} as const

export const previewNeedsColumnMapping = {
  assetGroups: [],
  importSessionId: 1,
  importType: 'trades',
  limits: {
    rowsPerBucket: 25
  },
  portfolioId: 1,
  rows: {
    duplicate: [],
    existingTrades: [],
    failed: [],
    invalid: [],
    needsAssetReview: [],
    ready: []
  },
  status: 'needs_column_mapping',
  summary: {
    blockingRows: 0,
    canConfirm: false,
    duplicateRows: 0,
    existingTradeRows: 0,
    existingTradeSkippedRows: 0,
    failedRows: 0,
    importableRows: 0,
    importedRows: 0,
    invalidRows: 0,
    needsAssetReviewRows: 0,
    readyRows: 0,
    skippedRows: 0,
    totalRows: 0
  }
} as const

export const suggestColumnMapping = {
  columnMapping: {
    columnMapping: {
      currency: 'Currency',
      isin: 'ISIN',
      quantity: 'Quantity',
      ticker: 'Symbol',
      transactionDate: 'Date',
      transactionType: 'Type',
      unitPrice: 'Price'
    },
    confidence: 0.6,
    derivedValues: {},
    detectedBroker: null,
    fixedValues: {},
    layout: {
      dataStartRowIndex: 1,
      headerRowIndex: 0
    },
    transformations: {},
    warnings: [
      'local heuristic'
    ]
  },
  importSessionId: 1,
  mappingSource: 'local_heuristic',
  status: 'needs_column_mapping'
} as const

export const confirmColumnMapping = {
  importSessionId: 1,
  status: 'needs_asset_review',
  summary: {
    assetGroups: {
      ambiguousGroups: 1,
      matchedGroups: 0,
      providerErrorGroups: 0,
      skippedGroups: 1,
      totalGroups: 2,
      unmatchedGroups: 1
    },
    blockingRows: 1,
    canConfirm: false,
    duplicateRows: 0,
    importableRows: 0,
    importSessionId: 1,
    invalidRows: 0,
    needsAssetReviewRows: 1,
    readyRows: 0,
    skippedRows: 1,
    status: 'needs_asset_review',
    totalRows: 2,
    unsupportedAssets: [
      {
        skippedRows: 1,
        symbol: 'ZZZQ'
      }
    ]
  }
} as const

export const previewAfterColumnMapping = {
  assetGroups: [
    {
      candidates: [
        {
          confidence: 1,
          currency: 'EUR',
          exchange: 'AS',
          hasPriceHistory: false,
          id: 1,
          isin: 'NL0000000001',
          name: 'Example Fund',
          provider: 'eodhd',
          rejectedReason: null,
          symbol: 'EXF'
        },
        {
          confidence: 1,
          currency: 'EUR',
          exchange: 'XETRA',
          hasPriceHistory: false,
          id: 2,
          isin: 'NL0000000001',
          name: 'Example Fund',
          provider: 'eodhd',
          rejectedReason: null,
          symbol: 'EXF'
        }
      ],
      id: 1,
      identity: {
        brokerAssetName: null,
        brokerExchange: null,
        brokerTicker: 'EXF',
        currency: 'EUR',
        isin: 'NL0000000001'
      },
      resolutionReason: null,
      selectedAction: null,
      status: 'ambiguous'
    },
    {
      id: 2,
      identity: {
        brokerAssetName: null,
        brokerExchange: null,
        brokerTicker: 'ZZZQ',
        currency: 'EUR',
        isin: null
      },
      resolutionReason: 'unsupported_asset',
      selectedAction: 'skip_group',
      status: 'skipped'
    }
  ],
  columnMapping: {
    suggestion: {
      confidence: 0.6,
      columnMapping: {
        transactionDate: 'Date',
        transactionType: 'Type',
        isin: 'ISIN',
        ticker: 'Symbol',
        quantity: 'Quantity',
        unitPrice: 'Price',
        currency: 'Currency'
      },
      layout: {
        headerRowIndex: 0,
        dataStartRowIndex: 1
      }
    },
    confirmed: {
      columnMapping: {
        transactionDate: 'Date',
        transactionType: 'Type',
        isin: 'ISIN',
        ticker: 'Symbol',
        quantity: 'Quantity',
        unitPrice: 'Price',
        currency: 'Currency'
      },
      transformations: {
        dateFormat: 'yyyy-MM-dd'
      },
      layout: {
        headerRowIndex: 0,
        dataStartRowIndex: 1
      },
      confirmedAt: '2026-11-12T17:04:07.073Z'
    }
  },
  importSessionId: 1,
  importType: 'trades',
  limits: {
    rowsPerBucket: 25
  },
  portfolioId: 1,
  rows: {
    duplicate: [],
    existingTrades: [],
    failed: [],
    invalid: [],
    needsAssetReview: [
      {
        assetGroupId: 1,
        failureReason: null,
        id: 1,
        internalTransactionId: 'portfolio-import:row-hash:b1401332fa0853c48dcb9f4e48795bb2',
        normalized: {
          date: '2026-07-01T00:00:00.000Z',
          isin: 'NL0000000001',
          ticker: 'EXF',
          quantity: 3,
          unitPrice: 10.5,
          assetSymbol: 'EXF',
          transactionType: 'BUY',
          internalTransactionId: 'portfolio-import:row-hash:b1401332fa0853c48dcb9f4e48795bb2',
          settlementCurrencyCode: 'EUR'
        },
        raw: {
          Date: '2026-07-01',
          ISIN: 'NL0000000001',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'EXF',
          Currency: 'EUR',
          Quantity: '3'
        },
        rowNumber: 1,
        skipReason: null,
        status: 'needs_asset_review'
      }
    ],
    ready: []
  },
  status: 'needs_asset_review',
  summary: {
    assetGroups: {
      ambiguousGroups: 1,
      matchedGroups: 0,
      providerErrorGroups: 0,
      totalGroups: 2,
      unmatchedGroups: 1
    },
    blockingRows: 1,
    canConfirm: false,
    duplicateRows: 0,
    existingTradeRows: 0,
    existingTradeSkippedRows: 0,
    failedRows: 0,
    importableRows: 0,
    importedRows: 0,
    invalidRows: 0,
    needsAssetReviewRows: 1,
    readyRows: 0,
    skippedRows: 1,
    totalRows: 2,
    unsupportedAssets: [
      {
        skippedRows: 1,
        symbol: 'ZZZQ'
      }
    ]
  }
} as const

export const previewWithAssetGroups = {
  assetGroups: [
    {
      candidates: [
        {
          confidence: 0.92,
          currency: 'EUR',
          exchange: 'AS',
          hasPriceHistory: true,
          id: 1,
          isin: 'NL0000000001',
          name: 'Example Fund',
          provider: 'eodhd',
          rejectedReason: null,
          symbol: 'EXF.AS',
          isRecommended: true
        },
        {
          confidence: 0.61,
          currency: 'EUR',
          exchange: 'XETRA',
          hasPriceHistory: false,
          id: 2,
          isin: 'NL0000000001',
          name: 'Example Fund',
          provider: 'eodhd',
          rejectedReason: null,
          symbol: 'EXF.DE',
          isRecommended: false
        },
        {
          confidence: 0,
          currency: null,
          exchange: null,
          hasPriceHistory: false,
          id: 3,
          isin: null,
          name: 'Nameless listing',
          provider: 'eodhd',
          rejectedReason: 'no_symbol',
          symbol: null,
          isRecommended: false
        }
      ],
      id: 1,
      identity: {
        brokerAssetName: 'Example Fund',
        brokerExchange: 'XAMS',
        brokerTicker: 'EXF',
        currency: 'EUR',
        isin: 'NL0000000001'
      },
      resolutionReason: 'multiple_candidates',
      selectedAction: null,
      recommendationReason: 'isin_and_venue_match',
      recommendedCandidateId: 1,
      status: 'ambiguous'
    },
    {
      id: 2,
      identity: {
        brokerAssetName: null,
        brokerExchange: null,
        brokerTicker: 'ZZZQ',
        currency: null,
        isin: null
      },
      resolutionReason: null,
      selectedAction: null,
      status: 'unmatched'
    },
    {
      id: 3,
      identity: {
        brokerAssetName: 'Provider Down Corp',
        brokerExchange: null,
        brokerTicker: null,
        currency: null,
        isin: 'US0000000003'
      },
      resolutionReason: 'provider_error',
      selectedAction: null,
      status: 'provider_error'
    },
    {
      id: 4,
      identity: {
        brokerAssetName: 'Apple',
        brokerExchange: null,
        brokerTicker: 'AAPL',
        currency: 'USD',
        isin: null
      },
      resolutionReason: 'exact_symbol',
      selectedAction: null,
      selectedFinancialAssetId: 1,
      status: 'matched'
    }
  ],
  importSessionId: 1,
  importType: 'trades',
  limits: {
    rowsPerBucket: 25
  },
  portfolioId: 1,
  rows: {
    duplicate: [
      {
        assetGroupId: 4,
        failureReason: null,
        financialAssetId: 1,
        id: 6,
        internalTransactionId: 'dup-1',
        raw: {
          Date: '2026-07-01',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'AAPL',
          Quantity: '3'
        },
        rowNumber: 6,
        skipReason: null,
        status: 'duplicate'
      }
    ],
    existingTrades: [],
    failed: [],
    invalid: [
      {
        failureReason: 'Quantity is required',
        id: 5,
        internalTransactionId: null,
        raw: {
          Date: '2026-07-01',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'AAPL',
          Quantity: ''
        },
        rowNumber: 5,
        skipReason: null,
        status: 'invalid'
      }
    ],
    needsAssetReview: [
      {
        assetGroupId: 1,
        failureReason: null,
        id: 2,
        internalTransactionId: null,
        normalized: {
          symbol: 'EXF'
        },
        raw: {
          Date: '2026-07-01',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'EXF',
          Quantity: '3'
        },
        rowNumber: 2,
        skipReason: null,
        status: 'needs_asset_review'
      },
      {
        assetGroupId: 2,
        failureReason: null,
        id: 3,
        internalTransactionId: null,
        raw: {
          Date: '2026-07-01',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'ZZZQ',
          Quantity: '3'
        },
        rowNumber: 3,
        skipReason: null,
        status: 'needs_asset_review'
      },
      {
        assetGroupId: 3,
        failureReason: null,
        id: 4,
        internalTransactionId: null,
        raw: {
          Date: '2026-07-01',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'PDC',
          Quantity: '3'
        },
        rowNumber: 4,
        skipReason: null,
        status: 'needs_asset_review'
      }
    ],
    ready: [
      {
        assetGroupId: 4,
        failureReason: null,
        financialAssetId: 1,
        id: 1,
        internalTransactionId: null,
        normalized: {
          symbol: 'AAPL',
          quantity: '3',
          unitPrice: '10.5',
          transactionDate: '2026-07-01',
          transactionType: 'BUY'
        },
        raw: {
          Date: '2026-07-01',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'AAPL',
          Quantity: '3'
        },
        rowNumber: 1,
        skipReason: null,
        status: 'ready'
      }
    ]
  },
  status: 'needs_asset_review',
  summary: {
    assetGroups: {
      ambiguousGroups: 1,
      matchedGroups: 1,
      providerErrorGroups: 1,
      totalGroups: 4,
      unmatchedGroups: 1
    },
    blockingRows: 0,
    canConfirm: false,
    duplicateRows: 1,
    existingTradeRows: 0,
    existingTradeSkippedRows: 0,
    failedRows: 0,
    importableRows: 0,
    importedRows: 0,
    invalidRows: 1,
    needsAssetReviewRows: 3,
    readyRows: 1,
    skippedRows: 0,
    totalRows: 6
  }
} as const

export const confirmAssetMappings = {
  importSessionId: 1,
  status: 'needs_asset_review',
  summary: {
    readyRows: 2,
    totalRows: 6,
    assetGroups: {
      ambiguousGroups: 1,
      matchedGroups: 1,
      providerErrorGroups: 0,
      selectedGroups: 1,
      skippedGroups: 1,
      totalGroups: 4,
      unmatchedGroups: 0
    },
    invalidRows: 1,
    skippedRows: 1,
    duplicateRows: 1,
    needsAssetReviewRows: 1,
    canConfirm: false
  }
} as const

export const previewAfterAssetMappings = {
  assetGroups: [
    {
      candidates: [
        {
          confidence: 0.92,
          currency: 'EUR',
          exchange: 'AS',
          hasPriceHistory: true,
          id: 1,
          isin: 'NL0000000001',
          name: 'Example Fund',
          provider: 'eodhd',
          rejectedReason: null,
          symbol: 'EXF.AS',
          isRecommended: true
        },
        {
          confidence: 0.61,
          currency: 'EUR',
          exchange: 'XETRA',
          hasPriceHistory: false,
          id: 2,
          isin: 'NL0000000001',
          name: 'Example Fund',
          provider: 'eodhd',
          rejectedReason: null,
          symbol: 'EXF.DE',
          isRecommended: false
        },
        {
          confidence: 0,
          currency: null,
          exchange: null,
          hasPriceHistory: false,
          id: 3,
          isin: null,
          name: 'Nameless listing',
          provider: 'eodhd',
          rejectedReason: 'no_symbol',
          symbol: null,
          isRecommended: false
        }
      ],
      id: 1,
      identity: {
        brokerAssetName: 'Example Fund',
        brokerExchange: 'XAMS',
        brokerTicker: 'EXF',
        currency: 'EUR',
        isin: 'NL0000000001'
      },
      resolutionReason: 'multiple_candidates',
      selectedAction: null,
      recommendationReason: 'isin_and_venue_match',
      recommendedCandidateId: 1,
      status: 'ambiguous'
    },
    {
      id: 4,
      identity: {
        brokerAssetName: 'Apple',
        brokerExchange: null,
        brokerTicker: 'AAPL',
        currency: 'USD',
        isin: null
      },
      resolutionReason: 'exact_symbol',
      selectedAction: null,
      selectedFinancialAssetId: 1,
      status: 'matched'
    },
    {
      id: 3,
      identity: {
        brokerAssetName: 'Provider Down Corp',
        brokerExchange: null,
        brokerTicker: null,
        currency: null,
        isin: 'US0000000003'
      },
      resolutionReason: 'user_selected_existing_asset',
      selectedAction: 'use_existing_asset',
      selectedFinancialAssetId: 1,
      status: 'selected'
    },
    {
      id: 2,
      identity: {
        brokerAssetName: null,
        brokerExchange: null,
        brokerTicker: 'ZZZQ',
        currency: null,
        isin: null
      },
      resolutionReason: 'user_skipped_group',
      selectedAction: 'skip_group',
      status: 'skipped'
    }
  ],
  importSessionId: 1,
  importType: 'trades',
  limits: {
    rowsPerBucket: 25
  },
  portfolioId: 1,
  rows: {
    duplicate: [
      {
        assetGroupId: 4,
        failureReason: null,
        financialAssetId: 1,
        id: 6,
        internalTransactionId: 'dup-1',
        raw: {
          Date: '2026-07-01',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'AAPL',
          Quantity: '3'
        },
        rowNumber: 6,
        skipReason: null,
        status: 'duplicate'
      }
    ],
    existingTrades: [],
    failed: [],
    invalid: [
      {
        failureReason: 'Quantity is required',
        id: 5,
        internalTransactionId: null,
        raw: {
          Date: '2026-07-01',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'AAPL',
          Quantity: ''
        },
        rowNumber: 5,
        skipReason: null,
        status: 'invalid'
      }
    ],
    needsAssetReview: [
      {
        assetGroupId: 1,
        failureReason: null,
        id: 2,
        internalTransactionId: null,
        normalized: {
          symbol: 'EXF'
        },
        raw: {
          Date: '2026-07-01',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'EXF',
          Quantity: '3'
        },
        rowNumber: 2,
        skipReason: null,
        status: 'needs_asset_review'
      }
    ],
    ready: [
      {
        assetGroupId: 4,
        failureReason: null,
        financialAssetId: 1,
        id: 1,
        internalTransactionId: null,
        normalized: {
          symbol: 'AAPL',
          quantity: '3',
          unitPrice: '10.5',
          transactionDate: '2026-07-01',
          transactionType: 'BUY'
        },
        raw: {
          Date: '2026-07-01',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'AAPL',
          Quantity: '3'
        },
        rowNumber: 1,
        skipReason: null,
        status: 'ready'
      },
      {
        assetGroupId: 3,
        failureReason: null,
        financialAssetId: 1,
        id: 4,
        internalTransactionId: null,
        raw: {
          Date: '2026-07-01',
          Type: 'BUY',
          Price: '10.5',
          Symbol: 'PDC',
          Quantity: '3'
        },
        rowNumber: 4,
        skipReason: null,
        status: 'ready'
      }
    ]
  },
  status: 'needs_asset_review',
  summary: {
    assetGroups: {
      ambiguousGroups: 1,
      matchedGroups: 1,
      providerErrorGroups: 0,
      totalGroups: 4,
      unmatchedGroups: 0
    },
    blockingRows: 0,
    canConfirm: false,
    duplicateRows: 1,
    existingTradeRows: 0,
    existingTradeSkippedRows: 0,
    failedRows: 0,
    importableRows: 0,
    importedRows: 0,
    invalidRows: 1,
    needsAssetReviewRows: 1,
    readyRows: 2,
    skippedRows: 1,
    totalRows: 6
  }
} as const
