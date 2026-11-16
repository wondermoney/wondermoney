export const demoPersona = {
  email: 'demo@wonder.money',
  firstName: 'Sofia',
  householdName: 'Sofia Martins household',
  lastName: 'Martins',
  primaryCurrency: 'EUR',
} as const;

/** Synthetic household member: no better-auth user or sign-in credentials are created. */
export const demoCompanion = {
  email: 'demo-partner@wondermoney.invalid',
  externalUserId: 'demo-fixture-partner',
  firstName: 'Miguel',
  lastName: 'Martins',
} as const;

export const demoAccounts = {
  card: {
    accountId: 'DEMO-CREDIT-CARD-001',
    accountName: 'Family credit card',
    accountNumber: 'DEMO-CARD-001',
    balance: -200,
    currency: 'EUR',
    holderName: 'Sofia Martins',
  },
  current: {
    accountId: '24603cf1-426f-47f0-af1e-b3b56629aaab-DEMO',
    accountName: 'ActivoBank Current Account',
    accountNumber: 'DEMO-PT-CURRENT-001',
    balance: 1832.97,
    currency: 'EUR',
    holderName: 'Sofia Martins',
  },
  savings: {
    accountId: '24603cf1-426f-47f0-af1e-b3b56629aaab-DEMO-SAVINGS',
    accountName: 'Emergency Fund',
    accountNumber: 'DEMO-PT-SAVINGS-001',
    balance: 3500,
    currency: 'EUR',
    holderName: 'Sofia Martins',
  },
  usd: {
    accountId: 'a10de53f-0133-4637-ab2b-e6bbb759d235-DEMO',
    accountName: 'Revolut USD Account',
    accountNumber: 'DEMO-USD-001',
    balance: 835.42,
    currency: 'USD',
    holderName: 'Sofia Martins',
  },
} as const;
