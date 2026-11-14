import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { PasskeyAddOutcome, PasskeyDeleteOutcome, PasskeySummary } from '@/lib/auth/app-auth'

import { passkeysKey } from './query-keys'

/** The signed-in user's passkeys (better-auth's `/passkey/list-user-passkeys`), per session epoch. */
export function usePasskeys({ enabled }: { enabled: boolean }) {
  const { runtime, listPasskeys } = useProductRuntime()
  if (!runtime) throw new Error('usePasskeys requires an authenticated runtime')

  return useQuery({
    enabled,
    queryKey: passkeysKey(runtime.epochId),
    queryFn: async (): Promise<PasskeySummary[]> => {
      const result = await listPasskeys()
      if (result.status !== 'available') throw new Error('passkeys-unavailable')
      return result.passkeys
    },
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

function usePasskeyMutation<Input, Outcome extends { status: string }>(
  run: (input: Input) => Promise<Outcome>,
  succeeded: Outcome['status'],
) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('passkey mutations require an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: Input): Promise<Outcome> => {
      const outcome = await run(input)
      if (outcome.status === succeeded) {
        await queryClient.invalidateQueries({ queryKey: passkeysKey(runtime.epochId), exact: true })
      }
      return outcome
    },
  })
}

/** Creates a passkey on this device: the device's prompt, then the server's verification. */
export function useAddPasskey() {
  const { addPasskey } = useProductRuntime()
  return usePasskeyMutation<void, PasskeyAddOutcome>(() => addPasskey(), 'added')
}

/** Removes a passkey from the account; the device or password manager keeps its copy. */
export function useDeletePasskey() {
  const { deletePasskey } = useProductRuntime()
  return usePasskeyMutation<string, PasskeyDeleteOutcome>((id) => deletePasskey(id), 'deleted')
}
