export const accountsKey = (epochId: number) => ['accounts', epochId] as const
export const accountKey = (epochId: number, accountId: number) => (
  ['account', epochId, accountId] as const
)
export const accountFamilyKey = (epochId: number) => ['account', epochId] as const
export const accountCurrenciesKey = (epochId: number) => ['account-create', epochId, 'currencies'] as const
export const accountInstitutionsKey = (epochId: number) => ['account-create', epochId, 'institutions'] as const
export const offlineAccountCreateGuardKey = (epochId: number) => ['account-create', epochId, 'unknown-outcome'] as const
