import * as Clipboard from 'expo-clipboard'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as WebBrowser from 'expo-web-browser'
import { Platform } from 'react-native'

import { ENABLE_BANKING_CERTIFICATE_FILE_NAME } from './enable-banking-setup-view-model'

/**
 * The native pieces of the Enable Banking setup (clipboard, share sheet, browser sheet), kept in
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

/** A return address Enable Banking never visits: the iOS session stays open until the person closes it. */
const CONTROL_PANEL_SESSION_RETURN_URL = 'wondermoney://more/banking/connect'

/**
 * Opens Enable Banking's Control Panel in the in-app browser sheet, as bank consent does.
 *
 * - iOS: an authentication session, which shares Safari's cookies. Enable Banking signs people in
 *   with an emailed link, and Mail opens that link in Safari; a plain Safari sheet keeps its own
 *   cookies and would stay signed out.
 * - Android: a Custom Tab, which shares Chrome's cookies and, launched through its proxy activity,
 *   survives switching back to the app to copy the next value.
 */
export async function openControlPanel(url: string): Promise<void> {
  try {
    if (Platform.OS === 'ios') {
      await WebBrowser.openAuthSessionAsync(url, CONTROL_PANEL_SESSION_RETURN_URL)
    } else {
      await WebBrowser.openBrowserAsync(url, { showInRecents: true })
    }
  } catch {
    // The sheet didn't open (no browser): nothing to undo, the step stays as it was.
  }
}
