import { I18nextProvider } from 'react-i18next'
import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { BackControl } from './back-control'

const mockBack = jest.fn()
const mockReplace = jest.fn()
const mockCanGoBack = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: mockCanGoBack }),
}))

describe('BackControl', () => {
  beforeEach(() => {
    mockBack.mockReset()
    mockReplace.mockReset()
    mockCanGoBack.mockReset()
  })

  it('backs when history exists and replaces with the fallback otherwise', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><BackControl fallback="/accounts" /></I18nextProvider>)
    mockCanGoBack.mockReturnValue(true)
    const control = view.getByRole('button', { name: 'Back' })
    await fireEvent.press(control)
    expect(mockBack).toHaveBeenCalledTimes(1)

    mockCanGoBack.mockReturnValue(false)
    await fireEvent.press(control)
    expect(mockReplace).toHaveBeenCalledWith('/accounts')
  })

  it('shows a 2px focus border while keeping its compact touch target', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><BackControl fallback="/accounts" /></I18nextProvider>)
    const control = view.getByRole('button', { name: 'Back' })

    expect(StyleSheet.flatten(control.props.style).minHeight).toBeGreaterThanOrEqual(44)
    await fireEvent(control, 'focus')

    expect(StyleSheet.flatten(control.props.style).borderWidth).toBe(2)
  })
})
