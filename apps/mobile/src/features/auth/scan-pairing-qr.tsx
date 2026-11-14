import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { parsePairingUrl, type PairingPayload } from '@/lib/auth/pairing'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

type Props = Readonly<{
  visible: boolean
  onClose: () => void
  onScanned: (payload: PairingPayload) => void
}>

/**
 * The camera sheet behind "Scan QR code".
 *
 * Only a `wondermoney://pair` code is accepted; anything else keeps the sheet open and says
 * so, because a phone pointed at the wrong code is a normal mistake, not a failure. The first
 * accepted code wins — the scanner reports the same code many times per second.
 */
export function ScanPairingQr({ visible, onClose, onScanned }: Props) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [permission, requestPermission] = useCameraPermissions()
  const [invalid, setInvalid] = useState(false)
  const accepted = useRef(false)

  const close = () => {
    accepted.current = false
    setInvalid(false)
    onClose()
  }

  return (
    <Modal animationType="slide" onRequestClose={close} visible={visible}>
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <Text variant="section">{t('auth.pairing.scanTitle')}</Text>
        <Text tone="muted" variant="meta">{t('auth.pairing.scanHint')}</Text>

        <View style={[styles.camera, { borderColor: palette.border }]}>
          {permission?.granted ? (
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                if (accepted.current) return
                const payload = parsePairingUrl(data)
                if (!payload) {
                  setInvalid(true)
                  return
                }
                accepted.current = true
                onScanned(payload)
              }}
              style={styles.camera}
            />
          ) : (
            <View style={styles.permission}>
              <Text tone="muted" variant="meta">{t('auth.pairing.cameraPermission')}</Text>
              <Button
                label={t('auth.pairing.grantCamera')}
                onPress={() => { void requestPermission() }}
                variant="outline"
              />
            </View>
          )}
        </View>

        {invalid ? (
          <Text accessibilityRole="alert" tone="destructive" variant="meta">
            {t('auth.pairing.invalidCode')}
          </Text>
        ) : null}

        <Button label={t('auth.pairing.cancel')} onPress={close} variant="ghost" />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  camera: { flex: 1, borderRadius: themeTokens.radius.lg, borderWidth: 1, overflow: 'hidden' },
  container: { flex: 1, gap: themeTokens.spacing[4], padding: themeTokens.spacing[5] },
  permission: { alignItems: 'center', flex: 1, gap: themeTokens.spacing[4], justifyContent: 'center', padding: themeTokens.spacing[5] },
})
