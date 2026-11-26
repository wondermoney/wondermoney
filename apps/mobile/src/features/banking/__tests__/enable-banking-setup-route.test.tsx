import { act, fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { takeReturnAfterSignIn } from '@/lib/auth/return-after-sign-in'
import { initMobileI18n } from '@/lib/i18n'

import { EnableBankingSetupRoute } from '../enable-banking-setup-route'

const mockSignOut = jest.fn().mockResolvedValue(undefined)
const mockCreate = jest.fn()
const mockActivate = jest.fn()
const mockOpenControlPanel = jest.fn()
let mockCredential: { data: unknown; isLoading: boolean } = { data: null, isLoading: false }
let mockCertificate: { certificatePem: string; expiresAt: string } | undefined

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signOut: mockSignOut }),
}))
jest.mock('@/lib/server/use-instance', () => ({
  useEnableBankingSetup: () => ({
    applicationDescription: 'Personal use: reads my own bank accounts into WonderMoney.',
    applicationName: 'WonderMoney',
    privacyUrl: 'https://docs.example.test/privacy',
    redirectUrl: 'https://api.example.test/v1/banking/enable-banking/callback',
    termsUrl: 'https://docs.example.test/terms',
  }),
}))
jest.mock('../use-enable-banking-setup', () => ({
  useEnableBankingCredential: () => mockCredential,
  useCreateEnableBankingCertificate: () => ({ data: mockCertificate, isPending: false, mutate: mockCreate }),
  useActivateEnableBankingCredential: () => ({ isPending: false, mutate: mockActivate }),
}))
jest.mock('../enable-banking-setup-device', () => ({
  copyText: jest.fn().mockResolvedValue(true),
  openControlPanel: (url: string) => mockOpenControlPanel(url),
  readClipboardText: jest.fn().mockResolvedValue('6b1b3c2a-4e9d-4f2a-9c1b-1234567890ab'),
  shareCertificate: jest.fn().mockResolvedValue(true),
}))

async function renderRoute(onActivated = jest.fn()) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <EnableBankingSetupRoute sharedUnavailable={false} onBack={jest.fn()} onActivated={onActivated} />
    </I18nextProvider>,
  )
  return { view, onActivated }
}

const press = async (view: Awaited<ReturnType<typeof renderRoute>>['view'], name: string) => {
  await act(async () => { await fireEvent.press(view.getByRole('button', { name })) })
}

describe('EnableBankingSetupRoute', () => {
  beforeEach(() => {
    mockSignOut.mockClear(); mockCreate.mockReset(); mockActivate.mockReset(); mockOpenControlPanel.mockReset()
    mockCredential = { data: null, isLoading: false }
    mockCertificate = undefined
    takeReturnAfterSignIn()
  })

  it('waits for the credential before choosing where to start', async () => {
    mockCredential = { data: undefined, isLoading: true }
    const { view } = await renderRoute()
    expect(view.queryByText('Set up bank sync')).not.toBeOnTheScreen()
  })

  it('starts at signing in without a key, and opens the Control Panel through the browser sheet', async () => {
    const { view } = await renderRoute()
    expect(view.getByTestId('enable-banking-setup-sign_in')).toBeOnTheScreen()
    await press(view, 'Open Enable Banking')
    expect(mockOpenControlPanel).toHaveBeenCalledWith('https://enablebanking.com/sign-in/')
  })

  it('resumes from the server\'s pending certificate at pasting the application ID', async () => {
    mockCredential = { data: { applicationId: null, status: 'pending', pending: { expiresAt: '2026-12-03T10:00:00.000Z' } }, isLoading: false }
    const { view } = await renderRoute()
    expect(view.getByTestId('enable-banking-setup-application_id')).toBeOnTheScreen()
  })

  it('asks for the authenticator code when the server wants it, then sends it', async () => {
    mockCredential = { data: null, isLoading: false }
    mockCreate.mockImplementationOnce((_input, { onError }: { onError: (error: unknown) => void }) => {
      onError(new ApiError('http', 403, { serverCode: 'totp_required' }))
    })
    const { view } = await renderRoute()
    await press(view, 'Continue')
    await press(view, 'Create certificate')
    expect(mockCreate).toHaveBeenLastCalledWith({ totpCode: undefined }, expect.anything())
    expect(view.getByText('Enter your authenticator code to continue.')).toBeOnTheScreen()

    await fireEvent.changeText(view.getByLabelText('Authenticator code'), '654321')
    await press(view, 'Create certificate')
    expect(mockCreate).toHaveBeenLastCalledWith({ totpCode: '654321' }, expect.anything())
  })

  it('signs out to sign in again, and comes back to the setup afterwards', async () => {
    mockCredential = { data: { status: 'pending', pending: { expiresAt: '2026-12-03T10:00:00.000Z' } }, isLoading: false }
    mockActivate.mockImplementationOnce((_input, { onError }: { onError: (error: unknown) => void }) => {
      onError(new ApiError('http', 403, { serverCode: 'session_not_fresh' }))
    })
    const { view } = await renderRoute()
    await press(view, 'Paste')
    await press(view, 'Activate')
    await press(view, 'Sign in again')

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(takeReturnAfterSignIn()).toBe('/more/banking/connect')
  })

  it('maps an activation error to its message and the step to redo', async () => {
    mockCredential = { data: { status: 'pending', pending: { expiresAt: '2026-12-03T10:00:00.000Z' } }, isLoading: false }
    mockActivate.mockImplementationOnce((_input, { onError }: { onError: (error: unknown) => void }) => {
      onError(new ApiError('http', 400, { serverCode: 'enable_banking_application_not_activated' }))
    })
    const { view } = await renderRoute()
    await press(view, 'Paste')
    await press(view, 'Activate')
    expect(view.getByText(/This application isn't activated yet/)).toBeOnTheScreen()
    await press(view, 'Go to step 3: Activate by linking accounts')
    expect(view.getByTestId('enable-banking-setup-activate')).toBeOnTheScreen()
  })

  it('hands over to the bank list once the key is active', async () => {
    mockCredential = { data: { status: 'pending', pending: { expiresAt: '2026-12-03T10:00:00.000Z' } }, isLoading: false }
    mockActivate.mockImplementationOnce((input, { onSuccess }: { onSuccess: () => void }) => {
      expect(input).toEqual({ applicationId: '6b1b3c2a-4e9d-4f2a-9c1b-1234567890ab', totpCode: undefined })
      onSuccess()
    })
    const { view, onActivated } = await renderRoute()
    await press(view, 'Paste')
    await press(view, 'Activate')
    expect(onActivated).toHaveBeenCalledTimes(1)
  })

  it('shows the certificate it just made instead of the one waiting', async () => {
    mockCredential = { data: { status: 'pending', pending: { expiresAt: '2026-12-03T10:00:00.000Z' } }, isLoading: false }
    mockCertificate = { certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBfixture\n-----END CERTIFICATE-----\n', expiresAt: '2026-12-03T10:00:00.000Z' }
    const { view } = await renderRoute()
    await press(view, 'Back')
    await press(view, 'Back')
    expect(view.getByRole('button', { name: 'Copy certificate' })).toBeOnTheScreen()
    expect(view.queryByText(/A certificate is already waiting/)).not.toBeOnTheScreen()
  })
})
