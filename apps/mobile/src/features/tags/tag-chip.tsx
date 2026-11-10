import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { TagDto } from './tags-contract'

/** The colour dot alone, for pickers and filter rows. */
export function TagDot({ color }: { color: string }) {
  const palette = usePalette()
  return <View style={[styles.dot, { backgroundColor: color, borderColor: palette.border }]} />
}

/**
 * Web's `TagChip`: the name in foreground ink on the neutral `muted` surface,
 * the tag's own colour only as a dot. A tag colour is any hex someone picked,
 * so as a fill it would fail contrast in one theme or the other.
 */
export function TagChip({ tag }: { tag: Pick<TagDto, 'name' | 'color'> }) {
  const palette = usePalette()
  return (
    <View style={[styles.chip, { backgroundColor: palette.muted, borderColor: palette.border }]}>
      <TagDot color={tag.color} />
      <Text numberOfLines={1} style={styles.name} variant="label">{tag.name}</Text>
    </View>
  )
}

/** A wrapping row of chips; past `max` the rest read as "+N". One accessible element. */
export function TagChips({ tags, max = 3 }: { tags: readonly TagDto[]; max?: number }) {
  const { t } = useTranslation()
  if (tags.length === 0) return null
  const shown = tags.slice(0, max)
  const hidden = tags.length - shown.length
  return (
    <View
      accessible
      accessibilityLabel={t('tags.listLabel', { names: tags.map((tag) => tag.name).join(', ') })}
      style={styles.row}
      testID="tag-chips"
    >
      {shown.map((tag) => <TagChip key={tag.tagKey} tag={tag} />)}
      {hidden > 0 ? <Text tone="muted" variant="label">{t('tags.more', { count: hidden })}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[1], paddingTop: themeTokens.spacing[1] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[1], borderWidth: 1, borderRadius: themeTokens.radius.pill, paddingHorizontal: themeTokens.spacing[2], paddingVertical: 1, maxWidth: 160 },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  name: { flexShrink: 1 },
})
