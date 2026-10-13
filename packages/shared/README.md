# @wondermoney/shared

Shared utilities and services for WonderMoney applications.

A private workspace package: the API depends on it as `workspace:*`. Build it with
`pnpm --filter @wondermoney/shared build:lib` (the root `pnpm build:lib` builds both packages).

## What is included

- **CSV and spreadsheet parsing** (`csv`): bank and broker statement parsers
  (`getBankParser`, `getBrokerParser`), `parseExcel` and `parseCsv`.
- **Transaction helpers**: `generateInternalTransactionId` (a stable id used to de-duplicate
  imported bank transactions), `generateInternalFinancialTransactionId`,
  `normalizePortfolioTransactionQuantity` and `extractDataFromTransactionDescription`.
- **EODHD client** (`Eodhd`, `EodhdError`, `EodhdTypes`): market data — ticker search, quotes,
  historical prices, dividends, splits, fundamentals and news.

## Usage

```typescript
import { csv, Eodhd, EodhdError, generateInternalTransactionId } from '@wondermoney/shared';

const eodhd = new Eodhd({ apiKey: process.env.EODHD_API_KEY });

try {
  const results = await eodhd.search('Apple');
} catch (error) {
  if (error instanceof EodhdError) {
    console.error(error.code, error.status, error.message);
  }
}
```

`EodhdConfig` accepts `apiKey`, `baseUrl` and `debug`. The client has no cache of its own; the
API caches market-data responses.

## Checks

```bash
pnpm --filter @wondermoney/shared test
pnpm --filter @wondermoney/shared lint
```
