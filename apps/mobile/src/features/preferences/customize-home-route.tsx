import { type Href, useRouter } from 'expo-router'
import { useState } from 'react'

import {
  mergeDashboardLayout,
  moveDashboardSection,
  setDashboardSectionHidden,
  type DashboardLayoutEntry,
  type DashboardSectionMove,
} from '@wondermoney/shared/dashboard-layout'

import { CustomizeHomeScreen } from './customize-home-screen'
import { useDashboardLayout } from './use-dashboard-layout'

/**
 * The editor's draft is local so two quick presses compose; each change is
 * still saved as the whole layout, and the response replaces the shared
 * preferences cache that the home reads.
 */
export function CustomizeHomeRoute() {
  const router = useRouter()
  const { storedLayout, isLoading, isLoadError, isSaving, saveError, retryLoad, save } = useDashboardLayout()
  const [draft, setDraft] = useState<DashboardLayoutEntry[] | null>(null)
  const layout = mergeDashboardLayout(draft ?? storedLayout)

  const commit = (next: DashboardLayoutEntry[]) => {
    setDraft(next)
    save(next)
  }

  const onMove = (id: string, direction: DashboardSectionMove) => {
    commit(moveDashboardSection(layout, id, direction))
  }

  const onToggle = (id: string, visible: boolean) => {
    commit(setDashboardSectionHidden(layout, id, !visible))
  }

  return (
    <CustomizeHomeScreen
      isLoadError={isLoadError}
      isLoading={isLoading}
      isSaving={isSaving}
      layout={layout}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/' as Href))}
      onMove={onMove}
      onReset={() => commit([])}
      onRetryLoad={retryLoad}
      onRetrySave={() => save(layout)}
      onToggle={onToggle}
      saveError={saveError}
    />
  )
}
