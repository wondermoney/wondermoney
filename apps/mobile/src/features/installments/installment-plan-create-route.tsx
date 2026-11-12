import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { parseAccountId } from '@/features/accounts/accounts-contract'
import { LoadingState } from '@/features/accounts/screen-states'
import { useAccount } from '@/features/accounts/use-account'

import { InstallmentPlanCreateScreen, type InstallmentPlanDraft } from './installment-plan-create-screen'
import { suggestionLinks, type InstallmentPlanCreate } from './installments-contract'
import { classifyInstallmentWriteFailure, useCreateInstallmentPlan, type InstallmentWriteFailure } from './use-installment-plan-mutations'
import { useInstallmentSuggestions } from './use-installment-plans'

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/**
 * Create an installment plan on a card. With `?suggestion=<key>` the form opens filled from that
 * detected suggestion and the plan is sent with its links; it is never created without ✓.
 */
export function InstallmentPlanCreateRoute() {
  const params = useLocalSearchParams<{ accountId?: string | string[]; suggestion?: string | string[] }>()
  const accountId = parseAccountId(params.accountId)
  const suggestionKey = firstParam(params.suggestion) ?? null
  const account = useAccount(accountId)
  const suggestions = useInstallmentSuggestions(accountId, suggestionKey !== null)
  const mutation = useCreateInstallmentPlan()
  const router = useRouter()
  const { t } = useTranslation()
  const submitting = useRef(false)
  const [failure, setFailure] = useState<InstallmentWriteFailure | null>(null)
  const [done, setDone] = useState(false)
  const disablePrevention = usePreventRemove(mutation.isPending && !done)

  const suggestion = suggestionKey === null
    ? null
    : suggestions.data?.suggestions.find((item) => item.key === suggestionKey) ?? null
  const draft: InstallmentPlanDraft | null = suggestion
    ? {
        description: suggestion.description,
        purchaseDate: suggestion.purchaseDate,
        totalAmount: suggestion.totalAmount,
        installmentCount: suggestion.installmentCount,
        links: suggestionLinks(suggestion),
      }
    : null
  const currency = suggestion?.currency ?? account.data?.account.currencyKey.code ?? null

  const close = () => {
    if (router.canGoBack()) router.back()
    else router.replace(accountId === null ? '/accounts' : `/accounts/${accountId}`)
  }

  // The form keeps what it was first filled with, so wait for the suggestion before mounting it.
  if (accountId !== null && ((suggestionKey !== null && suggestions.isLoading) || (account.isLoading && !suggestion))) {
    return <LoadingState label={t('installments.create.loading')} />
  }

  const submit = async (payload: InstallmentPlanCreate) => {
    if (submitting.current) return
    submitting.current = true
    setFailure(null)
    try {
      const created = await mutation.mutateAsync(payload)
      setDone(true)
      disablePrevention()
      router.replace({
        pathname: '/accounts/[accountId]/installments/[planId]',
        params: { accountId: String(created.installmentPlan.accountKey), planId: String(created.installmentPlan.installmentPlanKey) },
      })
    } catch (error) {
      setFailure(classifyInstallmentWriteFailure(error))
    } finally {
      submitting.current = false
    }
  }

  return (
    <InstallmentPlanCreateScreen
      accountId={accountId ?? 0}
      currency={currency}
      draft={draft}
      suggestionUnavailable={suggestionKey !== null && !suggestion}
      failure={accountId === null ? 'not-found' : failure}
      key={draft ? `suggestion-${suggestion?.key}` : 'manual'}
      onClose={close}
      onSubmit={submit}
      pending={mutation.isPending}
    />
  )
}
