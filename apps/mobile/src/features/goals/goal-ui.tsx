import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'

/** A label over a value — web's `<p text-xs muted>` + `<p font-mono text-lg font-semibold>`. */
export function FigureStat({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.figureStat}>
      <Text tone="muted" variant="label">{label}</Text>
      <Text style={mono ? styles.figureValue : undefined} variant="section">{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  figureStat: { gap: 2 },
  // Web `font-mono text-lg font-semibold`: the 18/28 600 section size, in the figure face.
  figureValue: { fontFamily: themeTokens.typography.scale.amount.fontFamily },
})
