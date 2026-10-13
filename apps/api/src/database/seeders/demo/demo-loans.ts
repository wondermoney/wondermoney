export const demoLoans = {
  mortgage: {
    name: 'Home mortgage',
    providerName: 'Banco Atlântico',
    openingPrincipalBalance: 142_350,
    originalPrincipal: 185_000,
    regularPaymentAmount: 600,
  },
  carLoan: {
    name: 'Family car loan',
    providerName: 'Banco Auto',
    openingPrincipalBalance: 8420,
    originalPrincipal: 18_000,
    regularPaymentAmount: 245.8,
  },
} as const;
