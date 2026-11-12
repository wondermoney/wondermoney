import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { externalDestinations } from './link-policy'
import { MoreRoute } from './more-route'

const mockOpenURL = jest.fn()
const mockPush = jest.fn()
const mockSignOut = jest.fn()
jest.mock('@/lib/telemetry/analytics', () => ({ captureAnalyticsEvent: jest.fn() }))
const captured = jest.mocked(captureAnalyticsEvent)
jest.mock('expo-linking', () => ({ openURL: (destination: string) => mockOpenURL(destination) }))
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('./app-display-info', () => ({
  getRuntimeAppDisplayInfo: () => ({ version: '1.0.0', environment: 'local' }),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signOut: mockSignOut }),
}))
jest.mock('@/features/self/use-self-resource', () => ({
  useProfile: () => ({ data: { profile: { emailAddress: 'person@wonder.money' } } }),
}))
const mockPendingCount = { available: true, count: 2 }
jest.mock('@/features/assistant-proposals/use-assistant-proposals', () => ({
  usePendingProposalCount: () => mockPendingCount,
}))
jest.mock('@/lib/server/use-instance', () => ({
  useServerBuildInfo: () => ({ commit: 'abc1234', version: '1.1.0' }),
}))

describe('MoreRoute', () => {
  beforeEach(() => {
    mockOpenURL.mockReset().mockResolvedValue(undefined)
    mockSignOut.mockReset()
    captured.mockClear()
  })

  it('signs out through the account menu, matching where the web app puts it', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><MoreRoute /></I18nextProvider>)
    expect(view.getByText('person@wonder.money')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Sign out, opens in the app' }))
    expect(mockSignOut).toHaveBeenCalledTimes(1)
  })

  it('does not open a destination on render and uses exact policy destinations on action', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><MoreRoute /></I18nextProvider>)
    expect(mockOpenURL).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Privacy policy, opens outside the app' }))
    expect(mockOpenURL).toHaveBeenLastCalledWith(externalDestinations.privacy)
    await fireEvent.press(view.getByRole('button', { name: 'Terms of service, opens outside the app' }))
    expect(mockOpenURL).toHaveBeenLastCalledWith(externalDestinations.terms)
    await fireEvent.press(view.getByRole('button', { name: 'Support, opens your mail app' }))
    expect(mockOpenURL.mock.calls.at(-1)?.[0]).toMatch(/^mailto:support@wonder\.money\?/)
    await fireEvent.press(view.getByRole('button', { name: 'Settings, opens in the app' }))
    expect(mockPush).toHaveBeenLastCalledWith('/settings/profile')
    await fireEvent.press(view.getByRole('button', { name: 'Overview, opens in the app' }))
    expect(mockPush).toHaveBeenLastCalledWith('/accounts')
    await fireEvent.press(view.getByRole('button', { name: 'Transactions, opens in the app' }))
    expect(mockPush).toHaveBeenLastCalledWith('/accounts/transactions')
    await fireEvent.press(view.getByRole('button', { name: 'Bills & subscriptions, opens in the app' }))
    expect(mockPush).toHaveBeenLastCalledWith('/accounts/recurring')
    await fireEvent.press(view.getByRole('button', { name: 'Financial Markets, opens in the app' }))
    expect(mockPush).toHaveBeenLastCalledWith('/markets')
    await fireEvent.press(view.getByRole('button', { name: 'Loans, opens in the app' }))
    expect(mockPush).toHaveBeenLastCalledWith('/loans')
    await fireEvent.press(view.getByRole('button', { name: 'Goals, opens in the app' }))
    expect(mockPush).toHaveBeenLastCalledWith('/goals')
    await fireEvent.press(view.getByRole('button', { name: 'Reports, opens in the app' }))
    expect(mockPush).toHaveBeenLastCalledWith('/reports')
  })

  it('submits feedback through the enriched, approved mailto destination', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><MoreRoute /></I18nextProvider>)
    await fireEvent.press(view.getByRole('button', { name: 'Share feedback, opens in the app' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Bug' }))
    await fireEvent.changeText(view.getByLabelText('Your feedback'), 'The app crashed on launch')
    await fireEvent.press(view.getByRole('button', { name: 'Send feedback' }))
    const destination = mockOpenURL.mock.calls.at(-1)?.[0] as string
    expect(destination).toMatch(/^mailto:support@wonder\.money\?/)
    expect(destination).toContain(encodeURIComponent('WonderMoney feedback: Bug'))
    expect(destination).toContain(encodeURIComponent('The app crashed on launch'))
  })

  it('captures feedback_submitted with the category alone, never the message', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><MoreRoute /></I18nextProvider>)
    await fireEvent.press(view.getByRole('button', { name: 'Share feedback, opens in the app' }))
    expect(captured).not.toHaveBeenCalled()

    await fireEvent.press(view.getByRole('radio', { name: 'Feature request' }))
    await fireEvent.changeText(view.getByLabelText('Your feedback'), 'Please add a widget for my balance')
    await fireEvent.press(view.getByRole('button', { name: 'Send feedback' }))

    expect(captured.mock.calls).toEqual([['feedback_submitted', { category: 'feature_request' }]])
    expect(JSON.stringify(captured.mock.calls)).not.toContain('widget')
  })

  it('captures nothing for the navigation and support-mail actions the ADR does not approve', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><MoreRoute /></I18nextProvider>)

    await fireEvent.press(view.getByRole('button', { name: 'Support, opens your mail app' }))
    await fireEvent.press(view.getByRole('button', { name: 'Privacy policy, opens outside the app' }))
    await fireEvent.press(view.getByRole('button', { name: 'Reports, opens in the app' }))

    expect(captured).not.toHaveBeenCalled()
  })
  it('opens Pending changes from its row, and leaves the row out when proposals are unavailable', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><MoreRoute /></I18nextProvider>)
    await fireEvent.press(view.getByRole('button', { name: 'Pending changes, 2 waiting, opens in the app' }))
    expect(mockPush).toHaveBeenLastCalledWith('/more/pending-changes')
    await view.unmount()

    mockPendingCount.available = false
    const hidden = await render(<I18nextProvider i18n={i18n}><MoreRoute /></I18nextProvider>)
    expect(hidden.queryByText('Pending changes')).toBeNull()
    mockPendingCount.available = true
  })
})
