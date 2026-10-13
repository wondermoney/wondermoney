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
})
