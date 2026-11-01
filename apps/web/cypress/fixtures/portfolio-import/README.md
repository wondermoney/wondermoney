# Portfolio import E2E fixtures

`degiro-transactions.xlsx.base64` and `ibkr-flex-query.csv.base64` are sanitized
copies of real broker exports. Account, order, trade, execution, and transaction
identifiers were replaced with deterministic test values. The separate
`ibkr-complete-synthetic.csv` is explicitly synthetic, not a broker statement;
it supplies a small complete ledger for positive behavior checks.

The XLSX and original IBKR fixtures are base64-encoded. The synthetic CSV stays
plain text for inspection. The Cypress driver uses the same file-input
drag-and-drop path for all three.

## Coverage supplied by these exports

- DEGIRO: 9 trades, 2 ISIN positions, and EUR 15.00 of transaction fees.
- Original IBKR: 77 rows, comprising 31 stock trades and 46 unsupported FX
  trades. Its AMD sale on 2024-01-24 (row 8, quantity -6) exceeds the 4 AMD
  shares purchased in this file. With no opening holdings invented, that row is
  rejected, 30 stock trades are imported, and AMD ends at 12 shares. This
  incomplete export is a partial-import/oversell regression only: do not assert
  an aggregate realized gain from its missing opening basis.
  The accepted 30 stock rows have a raw nominal mixed-currency broker-fee
  checksum of 22.545189575 (EUR and USD are not converted or represented as a
  single-currency amount). Persisted `financial_transaction.fee_amount` is
  `numeric(18,4)`; each accepted fee is rounded to four decimals on persistence
  before the transaction API sums absolute fees, yielding 22.5457. For example,
  the first fee `-1.303264` persists as `-1.3033`. Rounding the raw aggregate
  once instead would yield 22.5452 and does not match the persistence contract.
  The offline ledger checker verifies both sums with exact decimal arithmetic.
- Synthetic IBKR complete positive ledger: six rows (five stock trades plus
  one unsupported EUR.USD row), five imported stock trades, and one skipped FX
  row. The EUR.USD quote currency is USD in `CurrencyPrimary`; its currency is
  valid and it is skipped later because the asset provider does not support the
  FX symbol. SPYL is the known EUR asset `IE000XZSV718` (matching the fixture catalog
  ticker); AMD is the known USD asset `US0079031078`. Final holdings are SPYL
  0.75 and AMD 0.50. Raw nominal fees are EUR 0.40 and USD 0.10; their raw
  cross-currency sum of 0.50 is not an EUR-converted total. Only SPYL contributes
  a realized-gain assertion, measured in EUR; the USD AMD buys are buy-only.

### Synthetic ledger calculation (EUR)

SPYL buys: 2.50 shares at EUR 100 with EUR 0.10 fee, then 1.25 shares at EUR 120
with EUR 0.10 fee. The 2024-01-04 sale is 3.00 shares at EUR 150 with EUR 0.20
fee. FIFO allocates all 2.50 shares from the first lot and 0.50 from the second:
gross gain is `(2.50 × (150 - 100)) + (0.50 × (150 - 120)) = EUR 140.00`.
Allocated buy fees are EUR 0.10 and EUR 0.04; the sale fee is EUR 0.20, so the
expected net realized gain is EUR 139.66. The two buy lots leave 0.75 SPYL shares.
AMD's two USD buy-only rows add 0.25 shares each and have USD 0.10 combined
fees (EUR 0.40 total EUR fees; USD 0.10 total USD fees). No USD amount is
converted or combined with the EUR realized-gain result.
The unsupported EUR.USD row contributes no holding, transaction, fee, or gain.

The supplied original IBKR export has no dividend activity, every `Taxes` value
is zero, and its stock quantities are whole numbers (fractional quantities are
only in skipped FX rows). The synthetic positive case uses fractional *stock*
quantities, but does not assert dividend withholding. The original export is
preserved byte-for-byte for its explicit partial/oversell regression.
