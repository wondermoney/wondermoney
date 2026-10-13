import { useRouter } from 'expo-router'
import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useAccounts } from '@/features/accounts/use-accounts'
import { useCategories } from '@/features/categories/use-categories'
import { ApiError } from '@/lib/api/errors'

import { RecurringScreen, type RecurringActionResult, type RecurringScanResult, type RecurringViewState } from './recurring-screen'
import type { RecurringDetectionResult } from './recurring-contract'
import { mapRecurringItems, mapRecurringSummary } from './recurring-view-model'
import { useRecurringItems } from './use-recurring-items'
import { useRecurringMutations, type RecurringMutation } from './use-recurring-mutations'
import { useRecurringSummary } from './use-recurring-summary'

export function RecurringRoute() {
  const accounts = useAccounts()
  const items = useRecurringItems()
  const summary = useRecurringSummary()
  const categories = useCategories()
  const mutation = useRecurringMutations()
  const { blockAccess } = useProductRuntime()
  const [demoReadOnly, setDemoReadOnly] = useState(false)
  const [scanNeedsRefresh, setScanNeedsRefresh] = useState(false)
  const router = useRouter()
  let state: RecurringViewState
  const invalid = [accounts.error, items.error, summary.error].some((error) => error instanceof ApiError && error.code === 'invalid-response')

  if (accounts.isAccessTransition || items.isAccessTransition || summary.isAccessTransition || categories.isAccessTransition) state = { status: 'access-transition' }
  else if (accounts.isLoading || items.isLoading || summary.isLoading) state = { status: 'loading' }
  else if (invalid) state = { status: 'invalid-response' }
  else if (accounts.data && accounts.data.accounts.length === 0) state = { status: 'no-account' }
  else if (items.data || summary.data) {
     const accountNames = new Map((accounts.data?.accounts ?? []).map((account) => [account.accountKey, account.accountName] as const))
    state = {
      status: accounts.isRefreshFailure || items.isRefreshFailure || summary.isRefreshFailure ? 'refresh-error' : 'loaded',
       rows: items.data ? mapRecurringItems(items.data, accountNames) : [],
       summary: summary.data ? mapRecurringSummary(summary.data) : null,
       refreshing: accounts.isRefreshing || items.isRefreshing || summary.isRefreshing,
       itemsUnavailable: !items.data,
       summaryUnavailable: !summary.data,
    }
  } else state = { status: 'error' }

  const classify = (error: unknown, input: RecurringMutation): RecurringActionResult => {
    if (!(error instanceof ApiError)) return 'error'
    if (error.code === 'demo-forbidden') { setDemoReadOnly(true); return 'demo' }
    if (error.code === 'cancelled') return 'cancelled'
    if (error.code === 'network') return 'network'
    if (error.code === 'invalid-response') return 'invalid'
    if (error.code === 'mfa-required') { blockAccess('mfa-required'); return 'mfa' }
    if (error.code === 'http' && error.status === 403) return 'access'
    if (input.kind === 'update' && error.code === 'http' && error.status === 404) return 'category'
    return 'error'
  }
  const mutate = async (input: Exclude<RecurringMutation, { kind: 'detect' }>): Promise<RecurringActionResult> => {
    if (demoReadOnly) return 'demo'
    if (scanNeedsRefresh) return 'unknown'
    try {
      await mutation.mutateAsync(input)
      return 'success'
    } catch (error) {
      return classify(error, input)
    }
  }
  const scan = async (): Promise<RecurringScanResult> => {
    if (demoReadOnly) return 'demo'
    if (scanNeedsRefresh) return 'unknown'
    try {
      const counts = await mutation.mutateAsync({ kind: 'detect' }) as RecurringDetectionResult
      return { status: 'success', counts }
    } catch (error) {
      const outcome = classify(error, { kind: 'detect' })
      if (outcome === 'network' || outcome === 'invalid') { setScanNeedsRefresh(true); return 'unknown' }
      return outcome
    }
  }

  const categoryOptions = (categories.data?.categories ?? [])
    .flatMap((parent) => [parent, ...parent.childCategory])
    .map((category) => ({ id: category.categoryKey, name: category.name }))

  return <RecurringScreen
    state={state}
    onBack={() => router.replace('/accounts')}
    onRefresh={async () => {
      const [, itemResult, summaryResult] = await Promise.all([accounts.refetch(), items.refetch(), summary.refetch()])
      if (!itemResult.isError && !summaryResult.isError) setScanNeedsRefresh(false)
    }}
    categories={categoryOptions}
    categoriesUnavailable={categories.isError && !categories.data}
    demoReadOnly={demoReadOnly}
    pending={mutation.isPending ? mutation.variables ?? null : null}
    scanNeedsRefresh={scanNeedsRefresh}
    onScan={scan}
    onConfirm={(id) => mutate({ kind: 'confirm', id })}
    onDismiss={(id) => mutate({ kind: 'dismiss', id })}
    onRestore={(id) => mutate({ kind: 'restore', id })}
    onUpdate={(id, metadata) => mutate({ kind: 'update', id, metadata })}
  />
}
