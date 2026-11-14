import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useInsightQuery } from '@/features/account-insights/use-insight-query'

import { createCreditCardStatementsEndpoint } from './accounts-contract'
import { accountCreditCardStatementsKey } from './query-keys'

/**
 * The card's statements for the API's default window (the last three months). Disabled for an
 * account that is not a card, so the screen costs no request it cannot use.
 */
export function useCreditCardStatements(accountId: number | null, enabled: boolean) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Credit card statements require an authenticated runtime')
  const valid = accountId !== null && Number.isSafeInteger(accountId) && accountId > 0
  const query = useInsightQuery(
    createCreditCardStatementsEndpoint(valid ? accountId : 1),
    accountCreditCardStatementsKey(runtime.epochId, valid ? accountId : 0),
    valid && enabled,
  )
  return { ...query, isInvalidId: !valid }
}
