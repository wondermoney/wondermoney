import type { TFunction } from 'i18next'
import { Alert } from 'react-native'

/** A native confirmation: resolves true only when the reader presses `proceed`. */
export const confirmAction = (title: string, message: string, cancel: string, proceed: string, destructive: boolean) => new Promise<boolean>((resolve) => {
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel', onPress: () => resolve(false) },
    { text: proceed, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) })
})

/**
 * Web's Archive / Bring back, for a hand-valued asset and a crypto wallet alike. Archiving asks
 * first, with web's text (it stops counting in net worth from today; the history stays); bringing
 * it back does not. `write` runs only once there is nothing left to confirm.
 */
export async function archiveOrBringBack(archived: boolean, t: TFunction, write: (archived: boolean) => Promise<void>): Promise<void> {
  if (archived) return write(false)
  const confirmed = await confirmAction(t('manualAssetDetail.manage.archiveTitle'), t('manualAssetDetail.manage.archiveMessage'), t('common.cancel'), t('manualAssetDetail.manage.archive'), false)
  if (confirmed) await write(true)
}
