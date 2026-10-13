export const demoBudget = {
  name: 'Household budget',
  description: 'Curated household budget for Sofia Martins and family.',
  numAdults: 2,
  numDependents: 1,
  requiredCategories: [
    'GROCERIES',
    'CAFE_RESTAURANTS_BARS',
    'RENT_MORTGAGE',
    'FOOD_DELIVERY',
    'ELECTRICITY',
    'WATER',
  ] as const,
} as const;
