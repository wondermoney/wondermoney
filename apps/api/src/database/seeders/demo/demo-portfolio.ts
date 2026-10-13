export const demoPortfolios = [
  {
    currency: 'EUR',
    description: 'Long-term investments in a curated euro-denominated portfolio.',
    name: 'Long-term investments',
  },
  {
    currency: 'EUR',
    description: 'Short-term cash allocation for planned purchases.',
    name: 'Short-term opportunities',
  },
  {
    currency: 'USD',
    description: 'US growth sleeve for broader diversification.',
    name: 'US growth portfolio',
  },
] as const;

export const demoPortfolioHoldings = [
  { allocationHint: 'Cash reserve', portfolioName: 'Long-term investments', symbol: 'CURRENCY_EUR' },
  { allocationHint: 'Large cap tech', portfolioName: 'Long-term investments', symbol: 'AAPL' },
  { allocationHint: 'Search and cloud', portfolioName: 'Long-term investments', symbol: 'GOOGL' },
  { allocationHint: 'Semiconductors', portfolioName: 'Long-term investments', symbol: 'INTC' },
  { allocationHint: 'AI and GPUs', portfolioName: 'Long-term investments', symbol: 'NVDA' },
  { allocationHint: 'Enterprise software', portfolioName: 'Long-term investments', symbol: 'CRM' },
  { allocationHint: 'Analog chips', portfolioName: 'Long-term investments', symbol: 'TXN' },
] as const;
