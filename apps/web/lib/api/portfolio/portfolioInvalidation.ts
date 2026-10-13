export const getPortfolioCreateInvalidationKeys = () => [
  ["portfolios"],
  ["portfolio-dashboard"],
];

export const getPortfolioMutationsNetWorthInvalidationKeys = () => [
  ["net-worth"],
];

export const getPortfolioTransactionMutationInvalidationKeys = (
  portfolioId?: number,
) => [
  ["portfolio-dashboard"],
  ["portfolio-performance"],
  ["portfolio-top-movers"],
  ["portfolio-allocation"],
  ["portfolio-holdings"],
  ["portfolios-holdings"],
  ["portfolio-metrics"],
  ["portfolio-transactions"],
  ["portfolios-transactions"],
  ...(portfolioId === undefined
    ? []
    : [
        ["portfolio-dashboard", portfolioId],
        ["portfolio-performance", portfolioId],
        ["portfolio-top-movers", portfolioId],
        ["portfolio-allocation", portfolioId],
        ["portfolio-holdings", portfolioId],
        ["portfolio-transactions", { portfolioId }],
        ["portfolios-transactions", { portfolioId }],
      ]),
  ["portfolio-history-status"],
  ["portfolio"],
  ...getPortfolioMutationsNetWorthInvalidationKeys(),
];
