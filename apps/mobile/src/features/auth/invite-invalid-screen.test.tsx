import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { InviteInvalidScreen } from './invite-invalid-screen'

async function renderScreen(onBackToSignIn = jest.fn(), onContinueWithoutInvite = jest.fn()) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <InviteInvalidScreen onBackToSignIn={onBackToSignIn} onContinueWithoutInvite={onContinueWithoutInvite} />
    </I18nextProvider>,
  )
  return { view, onBackToSignIn, onContinueWithoutInvite }
}

describe('InviteInvalidScreen', () => {
  it('renders the invalid-invite title and message', async () => {
    const { view } = await renderScreen()
    expect(view.getByText("This invitation isn't valid")).toBeOnTheScreen()
    expect(view.getByText('This invitation link is invalid, has already been used, or has expired.')).toBeOnTheScreen()
  })

  it('invokes onContinueWithoutInvite', async () => {
    const { view, onContinueWithoutInvite } = await renderScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Create an account anyway' }))
    expect(onContinueWithoutInvite).toHaveBeenCalledTimes(1)
  })

  it('invokes onBackToSignIn', async () => {
    const { view, onBackToSignIn } = await renderScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Back to sign in' }))
    expect(onBackToSignIn).toHaveBeenCalledTimes(1)
  })
})
