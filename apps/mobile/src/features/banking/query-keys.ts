const bankingRootKey = (epochId: number) => ['banking', epochId] as const

export const bankConnectionsKey = (epochId: number) =>
  [...bankingRootKey(epochId), 'connections'] as const

export const bankInstitutionsKey = (epochId: number, countryCode?: string) =>
  [...bankingRootKey(epochId), 'institutions', countryCode ?? 'auto'] as const

export const bankAlertsKey = (epochId: number) =>
  [...bankingRootKey(epochId), 'alerts'] as const

/** Keyed by provider too: a SimpleFIN connection id and an Enable Banking one can be equal. */
export const bankSyncHistoryKey = (epochId: number, connectionId: number, provider: string = 'EnableBanking') =>
  [...bankingRootKey(epochId), 'sync-history', provider, connectionId] as const

export const enableBankingCredentialKey = (epochId: number) =>
  [...bankingRootKey(epochId), 'enable-banking-credential'] as const
