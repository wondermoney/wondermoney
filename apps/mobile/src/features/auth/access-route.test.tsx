import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import AccessRoute from '@/app/access'
import { initMobileI18n } from '@/lib/i18n'

import { externalDestinations } from '../more/link-policy'

const mockOpenURL = jest.fn()
const mockSubmit = jest.fn()
let mockRouteState: { status: string } = { status: 'sign-out-failed' }
jest.mock('expo-linking', () => ({ openURL: (destination: string) => mockOpenURL(destination) }))
jest.mock('@/features/more/app-display-info', () => ({
  getRuntimeAppDisplayInfo: () => ({ version: '1.0.0', environment: 'staging' }),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    routeState: mockRouteState,
    signOut: jest.fn(),
    retrySignOut: jest.fn(),
  }),
}))
jest.mock('@/features/auth/use-mfa-challenge', () => ({
  useMfaChallenge: () => ({ submitting: false, failure: null, submit: mockSubmit }),
}))

describe('AccessRoute safe destinations', () => {
  beforeEach(() => {
    mockOpenURL.mockReset().mockResolvedValue(undefined)
    mockSubmit.mockReset()
    mockRouteState = { status: 'sign-out-failed' }
  })

  it('wires the inline MFA challenge form to useMfaChallenge on mfa-required', async () => {
    mockRouteState = { status: 'mfa-required' }
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><AccessRoute /></I18nextProvider>)
    await fireEvent.changeText(view.getByLabelText('6-digit code'), '123456')
    await fireEvent.press(view.getByRole('button', { name: 'Verify' }))
    expect(mockSubmit).toHaveBeenCalledWith('123456')
  })

  it('uses canonical legal and privacy destinations and a privacy-safe support message', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><AccessRoute /></I18nextProvider>)
    await fireEvent.press(view.getByRole('button', { name: 'Privacy policy, opens outside the app' }))
    expect(mockOpenURL).toHaveBeenLastCalledWith(externalDestinations.privacy)
    await fireEvent.press(view.getByRole('button', { name: 'Terms of service, opens outside the app' }))
    expect(mockOpenURL).toHaveBeenLastCalledWith(externalDestinations.terms)
    await fireEvent.press(view.getByRole('button', { name: 'Support, opens your mail app' }))
    expect(mockOpenURL.mock.calls.at(-1)?.[0]).toMatch(/^mailto:support@wonder\.money\?subject=WonderMoney%20support&body=App%20version/)
    expect(mockOpenURL.mock.calls.at(-1)?.[0]).not.toMatch(/token|account|balance|transaction|user/i)
  })
})
