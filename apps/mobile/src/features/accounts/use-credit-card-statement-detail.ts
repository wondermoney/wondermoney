import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useInsightQuery } from '@/features/account-insights/use-insight-query'

import { createCreditCardStatementDetailEndpoint } from './accounts-contract'
import { accountCreditCardStatementDetailKey } from './query-keys'

/** Fetches only the selected statement; account ids and dates are validated by the contract builder. */
export function useCreditCardStatementDetail(accountId: number, statementDate: string | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Credit card statement detail requires an authenticated runtime')
  const validAccount = Number.isSafeInteger(accountId) && accountId > 0
  const validDate = statementDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(statementDate)
  const date = validDate ? statementDate : '2000-01-01'
  const query = useInsightQuery(
    createCreditCardStatementDetailEndpoint(validAccount ? accountId : 1, date),
    accountCreditCardStatementDetailKey(runtime.epochId, validAccount ? accountId : 0, date),
    validAccount && validDate,
  )
  return { ...query, isInvalidId: !validAccount }
}
