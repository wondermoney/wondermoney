import { fireEvent, render } from '@testing-library/react-native'
import * as Clipboard from 'expo-clipboard'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { MfaSecuritySection } from './mfa-security-section'

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }))

const palette = themeTokens.colors.light

async function renderSection(overrides: Partial<React.ComponentProps<typeof MfaSecuritySection>> = {}) {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof MfaSecuritySection> = {
    status: 'off',
    enrollment: null,
    enrollBusy: false,
    enrollFailed: false,
    confirmBusy: false,
    confirmFailure: null,
    unenrollBusy: false,
    unenrollFailed: false,
    onRetryStatus: jest.fn(),
    onTurnOn: jest.fn(),
    onConfirm: jest.fn(),
    onCancelEnrollment: jest.fn(),
    onTurnOff: jest.fn(),
    palette,
    ...overrides,
  }
  const view = await render(
    <I18nextProvider i18n={i18n}><MfaSecuritySection {...props} /></I18nextProvider>,
  )
  return { view, props }
}

describe('MfaSecuritySection', () => {
  it('shows a loading indicator while status is unknown', async () => {
    const { view } = await renderSection({ status: 'loading' })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('offers a retry when status could not be checked', async () => {
    const onRetryStatus = jest.fn()
    const { view } = await renderSection({ status: 'error', onRetryStatus })
    expect(view.getByRole('alert')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(onRetryStatus).toHaveBeenCalledTimes(1)
  })

  it('offers to turn on two-factor authentication when it is off', async () => {
    const onTurnOn = jest.fn()
    const { view } = await renderSection({ status: 'off', onTurnOn })
    expect(view.getByText('Two-factor authentication is off')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Turn on two-factor authentication' }))
    expect(onTurnOn).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failure to start enrollment', async () => {
    const { view } = await renderSection({ status: 'off', enrollFailed: true })
    expect(view.getByRole('alert')).toHaveTextContent(/could not complete that action/i)
  })

  it('shows the setup secret for manual entry and validates the code before confirming', async () => {
    const onConfirm = jest.fn()
    const { view } = await renderSection({
      status: 'enrolling',
      enrollment: { secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/WonderMoney?secret=JBSWY3DPEHPK3PXP', backupCodes: [] },
      onConfirm,
    })
    expect(view.getByText('JBSWY3DPEHPK3PXP')).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'Confirm code' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(view.getByRole('alert')).toHaveTextContent(/enter the 6-digit code/i)

    await fireEvent.changeText(view.getByLabelText('6-digit code'), '123456')
    await fireEvent.press(view.getByRole('button', { name: 'Confirm code' }))
    expect(onConfirm).toHaveBeenCalledWith('123456')
  })

  it('lets the user cancel enrollment before confirming', async () => {
    const onCancelEnrollment = jest.fn()
    const { view } = await renderSection({
      status: 'enrolling',
      enrollment: { secret: 'secret', uri: 'uri', backupCodes: [] },
      onCancelEnrollment,
    })
    await fireEvent.press(view.getByRole('button', { name: 'Cancel setup' }))
    expect(onCancelEnrollment).toHaveBeenCalledTimes(1)
  })

  it('surfaces an invalid code without leaving enrollment', async () => {
    const { view } = await renderSection({
      status: 'enrolling',
      enrollment: { secret: 'secret', uri: 'uri', backupCodes: [] },
      confirmFailure: 'invalid-code',
    })
    expect(view.getByRole('alert')).toHaveTextContent(/that code was not correct/i)
  })

  it('shows enabled status with a way to turn it off', async () => {
    const onTurnOff = jest.fn()
    const { view } = await renderSection({ status: 'on', onTurnOff })
    expect(view.getByText('Two-factor authentication is on')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Turn off two-factor authentication' }))
    expect(onTurnOff).toHaveBeenCalledTimes(1)
  })

  it('never renders the setup secret once two-factor authentication is on', async () => {
    const { view } = await renderSection({ status: 'on' })
    expect(view.queryByText(/otpauth:\/\//)).not.toBeOnTheScreen()
  })

  it('surfaces a failure to turn off', async () => {
    const { view } = await renderSection({ status: 'on', unenrollFailed: true })
    expect(view.getByRole('alert')).toHaveTextContent(/could not complete that action/i)
  })

  it('shows the backup codes during setup, with a way to copy them', async () => {
    const { view } = await renderSection({
      status: 'enrolling',
      enrollment: { secret: 'secret', uri: 'uri', backupCodes: ['abcde-12345', 'fghij-67890'] },
    })
    expect(view.getByText('Save your backup codes')).toBeOnTheScreen()
    expect(view.getByText('abcde-12345')).toBeOnTheScreen()
    expect(view.getByText('fghij-67890')).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'Copy codes' }))
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('abcde-12345\nfghij-67890')
    expect(view.getByText('Backup codes copied to clipboard.')).toBeOnTheScreen()
  })

  it('reports a failed copy of the backup codes', async () => {
    jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('denied'))
    const { view } = await renderSection({
      status: 'enrolling',
      enrollment: { secret: 'secret', uri: 'uri', backupCodes: ['abcde-12345'] },
    })
    await fireEvent.press(view.getByRole('button', { name: 'Copy codes' }))
    expect(view.getByRole('alert')).toHaveTextContent(/could not complete that action/i)
  })

  it('never renders backup codes once two-factor authentication is on', async () => {
    const { view } = await renderSection({ status: 'on', enrollment: null })
    expect(view.queryByText('Save your backup codes')).not.toBeOnTheScreen()
  })
})
