import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { Platform } from 'react-native'

import { openControlPanel } from '../enable-banking-setup-device'

jest.mock('expo-linking', () => ({ openURL: jest.fn() }))
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(), setStringAsync: jest.fn() }))
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }))
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: 'cache' } }))

const openURL = jest.mocked(Linking.openURL)
const openBrowserAsync = jest.mocked(WebBrowser.openBrowserAsync)
const URL = 'https://enablebanking.com/cp/applications'

describe('openControlPanel', () => {
  const originalOS = Platform.OS
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS })
    openURL.mockReset(); openBrowserAsync.mockReset()
  })

  it('opens Safari on iOS, so the form survives switching back to the app', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' })
    openURL.mockResolvedValue(true)
    await expect(openControlPanel(URL)).resolves.toBe(true)
    expect(openURL).toHaveBeenCalledWith(URL)
    expect(openBrowserAsync).not.toHaveBeenCalled()
  })

  it('opens a Custom Tab kept in recents on Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' })
    openBrowserAsync.mockResolvedValue({ type: 'opened' } as never)
    await expect(openControlPanel(URL)).resolves.toBe(true)
    expect(openBrowserAsync).toHaveBeenCalledWith(URL, { showInRecents: true })
    expect(openURL).not.toHaveBeenCalled()
  })

  it('says when no browser would open it', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' })
    openURL.mockRejectedValue(new Error('no browser'))
    await expect(openControlPanel(URL)).resolves.toBe(false)
  })
})
