import { type Href, useRouter } from 'expo-router'
import { useState } from 'react'

import { LoanCreateScreen } from './loan-create-screen'
import type { LoanCreateWrite } from './loans-contract'
import { useLoanCurrencies } from './use-loan-currencies'
import { classifyLoanCreateFailure, useCreateLoan, type LoanCreateFailure } from './use-create-loan'

export function LoanCreateRoute() {
  const router = useRouter()
  const currencies = useLoanCurrencies()
  const mutation = useCreateLoan()
  const [outcome, setOutcome] = useState<LoanCreateFailure | null>(null)

  const back = () => router.replace('/loans' as Href)

  return <LoanCreateScreen
    currencies={currencies.data?.currencies ?? []}
    loading={currencies.isLoading}
    metadataError={!currencies.isLoading && !currencies.data}
    pending={mutation.isPending}
    outcome={outcome}
    onBack={back}
    onCreate={async (value: LoanCreateWrite) => {
      setOutcome(null)
      try {
        await mutation.mutateAsync(value)
        back()
      } catch (error) {
        setOutcome(classifyLoanCreateFailure(error))
      }
    }}
  />
}
