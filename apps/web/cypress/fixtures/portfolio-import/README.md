# Portfolio import E2E fixtures

These fixtures are sanitized copies of real DEGIRO and Interactive Brokers
exports. Account, order, trade, execution, and transaction identifiers were
replaced with deterministic test values. Financial columns were left unchanged
so positions, commissions, and realized P&L can be checked against fixed broker
totals.

The files are base64-encoded because one fixture is an XLSX workbook. The
Cypress driver decodes them before using the file input's drag-and-drop path.

## Coverage supplied by these exports

- DEGIRO: 9 trades, 2 ISIN positions, and EUR 15.00 of transaction fees.
- IBKR: 77 stock/FX executions across EUR and USD, fractional FX quantities,
  EUR 24.738798825 of commissions, and EUR 144.276636 of broker-reported
  realized P&L.

The supplied IBKR export has no dividend activity, every `Taxes` value is zero,
and its stock quantities are whole numbers. It therefore cannot prove
non-zero dividend withholding or fractional-share behavior. Add a separate
sanitized IBKR activity export containing those rows before adding such
assertions; do not synthesize them into this broker fixture.
