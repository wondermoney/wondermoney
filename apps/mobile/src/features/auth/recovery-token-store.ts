export type RecoveryTokens = Readonly<{
  token: string
}>

let pending: RecoveryTokens | null = null

export function setPendingRecoveryTokens(tokens: RecoveryTokens): void {
  pending = tokens
}

export function takePendingRecoveryTokens(): RecoveryTokens | null {
  const tokens = pending
  pending = null
  return tokens
}
