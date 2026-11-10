import { I18nextProvider } from 'react-i18next'
import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { BackControl } from './back-control'
import { touchHeight } from '@/test/touch-target'

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

    expect(touchHeight(control)).toBeGreaterThanOrEqual(44)
    await fireEvent(control, 'focus')

    expect(StyleSheet.flatten(control.props.style).borderWidth).toBe(2)
  })

  it('shows web\'s muted "← Parent" link and announces the named destination', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><BackControl color="#ff0000" fallback="/more" label="Back to More" /></I18nextProvider>)

    expect(view.getByRole('button', { name: 'Back to More' })).toBeTruthy()
    const visible = view.getByText('More')
    // The deprecated `color` prop is ignored: one look on every screen.
    expect(StyleSheet.flatten(visible.props.style).color).toBe(themeTokens.colors.light.mutedForeground)
  })

  it('names the page a fallback returns to, and falls back to "Back"', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(
      <I18nextProvider i18n={i18n}>
        <BackControl fallback="/accounts/transactions" />
        <BackControl fallback="/accounts/42" />
        <BackControl fallback="/somewhere-else" />
        <BackControl destination="Household budget" fallback="/budgets" />
      </I18nextProvider>,
    )
    expect(view.getByText('Transactions')).toBeTruthy()
    expect(view.getByText('Accounts')).toBeTruthy()
    expect(view.getByText('Back')).toBeTruthy()
    expect(view.getByText('Household budget')).toBeTruthy()
  })
})
