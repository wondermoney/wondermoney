import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet, Text } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { SignUpScreen } from './sign-up-screen'

async function renderScreen(onSubmit = jest.fn()) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <SignUpScreen onSubmit={onSubmit} />
    </I18nextProvider>,
  )
  return { view, onSubmit }
}

async function fillValidForm(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.changeText(view.getByLabelText('Email'), 'a@b.co')
  await fireEvent.changeText(view.getByLabelText('Password'), 'pw12345678')
  await fireEvent.changeText(view.getByLabelText('Confirm password'), 'pw12345678')
  await fireEvent.press(view.getByLabelText('I agree to the Terms and Privacy Policy'))
}

describe('SignUpScreen', () => {
  it('validates required fields locally', async () => {
    const { view, onSubmit } = await renderScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(view.getByText('Enter your email address')).toBeOnTheScreen())
    expect(view.getByText('Enter your password')).toBeOnTheScreen()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('blocks submit until terms are accepted and passwords match', async () => {
    const onSubmit = jest.fn().mockResolvedValue('accepted')
    const { view } = await renderScreen(onSubmit)
    await fireEvent.changeText(view.getByLabelText('Email'), 'a@b.co')
    await fireEvent.changeText(view.getByLabelText('Password'), 'pw12345678')
    await fireEvent.changeText(view.getByLabelText('Confirm password'), 'different')
    await fireEvent.press(view.getByRole('button', { name: 'Create account' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(view.getByText('Passwords do not match')).toBeOnTheScreen()
  })

  it('blocks submit until terms are accepted', async () => {
    const onSubmit = jest.fn().mockResolvedValue('accepted')
    const { view } = await renderScreen(onSubmit)
    await fireEvent.changeText(view.getByLabelText('Email'), 'a@b.co')
    await fireEvent.changeText(view.getByLabelText('Password'), 'pw12345678')
    await fireEvent.changeText(view.getByLabelText('Confirm password'), 'pw12345678')
    await fireEvent.press(view.getByRole('button', { name: 'Create account' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(view.getByText('Accept the Terms to continue')).toBeOnTheScreen()
  })

  it('rejects a password shorter than 8 characters', async () => {
    const onSubmit = jest.fn().mockResolvedValue('accepted')
    const { view } = await renderScreen(onSubmit)
    await fireEvent.changeText(view.getByLabelText('Email'), 'a@b.co')
    await fireEvent.changeText(view.getByLabelText('Password'), 'short1')
    await fireEvent.changeText(view.getByLabelText('Confirm password'), 'short1')
    await fireEvent.press(view.getByLabelText('I agree to the Terms and Privacy Policy'))
    await fireEvent.press(view.getByRole('button', { name: 'Create account' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits when valid and terms accepted', async () => {
    const onSubmit = jest.fn().mockResolvedValue('accepted')
    const { view } = await renderScreen(onSubmit)
    await fillValidForm(view)
    await fireEvent.press(view.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('a@b.co', 'pw12345678'))
  })

  it.each([
    ['email-taken', 'That email already has an account. Sign in instead'],
    ['weak-password', 'Choose a stronger password (at least 8 characters)'],
    ['unavailable', 'Account creation is unavailable. Try again'],
  ] as const)('renders %s outcome as an error', async (outcome, message) => {
    const onSubmit = jest.fn().mockResolvedValue(outcome)
    const { view } = await renderScreen(onSubmit)
    await fillValidForm(view)
    await fireEvent.press(view.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(view.getByRole('alert', { name: message })).toBeOnTheScreen())
  })

  it('toggles the terms checkbox state', async () => {
    const { view } = await renderScreen()
    const checkbox = view.getByLabelText('I agree to the Terms and Privacy Policy')
    expect(checkbox.props.accessibilityRole).toBe('checkbox')
    expect(checkbox.props.accessibilityState).toEqual(expect.objectContaining({ checked: false }))
    await fireEvent.press(checkbox)
    expect(view.getByLabelText('I agree to the Terms and Privacy Policy').props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    )
  })

  it('uses secure, scalable 48dp controls', async () => {
    const { view } = await renderScreen()
    const password = view.getByLabelText('Password')
    expect(password.props.secureTextEntry).toBe(true)
    const confirm = view.getByLabelText('Confirm password')
    expect(confirm.props.secureTextEntry).toBe(true)
    expect(view.getByLabelText('Email').props.autoCapitalize).toBe('none')
    const button = view.getByRole('button', { name: 'Create account' })
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(48)
  })

  it('prevents a second submit while loading', async () => {
    let resolve: (value: 'accepted') => void = () => undefined
    const onSubmit = jest.fn(() => new Promise<'accepted'>((done) => { resolve = done }))
    const { view } = await renderScreen(onSubmit)
    await fillValidForm(view)
    await fireEvent.press(view.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(view.getByRole('button', { name: 'Creating account' })).toBeDisabled())
    await fireEvent.press(view.getByRole('button', { name: 'Creating account' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await act(async () => resolve('accepted'))
  })

  it('renders an optional footer under the submit button', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(
      <I18nextProvider i18n={i18n}>
        <SignUpScreen onSubmit={jest.fn()} footer={<Text>Already have an account? Sign in</Text>} />
      </I18nextProvider>,
    )
    expect(view.getByText('Already have an account? Sign in')).toBeOnTheScreen()
  })

  it('pre-fills and locks the email field for a validated household invite', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(
      <I18nextProvider i18n={i18n}>
        <SignUpScreen onSubmit={jest.fn()} initialEmail="partner@example.com" emailLocked />
      </I18nextProvider>,
    )
    const email = view.getByLabelText('Email')
    expect(email.props.value).toBe('partner@example.com')
    expect(email.props.editable).toBe(false)
  })

  it('renders an invite greeting above the title when provided', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(
      <I18nextProvider i18n={i18n}>
        <SignUpScreen onSubmit={jest.fn()} greeting="Alex invited you to their household" />
      </I18nextProvider>,
    )
    expect(view.getByText('Alex invited you to their household')).toBeOnTheScreen()
  })

  it('submits the locked email unchanged', async () => {
    const onSubmit = jest.fn().mockResolvedValue('accepted')
    const i18n = await initMobileI18n('en')
    const view = await render(
      <I18nextProvider i18n={i18n}>
        <SignUpScreen onSubmit={onSubmit} initialEmail="partner@example.com" emailLocked />
      </I18nextProvider>,
    )
    await fireEvent.changeText(view.getByLabelText('Password'), 'pw12345678')
    await fireEvent.changeText(view.getByLabelText('Confirm password'), 'pw12345678')
    await fireEvent.press(view.getByLabelText('I agree to the Terms and Privacy Policy'))
    await fireEvent.press(view.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('partner@example.com', 'pw12345678'))
  })
})
