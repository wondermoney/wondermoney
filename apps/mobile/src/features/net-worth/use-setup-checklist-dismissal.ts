import { useTimedDismissal } from './use-timed-dismissal'

/** "Hide for now" on the setup checklist, for 14 days as on web (`useDismissibleActivation`). */
const KEY = 'wondermoney.setup-checklist.dismissed-until'
const DURATION_MS = 14 * 24 * 60 * 60 * 1000

export function useSetupChecklistDismissal() {
  const { dismissed, dismiss } = useTimedDismissal(KEY, DURATION_MS)
  return { dismissed, dismiss }
}
