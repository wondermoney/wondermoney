import * as Clipboard from 'expo-clipboard'
import { File, Paths } from 'expo-file-system'
import * as Linking from 'expo-linking'
import * as Sharing from 'expo-sharing'
import * as WebBrowser from 'expo-web-browser'
import { Platform } from 'react-native'

import { ENABLE_BANKING_CERTIFICATE_FILE_NAME } from './enable-banking-setup-view-model'

/**
 * The native pieces of the Enable Banking setup (clipboard, share sheet, browser), kept in
 * one module so the screen's tests mock them without touching the device.
 */

export async function copyText(value: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(value)
    return true
  } catch {
    return false
  }
}

/** The clipboard's text, or null when it holds none or can't be read. */
export async function readClipboardText(): Promise<string | null> {
  try {
    const text = await Clipboard.getStringAsync()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

/**
 * Writes the certificate (public, PEM) to a cache file and hands it to the share sheet, to save
 * it in Files or send it to a computer. False when the device can't share.
 */
export async function shareCertificate(certificatePem: string, dialogTitle: string): Promise<boolean> {
  try {
    if (!(await Sharing.isAvailableAsync())) return false
    const file = new File(Paths.cache, ENABLE_BANKING_CERTIFICATE_FILE_NAME)
    if (file.exists) file.delete()
    file.create()
    file.write(certificatePem)
    await Sharing.shareAsync(file.uri, { dialogTitle, mimeType: 'application/x-x509-ca-cert', UTI: 'public.x509-certificate' })
    return true
  } catch {
    return false
  }
}

/**
 * Opens Enable Banking's Control Panel beside the app. True once it opened; false when no
 * browser would take it, so the step can say so.
 *
 * - iOS: Safari itself. Enable Banking signs people in with an emailed link that Mail opens in
 *   Safari, so the session is there; and Safari keeps the half-filled form while the person
 *   switches back to WonderMoney to copy the next value. A sheet over the app would lose the form
 *   each time it closed.
 * - Android: a Custom Tab, which shares Chrome's cookies and, launched through its proxy
 *   activity, stays in recents with the form while the person copies the next value here.
 */
export async function openControlPanel(url: string): Promise<boolean> {
  try {
    if (Platform.OS === 'ios') {
      await Linking.openURL(url)
    } else {
      await WebBrowser.openBrowserAsync(url, { showInRecents: true })
    }
    return true
  } catch {
    return false
  }
}
