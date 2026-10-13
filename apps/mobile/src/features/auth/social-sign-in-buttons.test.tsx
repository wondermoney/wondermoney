import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { SocialSignInButtons, type SocialSignInButtonsProps } from './social-sign-in-buttons'

jest.mock('expo-apple-authentication', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable } = require('react-native')
  return {
    AppleAuthenticationButtonStyle: { BLACK: 'black', WHITE: 'white' },
    AppleAuthenticationButtonType: { CONTINUE: 'continue' },
    AppleAuthenticationButton: (props: Record<string, unknown>) => React.createElement(Pressable, {
      accessibilityRole: 'button',
      onPress: props.onPress,
      style: props.style,
      testID: props.testID,
    }),
  }
})

async function renderButtons(overrides: Partial<SocialSignInButtonsProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: SocialSignInButtonsProps = {
    providers: ['apple', 'google'],
    pending: null,
    failure: null,
    onPress: jest.fn(),
    palette: themeTokens.colors.light,
    scheme: 'light',
    ...overrides,
  }
  const view = await render(
    <I18nextProvider i18n={i18n}><SocialSignInButtons {...props} /></I18nextProvider>,
  )
  return { view, props }
}

describe('SocialSignInButtons', () => {
  it('renders Apple first and at exactly the same size as Google (App Store 4.8)', async () => {
    const { view } = await renderButtons()

    const rendered = view.getAllByTestId(/^social-sign-in-/).map((node) => node.props.testID)
    expect(rendered).toEqual(['social-sign-in-apple', 'social-sign-in-google'])

    const apple = StyleSheet.flatten(view.getByTestId('social-sign-in-apple').props.style)
    const google = StyleSheet.flatten(view.getByTestId('social-sign-in-google').props.style)
    expect(apple.height).toBe(google.height)
    expect(apple.width).toBe(google.width)
    expect(apple.height).toBeGreaterThanOrEqual(48)
  })

  it('offers Google alone on platforms without Sign in with Apple', async () => {
    const { view } = await renderButtons({ providers: ['google'] })

    expect(view.queryByTestId('social-sign-in-apple')).not.toBeOnTheScreen()
    expect(view.getByText('Continue with Google')).toBeOnTheScreen()
  })

  it('renders nothing when no provider is available', async () => {
    const { view } = await renderButtons({ providers: [] })

    expect(view.queryByTestId('social-sign-in-google')).not.toBeOnTheScreen()
    expect(view.queryByText('or')).not.toBeOnTheScreen()
  })

  it('reports the pressed provider to the caller', async () => {
    const { view, props } = await renderButtons()

    await fireEvent.press(view.getByTestId('social-sign-in-apple'))
    expect(props.onPress).toHaveBeenCalledWith('apple')

    await fireEvent.press(view.getByTestId('social-sign-in-google'))
    expect(props.onPress).toHaveBeenCalledWith('google')
  })

  it('busies both buttons while one sheet is open', async () => {
    const { view, props } = await renderButtons({ pending: 'google' })

    const google = view.getByTestId('social-sign-in-google')
    expect(google.props.accessibilityState).toMatchObject({ disabled: true, busy: true })
    expect(view.getByText('Signing in')).toBeOnTheScreen()
    await fireEvent.press(google)
    expect(props.onPress).not.toHaveBeenCalled()
    expect(StyleSheet.flatten(view.getByTestId('social-sign-in-apple').props.style).opacity).toBeLessThan(1)
  })

  it('shows a safe translated failure that quotes no provider detail', async () => {
    const { view } = await renderButtons({ failure: 'unavailable' })

    expect(view.getByRole('alert', { name: "That sign-in didn't work. Try again" })).toBeOnTheScreen()
  })
})
