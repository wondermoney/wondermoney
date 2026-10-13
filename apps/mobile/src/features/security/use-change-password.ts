import { useMutation } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { ChangePasswordOutcome } from '@/lib/auth/app-auth'

export type ChangePasswordPayload = Readonly<{
  email: string
  currentPassword: string
  newPassword: string
}>

/**
 * Re-verifies the current password via a fresh sign-in before applying the new one
 * (matching web's confirm-then-update flow). Neither password is ever logged.
 */
export function useChangePassword() {
  const { changePassword } = useProductRuntime()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ email, currentPassword, newPassword }: ChangePasswordPayload): Promise<ChangePasswordOutcome> => (
      changePassword(email, currentPassword, newPassword)
    ),
  })
}
