export const mfaFactorsKey = (epochId: number) => ['security', 'mfa-factors', epochId] as const
export const dataExportsKey = (epochId: number) => ['security', 'data-exports', epochId] as const
export const passkeysKey = (epochId: number) => ['security', 'passkeys', epochId] as const
