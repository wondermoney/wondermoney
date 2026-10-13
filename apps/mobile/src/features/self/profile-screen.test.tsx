import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { ProfileScreen } from './profile-screen'

async function renderScreen(state: React.ComponentProps<typeof ProfileScreen>['state']) {
  const i18n = await initMobileI18n('en')
  const back = jest.fn()
  const retry = jest.fn()
  const logout = jest.fn()
  const edit = jest.fn()
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <ProfileScreen state={state} onBack={back} onRetry={retry} onLogout={logout} onEdit={edit} />
    </I18nextProvider>,
  )
  return { view, back, retry, logout, edit }
}

describe('ProfileScreen', () => {
  it('shows only verified read-only profile fields with neutral missing names', async () => {
    const { view } = await renderScreen({
      status: 'loaded',
      data: {
        emailAddress: 'person@example.com',
        firstName: null,
        lastName: 'Silva',
        mfaEnabled: false,
      },
    })
    expect(view.getByLabelText('Email, person@example.com')).toBeOnTheScreen()
    expect(view.getByLabelText('First name, Not provided')).toBeOnTheScreen()
    expect(view.getByLabelText('Last name, Silva')).toBeOnTheScreen()
    expect(view.getByLabelText('Multi-factor authentication, Not enabled')).toBeOnTheScreen()
    expect(view.queryByText(/delete|provider|referral|tenant|currency|phone|avatar|user id/i)).not.toBeOnTheScreen()
  })

  it('offers an edit action that opens the name editor', async () => {
    const { view, edit } = await renderScreen({
      status: 'loaded',
      data: { emailAddress: 'a@b.com', firstName: 'Ada', lastName: 'Lovelace', mfaEnabled: false },
    })
    await fireEvent.press(view.getByRole('button', { name: 'Edit name' }))
    expect(edit).toHaveBeenCalledTimes(1)
  })

  it('shows enabled MFA and safe loading/stale/error/access states', async () => {
    const enabled = await renderScreen({
      status: 'loaded',
      data: { emailAddress: 'a@b.com', firstName: 'Ada', lastName: null, mfaEnabled: true },
    })
    expect(enabled.view.getByLabelText('Multi-factor authentication, Enabled')).toBeOnTheScreen()

    const loading = await renderScreen({ status: 'loading' })
    expect(loading.view.getByRole('progressbar', { name: 'Loading profile' })).toBeOnTheScreen()

    const stale = await renderScreen({
      status: 'refresh-error',
      data: { emailAddress: 'a@b.com', firstName: 'Ada', lastName: null, mfaEnabled: true },
    })
    expect(stale.view.getByRole('alert', { name: 'Could not refresh. Showing previously loaded profile' })).toBeOnTheScreen()
    expect(stale.view.getByLabelText('Email, a@b.com')).toBeOnTheScreen()
    await fireEvent.press(stale.view.getByRole('button', { name: 'Retry' }))
    expect(stale.retry).toHaveBeenCalledTimes(1)

    const invalid = await renderScreen({ status: 'invalid-response' })
    expect(invalid.view.queryByText('a@b.com')).not.toBeOnTheScreen()
    expect(invalid.view.getByRole('button', { name: 'Back' })).toBeOnTheScreen()

    const access = await renderScreen({ status: 'access-transition' })
    expect(access.view.toJSON()).toBeNull()
  })

  it('shows a specific non-retryable not-found state', async () => {
    const { view, retry } = await renderScreen({ status: 'not-found' })
    expect(view.getByRole('header', { name: 'Profile not available' })).toBeOnTheScreen()
    expect(view.getByText('No profile information is available for this account. Return to More')).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
    expect(retry).not.toHaveBeenCalled()
  })

  it('marks stale retry busy and keeps its target at least 44pt', async () => {
    const { view } = await renderScreen({
      status: 'refresh-error',
      refreshing: true,
      data: { emailAddress: 'a@b.com', firstName: null, lastName: null, mfaEnabled: false },
    })
    const retry = view.getByRole('button', { name: 'Retry' })
    expect(retry.props.accessibilityState).toMatchObject({ busy: true, disabled: true })
    expect(StyleSheet.flatten(retry.props.style).minHeight).toBeGreaterThanOrEqual(44)
  })

  it('keeps actions scalable and at least 44pt', async () => {
    const { view } = await renderScreen({ status: 'error' })
    for (const name of ['Back', 'Retry', 'Sign out']) {
      const action = view.getByRole('button', { name })
      expect(StyleSheet.flatten(action.props.style).minHeight).toBeGreaterThanOrEqual(44)
      expect(within(action).getByText(name).props.allowFontScaling).not.toBe(false)
    }
    await fireEvent(view.getByRole('button', { name: 'Back' }), 'focus')
    expect(StyleSheet.flatten(view.getByRole('button', { name: 'Back' }).props.style).borderWidth).toBe(2)
  })
})
