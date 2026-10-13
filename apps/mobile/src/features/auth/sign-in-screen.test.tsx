import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet, Text } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { SignInScreen, SignInScreenProps } from './sign-in-screen'

async function renderScreen(onSubmit = jest.fn(), extraProps: Partial<SignInScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <SignInScreen onSubmit={onSubmit} {...extraProps} />
    </I18nextProvider>,
  )
  return { view, onSubmit }
}

describe('SignInScreen', () => {
  it('validates required fields and email locally', async () => {
    const { view, onSubmit } = await renderScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(view.getByText('Enter your email address')).toBeOnTheScreen())
    expect(view.getByText('Enter your password')).toBeOnTheScreen()
    expect(onSubmit).not.toHaveBeenCalled()

    await fireEvent.changeText(view.getByLabelText('Email'), 'not-an-email')
    await fireEvent.changeText(view.getByLabelText('Password'), 'secret')
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(view.getByText('Enter a valid email address')).toBeOnTheScreen())
  })

  it.each([
    ['invalid-credentials', 'Email or password is incorrect'],
    ['unavailable', 'Sign in is unavailable. Try again'],
  ] as const)('shows a safe translated %s outcome', async (outcome, message) => {
    const onSubmit = jest.fn().mockResolvedValue(outcome)
    const { view } = await renderScreen(onSubmit)
    await fireEvent.changeText(view.getByLabelText('Email'), 'person@example.com')
    await fireEvent.changeText(view.getByLabelText('Password'), 'secret')
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(view.getByRole('alert', { name: message })).toBeOnTheScreen())
  })

  it('uses secure, scalable 48dp controls and exposes no forbidden auth paths', async () => {
    const { view } = await renderScreen()
    const password = view.getByLabelText('Password')
    expect(password.props.secureTextEntry).toBe(true)
    expect(view.getByLabelText('Email').props.autoCapitalize).toBe('none')
    const button = view.getByRole('button', { name: 'Sign in' })
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(48)
    await fireEvent(button, 'focus')
    expect(StyleSheet.flatten(view.getByRole('button', { name: 'Sign in' }).props.style).borderWidth).toBe(2)
    expect(view.queryByText(/sign up|google|apple|magic|forgot|recover|bank|billing/i)).not.toBeOnTheScreen()
  })

  it('prevents a second submit while loading', async () => {
    let resolve: (value: 'accepted') => void = () => undefined
    const onSubmit = jest.fn(() => new Promise<'accepted'>((done) => { resolve = done }))
    const { view } = await renderScreen(onSubmit)
    await fireEvent.changeText(view.getByLabelText('Email'), 'person@example.com')
    await fireEvent.changeText(view.getByLabelText('Password'), 'secret')
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(view.getByRole('button', { name: 'Signing in' })).toBeDisabled())
    await fireEvent.press(view.getByRole('button', { name: 'Signing in' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await act(async () => resolve('accepted'))
  })

  it('shows the provisioning notice when provided', async () => {
    const { view } = await renderScreen(jest.fn(), {
      notice: "We couldn't finish setting up your account. Try again",
    })
    expect(view.getByText("We couldn't finish setting up your account. Try again")).toBeOnTheScreen()
  })

  it('renders an optional footer under the submit button', async () => {
    const { view } = await renderScreen(jest.fn(), { footer: <Text>New here? Create an account</Text> })
    expect(view.getByText('New here? Create an account')).toBeOnTheScreen()
  })
})
