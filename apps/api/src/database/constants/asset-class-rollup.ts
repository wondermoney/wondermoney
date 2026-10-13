export const ASSET_CLASSES: { name: string; sortOrder: number }[] = [
  { name: 'Equities', sortOrder: 1 },
  { name: 'Fixed Income', sortOrder: 2 },
  { name: 'Cash & Equivalents', sortOrder: 3 },
  { name: 'Alternatives', sortOrder: 4 },
  { name: 'Crypto', sortOrder: 5 },
];

export const FINANCIAL_ASSET_TYPE_TO_ASSET_CLASS: Record<string, string> = {
  Bond: 'Fixed Income',
  Cash: 'Cash & Equivalents',
  Crypto: 'Crypto',
  Derivative: 'Alternatives',
  ETF: 'Equities',
  Loan: 'Alternatives',
  'Mutual Fund': 'Equities',
  'Savings Certificate': 'Fixed Income',
  Stock: 'Equities',
};
