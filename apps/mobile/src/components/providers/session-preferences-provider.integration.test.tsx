import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { useSyncExternalStore } from 'react'
import { I18nextProvider } from 'react-i18next'
import { Pressable, Text } from 'react-native'

import { PreferencesScreen } from '@/features/preferences/preferences-screen'
import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import {
  SessionPreferencesProvider,
  SYSTEM_COLOR_SCHEME,
  type ThemePreference,
  useSessionPreferences,
} from './session-preferences-provider'

type NativeScheme = 'light' | 'dark' | 'unspecified'
let deviceScheme: 'light' | 'dark' = 'light'
let override: NativeScheme = 'unspecified'
const listeners = new Set<() => void>()
const setColorScheme = jest.fn((scheme: NativeScheme) => {
  override = scheme
  listeners.forEach((listener) => listener())
})
const appearance = { setColorScheme }
const mockBack = jest.fn()

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }))

function useTestColorScheme() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => override === 'unspecified' ? deviceScheme : override,
  )
}

const snapshots: { preference: ThemePreference; router: string; token: string; native: string; setterCalls: number }[] = []

function ThemeProbe() {
  const preferences = useSessionPreferences()
  const nativeTheme = useTestColorScheme() === 'dark' ? 'dark' : 'light'
  const tokenTheme = themeTokens.colors[nativeTheme].background
  snapshots.push({ preference: preferences.themePreference, router: preferences.resolvedTheme, token: tokenTheme, native: nativeTheme, setterCalls: setColorScheme.mock.calls.length })
  return <>
    <Text>{`${preferences.themePreference}|${preferences.resolvedTheme}|${nativeTheme}|${tokenTheme}`}</Text>
    {(['light', 'dark', 'system'] as const).map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`set-${value}`} onPress={() => preferences.setThemePreference(value)}><Text>{value}</Text></Pressable>)}
  </>
}

function TestSessionPreferencesProvider({ children }: { children: React.ReactNode }) {
  const deviceTheme = useTestColorScheme()
  return <SessionPreferencesProvider deviceLocale="en" appearance={appearance} deviceTheme={deviceTheme}>{children}</SessionPreferencesProvider>
}

const provider = (children: React.ReactNode) => <TestSessionPreferencesProvider>{children}</TestSessionPreferencesProvider>

const emitDeviceTheme = (scheme: 'light' | 'dark') => {
  deviceScheme = scheme
  listeners.forEach((listener) => listener())
}

describe('SessionPreferencesProvider theme atomicity', () => {
  beforeEach(() => {
    deviceScheme = 'light'
    override = 'unspecified'
    setColorScheme.mockClear()
    mockBack.mockClear()
    snapshots.length = 0
  })

  it('sets the RN 0.86 native value before publishing Light, Dark, and System state', async () => {
    const view = await render(provider(<ThemeProbe />))
    expect(view.getByText(`system|light|light|${themeTokens.colors.light.background}`)).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'set-dark' }))
    expect(setColorScheme).toHaveBeenLastCalledWith('dark')
    expect(view.getByText(`dark|dark|dark|${themeTokens.colors.dark.background}`)).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'set-light' }))
    expect(setColorScheme).toHaveBeenLastCalledWith('light')
    expect(view.getByText(`light|light|light|${themeTokens.colors.light.background}`)).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'set-system' }))
    expect(SYSTEM_COLOR_SCHEME).toBe('unspecified')
    expect(setColorScheme).toHaveBeenLastCalledWith(SYSTEM_COLOR_SCHEME)
    expect(view.getByText(`system|light|light|${themeTokens.colors.light.background}`)).toBeOnTheScreen()

    expect(snapshots.filter(({ preference }) => preference !== 'system').every(({ preference, native, router, setterCalls }) => setterCalls > 0 && preference === native && router === native)).toBe(true)
    expect(snapshots.some(({ preference, native, router, setterCalls }) => preference === 'system' && setterCalls === 3 && native === 'light' && router === 'light')).toBe(true)
  })

  it('keeps Router and token themes aligned and resumes device changes in System mode', async () => {
    const view = await render(provider(<ThemeProbe />))
    await fireEvent.press(view.getByRole('button', { name: 'set-dark' }))
    await fireEvent.press(view.getByRole('button', { name: 'set-system' }))

    await act(async () => emitDeviceTheme('dark'))
    await waitFor(() => expect(view.getByText(`system|dark|dark|${themeTokens.colors.dark.background}`)).toBeOnTheScreen())
    expect(snapshots.filter(({ preference }) => preference === 'system').every(({ native, router, token }) => native === router && token === themeTokens.colors[router as 'light' | 'dark'].background)).toBe(true)
  })

  it('wires the Appearance screen radios through the atomic provider setter', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}>{provider(<PreferencesScreen />)}</I18nextProvider>)
    await fireEvent.press(view.getByRole('radio', { name: 'Dark' }))
    expect(setColorScheme).toHaveBeenLastCalledWith('dark')
    expect(view.getByRole('radio', { name: 'Dark' }).props.accessibilityState).toEqual({ checked: true })
    await fireEvent.press(view.getByRole('radio', { name: 'System' }))
    expect(setColorScheme).toHaveBeenLastCalledWith('unspecified')
    expect(view.getByRole('radio', { name: 'System' }).props.accessibilityState).toEqual({ checked: true })
  })
})
