import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { clearReturnAfterSignIn, takeReturnAfterSignIn } from '@/lib/auth/return-after-sign-in'
import { initMobileI18n } from '@/lib/i18n'

import { EnableBankingSetupRoute } from '../enable-banking-setup-route'

const SERVER = 'https://api.example.test'
const CERTIFICATE = '-----BEGIN CERTIFICATE-----\nMIIBfixture\n-----END CERTIFICATE-----\n'
const mockSignOut = jest.fn().mockResolvedValue(undefined)
const mockSessionStartedAt = jest.fn()
const mockCreate = jest.fn()
const mockCreateReset = jest.fn()
const mockActivate = jest.fn()
const mockInvalidate = jest.fn().mockResolvedValue(undefined)
const mockOpenControlPanel = jest.fn().mockResolvedValue(true)
const mockRetryValues = jest.fn()
let mockCredential: { data: unknown; isLoading: boolean } = { data: null, isLoading: false }
let mockCertificate: { certificatePem: string; expiresAt: string } | undefined
let mockViewerRole: string | null = 'owner'

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 3, principalId: 'user-1' }, signOut: mockSignOut, sessionStartedAt: mockSessionStartedAt }),
}))
jest.mock('@/components/providers/server-switch-provider', () => ({
  useServerSwitch: () => ({ apiBaseUrl: SERVER }),
}))
jest.mock('@/features/household/use-household-members', () => ({
  useHouseholdMembers: () => ({ viewerRole: mockViewerRole }),
}))
jest.mock('@/lib/server/use-instance', () => ({
  useEnableBankingSetup: () => ({
    retry: mockRetryValues,
    status: 'ready',
    values: {
      applicationDescription: 'Personal use: reads my own bank accounts into WonderMoney.',
      applicationName: 'WonderMoney',
      privacyUrl: 'https://docs.example.test/privacy',
      redirectUrl: 'https://api.example.test/v1/banking/enable-banking/callback',
      termsUrl: 'https://docs.example.test/terms',
    },
  }),
}))
jest.mock('../use-enable-banking-setup', () => ({
  useEnableBankingCredential: () => mockCredential,
  useInvalidateEnableBankingCredential: () => mockInvalidate,
  useCreateEnableBankingCertificate: () => ({ data: mockCertificate, isPending: false, mutate: mockCreate, reset: mockCreateReset }),
  useActivateEnableBankingCredential: () => ({ isPending: false, mutate: mockActivate }),
}))
jest.mock('../enable-banking-setup-device', () => ({
  copyText: jest.fn().mockResolvedValue(true),
  openControlPanel: (url: string) => mockOpenControlPanel(url),
  readClipboardText: jest.fn().mockResolvedValue('6b1b3c2a-4e9d-4f2a-9c1b-1234567890ab'),
  shareCertificate: jest.fn().mockResolvedValue(true),
}))

const PENDING = { applicationId: null, status: 'pending', pending: { expiresAt: '2026-12-03T10:00:00.000Z' } }

