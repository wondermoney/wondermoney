import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  accountCreditCardStatementsKey,
  accountKey,
  accountsKey,
} from './query-keys'
import {
  createUpdateCreditCardEndpoint,
  creditCardWriteSchema,
  type CreditCardWrite,
} from './accounts-contract'

/** `PUT /v1/account/:id/credit-card`: marks the account as a card and stores its cycle. */
export function useCreditCardMutation() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useCreditCardMutation requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ accountId, value }: { accountId: number; value: CreditCardWrite }) => {
      const body = creditCardWriteSchema.parse(value)
      return runtime.apiClient.write(createUpdateCreditCardEndpoint(accountId), {
        body,
        commit: () => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: accountsKey(runtime.epochId), exact: true }),
            queryClient.invalidateQueries({ queryKey: accountKey(runtime.epochId, accountId), exact: true }),
            queryClient.invalidateQueries({ queryKey: accountCreditCardStatementsKey(runtime.epochId, accountId) }),
          ])
        },
      })
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
