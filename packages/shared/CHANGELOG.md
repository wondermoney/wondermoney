# @wondermoney/shared

## 9.0.0

### Major Changes

- Remove the Nordigen and OpenFIGI clients and the generated Kysely database types, none of which
  any WonderMoney app uses any more (GoCardless/Nordigen was replaced by Enable Banking). Drops the
  axios, kysely, kysely-codegen, nordigen-node and pg dependencies.

## 8.3.0

### Minor Changes

- Add getScreener to the Eodhd SDK wrapper, delegating to the underlying client's stock screener endpoint and unwrapping the response to its data array (RAD-459)

## 8.1.0

### Minor Changes

- Add Eodhd SDK wrapper for the EODHD financial data provider migration (RAD-449)

## 8.0.5

### Patch Changes

- 5be0298: Preserve structured broker asset identity fields and fix OpenFIGI ISIN mapping payloads.

## 8.0.4

### Patch Changes

- a1db6b1: Add tenant_key and normalized_name to the generated transaction_merchant database schema.
- df2a554: Add shared portfolio transaction normalization helpers and tests.

## 8.0.3

### Patch Changes

- 161dbce: Update generated database types to match the latest public schema.

## 8.0.2

### Patch Changes

- e686f09: Fix AtivoBank transfer_in regex to match both "TRF. P/O NAME" and "TRF. P O NAME" formats

## 8.0.1

### Patch Changes

- 437b147: Fix ESM exports for fmp-node-sdk: replace `export *` with explicit named re-exports to produce static ESM export statements

## 8.0.0

### Major Changes

- 4ade1f4: db update

## 7.0.0

### Major Changes

- 920d915: update fmp

## 6.0.0

### Major Changes

- ba0e3e1: Replace custom FMP module with fmp-node-sdk package

  BREAKING CHANGE: The FMP API has changed from direct methods to a resource-based pattern:

  Before:

  ```typescript
  const fmp = new FMP({ apiKey: '...' });
  await fmp.getQuote('AAPL');
  await fmp.getCompanyInformation('AAPL');
  ```

  After:

  ```typescript
  const fmp = new FMP({ apiKey: '...' });
  await fmp.company.getQuote('AAPL');
  await fmp.company.getProfile('AAPL');
  ```

  The new SDK provides 300+ endpoints across 19 resource classes. See https://github.com/nip10/fmp-node-sdk for full documentation.

## 5.0.0

### Major Changes

- 715083b: rename fmt to fmp. remove legacy apis.

## 4.0.3

### Patch Changes

- fb15f9b: update db

## 4.0.2

### Patch Changes

- 028149f: fmt types

## 4.0.1

### Patch Changes

- 51b5516: add fmp earnings endpoint

## 4.0.0

### Major Changes

- 7221eea: update fmp endpoints

## 3.0.1

### Patch Changes

- 8e3f921: update db

## 3.0.0

### Major Changes

- a2f9a3f: nordigen auth tokens

## 2.0.0

### Major Changes

- e42329a: nordigen auth

## 1.1.0

### Minor Changes

- 1d768df: fmt bulk endpoints
- 491e5a4: Bump nordigen-node version

## 1.0.1

### Patch Changes

- 8d5b276: update news endpoint

## 1.0.0

### Major Changes

- aebfe6e: lets go

## 0.16.0

### Minor Changes

- e75596b: update db

## 0.15.0

### Minor Changes

- b3c600e: fmt add getBulkEodPrices

## 0.14.0

### Minor Changes

- 2b11d28: fmt add getBulkProfile

## 0.13.0

### Minor Changes

- 2d2d818: update db

## 0.12.0

### Minor Changes

- 86f1639: update db schema

## 0.11.0

### Minor Changes

- 3dce17a: use v4 endpoint for esg

## 0.10.0

### Minor Changes

- 2dbec4c: fmt - add esg score

## 0.9.0

### Minor Changes

- c5e3452: defer init of ext services

## 0.8.0

### Minor Changes

- 28786da: update db schema

## 0.7.0

### Minor Changes

- 2beeafe: update db schema

## 0.6.0

### Minor Changes

- 0ff2d98: add db types

## 0.4.1

### Patch Changes

- fa77aa1: rename exported variables. add docs.

## 0.4.0

### Minor Changes

- a4dbda3: move extract description to entities

## 0.3.2

### Patch Changes

- 07d1fba: export entities

## 0.3.1

### Patch Changes

- 02f3182: export types

## 0.3.0

### Minor Changes

- afcf25c: add nordigen service

## 0.2.0

### Minor Changes

- a240063: add csv parse
- cea7b7a: add openfigi service. add brokers csv.

## 0.1.0

### Minor Changes

- f4f3f29: add bank csv stuff

## 0.0.2

### Patch Changes

- 8edad61: init