async function renderRoute(onActivated = jest.fn(), { waitForScreen = true } = {}) {
  const i18n = await initMobileI18n('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = await render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <EnableBankingSetupRoute sharedUnavailable={false} onBack={jest.fn()} onActivated={onActivated} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  // The session's age arrives asynchronously; the screen shows once it has.
  if (waitForScreen) await view.findByText('Set up bank sync')
  return { view, onActivated }
}

const press = async (view: Awaited<ReturnType<typeof renderRoute>>['view'], name: string) => {
  await act(async () => { await fireEvent.press(view.getByRole('button', { name })) })
}

describe('EnableBankingSetupRoute', () => {
  beforeEach(() => {
    mockSignOut.mockClear(); mockCreate.mockReset(); mockCreateReset.mockReset(); mockActivate.mockReset()
    mockInvalidate.mockClear(); mockOpenControlPanel.mockClear()
    mockSessionStartedAt.mockReset().mockResolvedValue(new Date().toISOString())
    mockCredential = { data: null, isLoading: false }
    mockCertificate = undefined
    mockViewerRole = 'owner'
    clearReturnAfterSignIn()
  })

  it('waits for the credential before choosing where to start', async () => {
    mockCredential = { data: undefined, isLoading: true }
    const { view } = await renderRoute(jest.fn(), { waitForScreen: false })
    expect(view.queryByText('Set up bank sync')).not.toBeOnTheScreen()
  })

  it('starts at signing in without a key, and opens Enable Banking beside the app', async () => {
    const { view } = await renderRoute()
    expect(view.getByTestId('enable-banking-setup-sign_in')).toBeOnTheScreen()
    await press(view, 'Open Enable Banking')
    expect(mockOpenControlPanel).toHaveBeenCalledWith('https://enablebanking.com/sign-in/')
  })

  it('resumes from the server\'s pending certificate at pasting the application ID', async () => {
    mockCredential = { data: PENDING, isLoading: false }
    const { view } = await renderRoute()
    expect(view.getByTestId('enable-banking-setup-application_id')).toBeOnTheScreen()
  })

  it('shows a household viewer the read-only notice, not the steps', async () => {
    mockViewerRole = 'viewer'
    const { view } = await renderRoute()
    expect(view.getByTestId('enable-banking-setup-read-only')).toBeOnTheScreen()
  })

  it('offers to sign in again before step 1 when the session is too old to finish, and comes back after', async () => {
    mockSessionStartedAt.mockResolvedValue(new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString())
    const { view } = await renderRoute()
    expect(view.getByTestId('enable-banking-setup-sign-in-again')).toBeOnTheScreen()
    await press(view, 'Sign in again')
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(takeReturnAfterSignIn('user-1', SERVER)).toBe('/more/banking/connect')
  })

  it('goes on to the steps when the session\'s age is unknown', async () => {
    mockSessionStartedAt.mockResolvedValue(null)
    const { view } = await renderRoute()
    expect(view.getByTestId('enable-banking-setup-sign_in')).toBeOnTheScreen()
  })

  it('asks for the authenticator code when the server wants it, then sends it', async () => {
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

  it('signs out to sign in again when the server says the session is stale, and comes back for this person on this server', async () => {
    mockCredential = { data: PENDING, isLoading: false }
    mockActivate.mockImplementationOnce((_input, { onError }: { onError: (error: unknown) => void }) => {
      onError(new ApiError('http', 403, { serverCode: 'session_not_fresh' }))
    })
    const { view } = await renderRoute()
    await press(view, 'Paste')
    await press(view, 'Activate')
    await press(view, 'Sign in again')

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(takeReturnAfterSignIn('someone-else', SERVER)).toBeNull()
  })

  it('maps an activation error to its message and the step to redo', async () => {
    mockCredential = { data: PENDING, isLoading: false }
    mockActivate.mockImplementationOnce((_input, { onError }: { onError: (error: unknown) => void }) => {
      onError(new ApiError('http', 400, { serverCode: 'enable_banking_application_not_activated' }))
    })
    const { view } = await renderRoute()
    await press(view, 'Paste')
    await press(view, 'Activate')
    expect(view.getByText(/This application isn't activated yet/)).toBeOnTheScreen()
    await press(view, 'Go to step 3: Activate by linking accounts')
    expect(view.getByTestId('enable-banking-setup-activate')).toBeOnTheScreen()
    expect(mockCreateReset).not.toHaveBeenCalled()
  })

  it('forgets a dead certificate, so step 2 offers to create one again', async () => {
    mockCredential = { data: PENDING, isLoading: false }
    mockCertificate = { certificatePem: CERTIFICATE, expiresAt: '2026-12-03T10:00:00.000Z' }
    mockActivate.mockImplementationOnce((_input, { onError }: { onError: (error: unknown) => void }) => {
      onError(new ApiError('http', 409, { serverCode: 'enable_banking_pending_credential_missing' }))
    })
    mockCreateReset.mockImplementation(() => { mockCertificate = undefined })
    mockInvalidate.mockImplementation(async () => { mockCredential = { data: null, isLoading: false } })
    const { view } = await renderRoute()
    await press(view, 'Paste')
    await press(view, 'Activate')

    expect(mockCreateReset).toHaveBeenCalledTimes(1)
    expect(mockInvalidate).toHaveBeenCalledTimes(1)
    await press(view, 'Go to step 2: Create the application')
    expect(view.getByRole('button', { name: 'Create certificate' })).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Copy certificate' })).not.toBeOnTheScreen()
  })

  it('hands over to the bank list once the key is active', async () => {
    mockCredential = { data: PENDING, isLoading: false }
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
    mockCredential = { data: PENDING, isLoading: false }
    mockCertificate = { certificatePem: CERTIFICATE, expiresAt: '2026-12-03T10:00:00.000Z' }
    const { view } = await renderRoute()
    await press(view, 'Back')
    await press(view, 'Back')
    expect(view.getByRole('button', { name: 'Copy certificate' })).toBeOnTheScreen()
    expect(view.queryByText(/A certificate is already waiting/)).not.toBeOnTheScreen()
  })
})
