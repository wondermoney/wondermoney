let pending: string | null = null

export function setPendingInviteToken(token: string): void {
  pending = token
}

export function takePendingInviteToken(): string | null {
  const token = pending
  pending = null
  return token
}
