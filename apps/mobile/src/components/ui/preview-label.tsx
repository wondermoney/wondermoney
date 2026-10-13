import { useTranslation } from 'react-i18next'

import { Text } from '@/components/ui/text'
import { usePalette } from '@/theme/use-palette'

/**
 * The marker that labels sample data in an empty-state preview (Accounts,
 * Budgets, Goals, Portfolio detail). Found reimplemented with three
 * different type roles across those screens — this app's own copy of the
 * inconsistency found on web (see ../../../DESIGN_HISTORY.md).
 */
export function PreviewLabel() {
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <Text style={{ color: palette.mutedForeground, fontWeight: '600' }} variant="label">
      {t('common.preview')}
    </Text>
  )
}
