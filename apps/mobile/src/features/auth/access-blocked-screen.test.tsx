import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { AccessBlockedScreen } from './access-blocked-screen'

async function renderState(status: 'mfa-required' | 'sign-out-failed') {
  const i18n = await initMobileI18n('en')
  const onLogout = jest.fn()
  const onRetrySignOut = jest.fn()
  const onOpenPrivacy = jest.fn().mockResolvedValue(undefined)
  const onOpenTerms = jest.fn().mockResolvedValue(undefined)
  const onOpenSupport = jest.fn().mockResolvedValue(undefined)
  const onSubmitMfaCode = jest.fn()
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <AccessBlockedScreen
        status={status}
        onLogout={onLogout}
        onRetrySignOut={onRetrySignOut}
        onOpenPrivacy={onOpenPrivacy}
        onOpenTerms={onOpenTerms}
        onOpenSupport={onOpenSupport}
        mfaChallenge={{ submitting: false, failure: null, onSubmit: onSubmitMfaCode }}
      />
    </I18nextProvider>,
  )
  return { view, onLogout, onRetrySignOut, onOpenPrivacy, onOpenTerms, onOpenSupport, onSubmitMfaCode }
}

describe('AccessBlockedScreen', () => {
  it.each(['mfa-required'] as const)('offers logout for %s', async (status) => {
    const { view, onLogout } = await renderState(status)
    await fireEvent.press(view.getByRole('button', { name: 'Sign out' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(view.queryByText(/€|accounts|portfolio/i)).not.toBeOnTheScreen()
  })

  it('keeps product data locked while exposing safe status, support, legal, and sign-out actions', async () => {
    const { view, onOpenPrivacy, onOpenTerms, onOpenSupport } = await renderState('mfa-required')
    const labels = [
      'Support, opens your mail app',
      'Privacy policy, opens outside the app',
      'Terms of service, opens outside the app',
      'Sign out',
    ]
    for (const label of labels) {
      expect(StyleSheet.flatten(view.getByRole('button', { name: label }).props.style).minHeight).toBeGreaterThanOrEqual(44)
    }
    await fireEvent.press(view.getByRole('button', { name: labels[0] }))
    await fireEvent.press(view.getByRole('button', { name: labels[1] }))
    await fireEvent.press(view.getByRole('button', { name: labels[2] }))
    expect(onOpenSupport).toHaveBeenCalledTimes(1)
    expect(onOpenPrivacy).toHaveBeenCalledTimes(1)
    expect(onOpenTerms).toHaveBeenCalledTimes(1)
    expect(view.queryByText(/€|account balance|portfolio|transaction/i)).not.toBeOnTheScreen()
  })

  it('marks an external action busy and blocks duplicate activation', async () => {
    let resolve!: () => void
    const pending = new Promise<void>((done) => { resolve = done })
    const i18n = await initMobileI18n('en')
    const onOpenSupport = jest.fn(() => pending)
    const view = await render(<I18nextProvider i18n={i18n}><AccessBlockedScreen status="mfa-required" onOpenSupport={onOpenSupport} /></I18nextProvider>)
    const support = view.getByRole('button', { name: 'Support, opens your mail app' })
    await fireEvent.press(support)
    expect(view.getByRole('button', { name: 'Support, opens your mail app' }).props.accessibilityState).toMatchObject({ busy: true, disabled: true })
    await fireEvent.press(support)
    expect(onOpenSupport).toHaveBeenCalledTimes(1)
    resolve()
    await waitFor(() => expect(view.getByRole('button', { name: 'Support, opens your mail app' }).props.accessibilityState).toMatchObject({ busy: false }))
  })

  it('clears busy state and keeps the action available after rejection', async () => {
    let reject!: (reason?: unknown) => void
    const pending = new Promise<void>((_resolve, fail) => { reject = fail })
    const i18n = await initMobileI18n('en')
    const onOpenPrivacy = jest.fn(() => pending)
    const view = await render(<I18nextProvider i18n={i18n}><AccessBlockedScreen status="mfa-required" onOpenPrivacy={onOpenPrivacy} /></I18nextProvider>)
    await fireEvent.press(view.getByRole('button', { name: 'Privacy policy, opens outside the app' }))
    expect(view.getByRole('button', { name: 'Privacy policy, opens outside the app' }).props.accessibilityState).toMatchObject({ busy: true, disabled: true })

    reject(new Error('browser unavailable'))

    await waitFor(() => expect(view.getByRole('button', { name: 'Privacy policy, opens outside the app' }).props.accessibilityState).toMatchObject({ busy: false, disabled: false }))
    expect(view.getByRole('alert')).toHaveTextContent('Could not complete that action. Try again')
  })

  it('offers an inline TOTP challenge to resolve mfa-required', async () => {
    const { view, onSubmitMfaCode } = await renderState('mfa-required')
    expect(view.getByText('Enter the 6-digit code from your authenticator app to continue')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('6-digit code'), '123456')
    await fireEvent.press(view.getByRole('button', { name: 'Verify' }))
    expect(onSubmitMfaCode).toHaveBeenCalledWith('123456')
  })

  it('does not offer the TOTP challenge for other blocked states', async () => {
    const { view } = await renderState('sign-out-failed')
    expect(view.queryByLabelText('6-digit code')).not.toBeOnTheScreen()
  })

  it('only permits retry sign out when session state is uncertain', async () => {
    const { view, onRetrySignOut } = await renderState('sign-out-failed')
    expect(view.queryByRole('button', { name: 'Sign in' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Sign out' })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Retry sign out' }))
    expect(onRetrySignOut).toHaveBeenCalledTimes(1)
  })
})
