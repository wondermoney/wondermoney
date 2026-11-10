import { useQuery } from '@tanstack/react-query'
import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { bankAlertsEndpoint, type BankAlertDto } from './bank-alerts-contract'
import {
  nextDismissedIds,
  parseDismissedIds,
  selectBankAlertBanner,
  type BankAlertBannerModel,
} from './bank-alerts-view-model'
import { bankAlertsKey } from './query-keys'

const NO_ALERTS: readonly BankAlertDto[] = []

/**
 * The viewer's bank alerts. Every failure, including an older server's 404
 * for this route, a payload that doesn't verify, or an MFA gate the other Home
 * queries already hand to the runtime, reads as "no alerts": the banner is a
 * nudge, never a reason to show an error on Home.
 */
export function useBankAlerts() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBankAlerts requires an authenticated runtime')
  const query = useQuery({
    queryKey: bankAlertsKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(bankAlertsEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  return {
    alerts: query.isError ? NO_ALERTS : (query.data?.alerts ?? NO_ALERTS),
    refetch: query.refetch,
  }
}

/**
 * Dismissed alert ids, kept in SecureStore because it's the one storage this
 * app wires up (as in `use-setup-checklist-dismissal.ts`). A storage failure
 * only loses the memory: the dismissal still holds for the session.
 */
const DISMISSED_KEY = 'wondermoney.bank-alerts.dismissed'

export function useBankAlertDismissals() {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    Promise.resolve()
      .then(() => SecureStore.getItemAsync(DISMISSED_KEY))
      .then((raw) => {
        const stored = parseDismissedIds(raw)
        if (active && stored.length > 0) setDismissed((current) => new Set([...current, ...stored]))
      })
      .catch(() => undefined)
      .finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [])

  const dismiss = useCallback((ids: readonly string[], currentIds: readonly string[]) => {
    const remembered = nextDismissedIds(dismissed, ids, currentIds)
    setDismissed((current) => new Set([...current, ...ids]))
    Promise.resolve()
      .then(() => SecureStore.setItemAsync(DISMISSED_KEY, JSON.stringify(remembered)))
      .catch(() => undefined)
  }, [dismissed])

  return { dismissed, ready, dismiss }
}

/**
 * The Home banner: null until the remembered dismissals are read (so a
 * dismissed alert doesn't flash in), and whenever nothing is left to show.
 * Dismissing hides every alert the banner stands for.
 */
export function useBankAlertBanner(): Readonly<{
  banner: BankAlertBannerModel | null
  dismiss: () => void
  refetch: () => Promise<unknown>
}> {
  const { alerts, refetch } = useBankAlerts()
  const { dismiss: dismissIds, dismissed, ready } = useBankAlertDismissals()
  const banner = useMemo(
    () => (ready ? selectBankAlertBanner(alerts, dismissed) : null),
    [alerts, dismissed, ready],
  )
  const dismiss = useCallback(() => {
    if (!banner) return
    dismissIds(banner.ids, alerts.map((alert) => alert.id))
  }, [alerts, banner, dismissIds])
  return { banner, dismiss, refetch }
}
