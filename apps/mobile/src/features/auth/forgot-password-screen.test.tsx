import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ForgotPasswordScreen } from './forgot-password-screen'

async function renderScreen(onSubmit = jest.fn(), notice?: string) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <ForgotPasswordScreen notice={notice} onSubmit={onSubmit} />
    </I18nextProvider>,
  )
  return { view, onSubmit }
}

describe('ForgotPasswordScreen', () => {
  it('validates the email locally', async () => {
    const { view, onSubmit } = await renderScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(view.getByText('Enter your email address')).toBeOnTheScreen())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects an invalid email format', async () => {
    const { view, onSubmit } = await renderScreen()
    await fireEvent.changeText(view.getByLabelText('Email'), 'not-an-email')
    await fireEvent.press(view.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(view.getByText('Enter a valid email address')).toBeOnTheScreen())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a normalized email and shows the sent confirmation', async () => {
    const onSubmit = jest.fn().mockResolvedValue('sent')
    const { view } = await renderScreen(onSubmit)
    await fireEvent.changeText(view.getByLabelText('Email'), '  a@b.co  ')
    await fireEvent.press(view.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('a@b.co'))
    await waitFor(() => expect(view.getByText("If an account exists for that email, we've sent a reset link")).toBeOnTheScreen())
  })

  it.each([
    ['rate-limited', 'Too many attempts. Try again in a few minutes'],
    ['unavailable', 'Sign in is unavailable. Try again'],
  ] as const)('renders %s outcome as an error', async (outcome, message) => {
    const onSubmit = jest.fn().mockResolvedValue(outcome)
    const { view } = await renderScreen(onSubmit)
    await fireEvent.changeText(view.getByLabelText('Email'), 'a@b.co')
    await fireEvent.press(view.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(view.getByText(message)).toBeOnTheScreen())
  })

  it('renders a notice when provided', async () => {
    const { view } = await renderScreen(jest.fn(), 'This reset link has expired. Request a new one')
    expect(view.getByText('This reset link has expired. Request a new one')).toBeOnTheScreen()
  })

  it('clears sent state on resubmit (regression: prevents dual success/error banners)', async () => {
    const onSubmit = jest
      .fn()
      .mockResolvedValueOnce('sent')
      .mockResolvedValueOnce('unavailable')
    const { view } = await renderScreen(onSubmit)
    await fireEvent.changeText(view.getByLabelText('Email'), 'a@b.co')

    // First submission: success
    await fireEvent.press(view.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(view.getByText("If an account exists for that email, we've sent a reset link")).toBeOnTheScreen())

    // Second submission WITHOUT editing email: error
    await fireEvent.press(view.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(view.getByText('Sign in is unavailable. Try again')).toBeOnTheScreen())

    // Success text should no longer be visible; only error
    expect(view.queryByText("If an account exists for that email, we've sent a reset link")).not.toBeOnTheScreen()
  })
})
