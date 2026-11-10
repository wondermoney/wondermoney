import {
  mergeDashboardLayout,
  type DashboardLayoutEntry,
} from '@wondermoney/shared/dashboard-layout'

import { useUpdateUserPreferences, useUserPreferences } from './use-user-preferences'

/**
 * The home's section order and visibility, from the per-user preferences
 * document. `layout` is what a screen renders; `storedLayout` is the raw list
 * (empty when nothing is arranged) so an editor can save its own draft.
 *
 * A failed read falls back to the default order: the home still renders, and
 * the editor says it could not load the saved arrangement.
 */
export function useDashboardLayout() {
  const query = useUserPreferences()
  const update = useUpdateUserPreferences()

  return {
    layout: mergeDashboardLayout(query.data?.dashboardLayout),
    storedLayout: query.data?.dashboardLayout,
    isLoading: query.isLoading,
    isLoadError: query.isError,
    isSaving: update.isPending,
    saveError: update.isError,
    retryLoad: () => void query.refetch(),
    save: (layout: readonly DashboardLayoutEntry[]) => update.mutate({ dashboardLayout: layout }),
  }
}
