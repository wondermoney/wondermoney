import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { PasswordChangeSection } from './password-change-section'

const palette = themeTokens.colors.light

async function renderSection(overrides: Partial<React.ComponentProps<typeof PasswordChangeSection>> = {}) {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof PasswordChangeSection> = {
    pending: false,
    succeeded: false,
    failure: null,
    onSubmit: jest.fn(),
    palette,
    ...overrides,
  }
  const view = await render(
    <I18nextProvider i18n={i18n}><PasswordChangeSection {...props} /></I18nextProvider>,
  )
  return { view, props }
}

describe('PasswordChangeSection', () => {
  it('submits the current and new password once validation passes', async () => {
    const onSubmit = jest.fn()
    const { view } = await renderSection({ onSubmit })

    await fireEvent.changeText(view.getByLabelText('Current password'), 'oldpassword')
    await fireEvent.changeText(view.getByLabelText('New password'), 'newpassword123')
    await fireEvent.changeText(view.getByLabelText('Repeat new password'), 'newpassword123')
    await fireEvent.press(view.getByRole('button', { name: 'Save new password' }))

    expect(onSubmit).toHaveBeenCalledWith('oldpassword', 'newpassword123')
  })

  it('blocks submission when the new password is too short', async () => {
    const onSubmit = jest.fn()
    const { view } = await renderSection({ onSubmit })

    await fireEvent.changeText(view.getByLabelText('Current password'), 'oldpassword')
    await fireEvent.changeText(view.getByLabelText('New password'), 'short')
    await fireEvent.changeText(view.getByLabelText('Repeat new password'), 'short')
    await fireEvent.press(view.getByRole('button', { name: 'Save new password' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(view.getByRole('alert')).toHaveTextContent(/at least 8 characters/i)
  })

  it('blocks submission when the new password and confirmation do not match', async () => {
    const onSubmit = jest.fn()
    const { view } = await renderSection({ onSubmit })

    await fireEvent.changeText(view.getByLabelText('Current password'), 'oldpassword')
    await fireEvent.changeText(view.getByLabelText('New password'), 'newpassword123')
    await fireEvent.changeText(view.getByLabelText('Repeat new password'), 'somethingelse')
    await fireEvent.press(view.getByRole('button', { name: 'Save new password' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(view.getByRole('alert')).toHaveTextContent(/do not match/i)
  })

  it('surfaces an invalid-current-password failure', async () => {
    const { view } = await renderSection({ failure: 'invalid-current-password' })
    expect(view.getByRole('alert')).toHaveTextContent(/current password/i)
  })

  it('surfaces a weak-password failure', async () => {
    const { view } = await renderSection({ failure: 'weak-password' })
    expect(view.getByRole('alert')).toHaveTextContent(/too weak/i)
  })

  it('surfaces an unavailable failure', async () => {
    const { view } = await renderSection({ failure: 'unavailable' })
    expect(view.getByRole('alert')).toHaveTextContent(/could not complete that action/i)
  })

  it('shows a success message once the password has been changed', async () => {
    const { view } = await renderSection({ succeeded: true })
    expect(view.getByText('Your password has been updated.')).toBeOnTheScreen()
  })

  it('disables the form while pending', async () => {
    const { view } = await renderSection({ pending: true })
    expect(view.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })
})
