import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ResetPasswordScreen } from './reset-password-screen'

async function renderScreen(onSubmit = jest.fn()) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <ResetPasswordScreen onSubmit={onSubmit} />
    </I18nextProvider>,
  )
  return { view, onSubmit }
}

describe('ResetPasswordScreen', () => {
  it('validates required fields locally', async () => {
    const { view, onSubmit } = await renderScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(view.getByText('Enter your password')).toBeOnTheScreen())
    expect(view.getByText('Re-enter your password')).toBeOnTheScreen()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects a password shorter than 8 characters', async () => {
    const { view, onSubmit } = await renderScreen()
    await fireEvent.changeText(view.getByLabelText('New password'), 'short1')
    await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'short1')
    await fireEvent.press(view.getByRole('button', { name: 'Update password' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords', async () => {
    const { view, onSubmit } = await renderScreen()
    await fireEvent.changeText(view.getByLabelText('New password'), 'pw12345678')
    await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'different')
    await fireEvent.press(view.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(view.getByText('Passwords do not match')).toBeOnTheScreen())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits when valid', async () => {
    const onSubmit = jest.fn().mockResolvedValue('accepted')
    const { view } = await renderScreen(onSubmit)
    await fireEvent.changeText(view.getByLabelText('New password'), 'pw12345678')
    await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'pw12345678')
    await fireEvent.press(view.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('pw12345678'))
  })

  it.each([
    ['weak-password', 'Choose a stronger password (at least 8 characters)'],
    ['link-expired', 'This reset link has expired. Request a new one'],
    ['unavailable', 'Sign in is unavailable. Try again'],
  ] as const)('renders %s outcome as an error', async (outcome, message) => {
    const onSubmit = jest.fn().mockResolvedValue(outcome)
    const { view } = await renderScreen(onSubmit)
    await fireEvent.changeText(view.getByLabelText('New password'), 'pw12345678')
    await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'pw12345678')
    await fireEvent.press(view.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(view.getByText(message)).toBeOnTheScreen())
  })
})
