import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { MfaChallengeForm } from './mfa-challenge-form'

const palette = themeTokens.colors.light

async function renderForm(overrides: Partial<React.ComponentProps<typeof MfaChallengeForm>> = {}) {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof MfaChallengeForm> = {
    submitting: false,
    failure: null,
    onSubmit: jest.fn(),
    onSubmitBackupCode: jest.fn(),
    palette,
    ...overrides,
  }
  const view = await render(
    <I18nextProvider i18n={i18n}><MfaChallengeForm {...props} /></I18nextProvider>,
  )
  return { view, props }
}

describe('MfaChallengeForm', () => {
  it('validates the code before submitting', async () => {
    const onSubmit = jest.fn()
    const { view } = await renderForm({ onSubmit })
    await fireEvent.press(view.getByRole('button', { name: 'Verify' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(view.getByRole('alert')).toHaveTextContent(/enter the 6-digit code/i)
  })

  it('submits the normalized code', async () => {
    const onSubmit = jest.fn()
    const { view } = await renderForm({ onSubmit })
    await fireEvent.changeText(view.getByLabelText('6-digit code'), '123456')
    await fireEvent.press(view.getByRole('button', { name: 'Verify' }))
    expect(onSubmit).toHaveBeenCalledWith('123456')
  })

  it('shows an invalid-code failure', async () => {
    const { view } = await renderForm({ failure: 'invalid-code' })
    expect(view.getByRole('alert')).toHaveTextContent(/that code was not correct/i)
  })

  it('shows an unavailable failure', async () => {
    const { view } = await renderForm({ failure: 'unavailable' })
    expect(view.getByRole('alert')).toHaveTextContent(/could not verify that code/i)
  })

  it('disables the field and button while submitting', async () => {
    const onSubmit = jest.fn()
    const { view } = await renderForm({ submitting: true, onSubmit })
    const button = view.getByRole('button', { name: 'Verifying…' })
    expect(button.props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(button)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(view.getByLabelText('6-digit code').props.editable).toBe(false)
  })

  it('never renders the typed code as plain surrounding text', async () => {
    const { view } = await renderForm()
    await fireEvent.changeText(view.getByLabelText('6-digit code'), '654321')
    expect(view.queryByText('654321')).not.toBeOnTheScreen()
  })

  it('signs in with a backup code, sending it normalized to the backup-code path', async () => {
    const onSubmit = jest.fn()
    const onSubmitBackupCode = jest.fn()
    const { view } = await renderForm({ onSubmit, onSubmitBackupCode })

    await fireEvent.press(view.getByRole('button', { name: 'Use a backup code' }))
    await fireEvent.changeText(view.getByLabelText('Enter one of your backup codes'), ' abcde12345 ')
    await fireEvent.press(view.getByRole('button', { name: 'Verify' }))

    expect(onSubmitBackupCode).toHaveBeenCalledWith('abcde-12345')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('asks for a backup code before sending an empty one', async () => {
    const onSubmitBackupCode = jest.fn()
    const { view } = await renderForm({ onSubmitBackupCode })

    await fireEvent.press(view.getByRole('button', { name: 'Use a backup code' }))
    await fireEvent.press(view.getByRole('button', { name: 'Verify' }))

    expect(onSubmitBackupCode).not.toHaveBeenCalled()
    expect(view.getByRole('alert')).toHaveTextContent(/enter a backup code/i)
  })

  it('clears a refused backup code and says it is invalid or used', async () => {
    const i18n = await initMobileI18n('en')
    const onSubmitBackupCode = jest.fn()
    const props = { submitting: false, onSubmit: jest.fn(), onSubmitBackupCode, palette }
    const view = await render(
      <I18nextProvider i18n={i18n}><MfaChallengeForm {...props} failure={null} /></I18nextProvider>,
    )

    await fireEvent.press(view.getByRole('button', { name: 'Use a backup code' }))
    await fireEvent.changeText(view.getByLabelText('Enter one of your backup codes'), 'abcde-12345')
    await fireEvent.press(view.getByRole('button', { name: 'Verify' }))
    await view.rerender(
      <I18nextProvider i18n={i18n}><MfaChallengeForm {...props} failure="invalid-code" /></I18nextProvider>,
    )

    expect(view.getByRole('alert')).toHaveTextContent(/isn't valid or has already been used/i)
    expect(view.getByLabelText('Enter one of your backup codes').props.value).toBe('')
  })

  it('switches back to the authenticator code, dropping the typed backup code', async () => {
    const { view } = await renderForm()

    await fireEvent.press(view.getByRole('button', { name: 'Use a backup code' }))
    await fireEvent.changeText(view.getByLabelText('Enter one of your backup codes'), 'abcde-12345')
    await fireEvent.press(view.getByRole('button', { name: 'Use your authenticator app instead' }))

    expect(view.getByLabelText('6-digit code')).toBeOnTheScreen()
    expect(view.queryByText('abcde-12345')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Use a backup code' }))
    expect(view.getByLabelText('Enter one of your backup codes').props.value).toBe('')
  })

  it.each([
    ['challenge-expired', /sign out and sign in again/i],
    ['rate-limited', /wait a few minutes/i],
  ] as const)('explains a %s failure', async (failure, message) => {
    const { view } = await renderForm({ failure })
    expect(view.getByRole('alert')).toHaveTextContent(message)
  })

  it('does not carry an authenticator-code failure over to the backup-code field', async () => {
    const { view } = await renderForm({ failure: 'invalid-code' })
    await fireEvent.press(view.getByRole('button', { name: 'Use a backup code' }))
    expect(view.queryByRole('alert')).not.toBeOnTheScreen()
  })
})
