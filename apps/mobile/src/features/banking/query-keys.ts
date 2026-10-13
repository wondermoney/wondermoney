const bankingRootKey = (epochId: number) => ['banking', epochId] as const

export const bankConnectionsKey = (epochId: number) =>
  [...bankingRootKey(epochId), 'connections'] as const

export const bankInstitutionsKey = (epochId: number, countryCode?: string) =>
  [...bankingRootKey(epochId), 'institutions', countryCode ?? 'auto'] as const
