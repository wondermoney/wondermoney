import { Image } from 'expo-image'
import { useState } from 'react'
import { StyleSheet, useColorScheme, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { useRemoteImageSource } from '@/lib/api/api-image-source'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { merchantAvatarColorsFor, merchantInitial } from './merchant-avatar-model'

export type MerchantAvatarSource = Readonly<{
  name: string
  /** The API's `resolvedLogoUrl`: the image to draw, or null for the initial. */
  resolvedLogoUrl?: string | null
}>

export type MerchantAvatarProps = MerchantAvatarSource & {
  /** `md` 36pt for list rows (default), `sm` 24pt, the same column as `EntityMark`. */
  size?: 'md' | 'sm'
  testID?: string
}

const isHttpUrl = (value: string | null | undefined): value is string => typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim())

/**
 * A merchant's mark: a circle with its logo, or its first letter on a colour derived from its
 * name, the same colour on every screen and on web (`merchant-avatar-model`). The logo is a
 * third-party image loaded without credentials, or the API's logo proxy loaded with the bearer
 * token (`useRemoteImageSource` decides which, by origin). A logo that fails to load (the proxy
 * answers 404 when it has none) falls back to the initial until the URL changes. Decorative: the
 * row names the merchant, so the mark is hidden from screen readers, and it takes no touches of
 * its own.
 */
export function MerchantAvatar({ name, resolvedLogoUrl, size = 'md', testID }: MerchantAvatarProps) {
  const palette = usePalette()
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const uri = isHttpUrl(resolvedLogoUrl) ? resolvedLogoUrl.trim() : null
  const source = useRemoteImageSource(uri)
  const [failedUri, setFailedUri] = useState<string | null>(null)
  const box = themeTokens.mark[size]
  const frame = { width: box, height: box, borderRadius: box / 2 }

  if (source && failedUri !== source.uri) {
    const loading = source.uri
    return (
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.circle, frame, { backgroundColor: themeTokens.mark.logoBacking, borderColor: palette.border, padding: size === 'md' ? 4 : 2 }]}
        testID={testID}
      >
        <Image
          accessible={false}
          contentFit="contain"
          onError={() => setFailedUri(loading)}
          recyclingKey={loading}
          source={source}
          style={styles.image}
          testID={testID ? `${testID}-image` : undefined}
        />
      </View>
    )
  }

  const colors = merchantAvatarColorsFor(name, scheme)
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.circle, styles.borderless, frame, { backgroundColor: colors.background }]}
      testID={testID}
    >
      <Text maxFontSizeMultiplier={1} numberOfLines={1} style={{ color: colors.foreground }} variant={size === 'md' ? 'metaStrong' : 'label'}>
        {merchantInitial(name)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  borderless: { borderWidth: 0 },
  image: { width: '100%', height: '100%' },
})
