import { act, fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { EnableBankingSetupScreen, type EnableBankingSetupScreenProps } from '../enable-banking-setup-screen'
import type { EnableBankingSetupFailure } from '../enable-banking-setup-view-model'

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}))

const values = [
  { field: 'name' as const, value: 'WonderMoney' },
  { field: 'description' as const, value: 'Personal use: reads my own bank accounts into WonderMoney.' },
  { field: 'redirectUrl' as const, value: 'https://api.example.test/v1/banking/enable-banking/callback' },
  { field: 'privacyUrl' as const, value: 'https://docs.example.test/privacy' },
  { field: 'termsUrl' as const, value: 'https://docs.example.test/terms' },
]

const CERTIFICATE = '-----BEGIN CERTIFICATE-----\nMIIBfixture\n-----END CERTIFICATE-----\n'

async function setup(overrides: Partial<EnableBankingSetupScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: EnableBankingSetupScreenProps = {
    initialStep: 'sign_in',
    sharedUnavailable: false,
    values,
    certificatePem: null,
    pendingExpiresAt: null,
    creatingCertificate: false,
    activating: false,
    failure: null,
    askForCode: false,
    onBack: jest.fn(),
    onOpenUrl: jest.fn(),
    onCreateCertificate: jest.fn(),
    onActivate: jest.fn(),
    onCopy: jest.fn().mockResolvedValue(true),
    onShareCertificate: jest.fn().mockResolvedValue(true),
    onReadClipboard: jest.fn().mockResolvedValue(null),
    onSignInAgain: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><EnableBankingSetupScreen {...props} /></I18nextProvider>)
  return { view, props }
}

const press = async (view: Awaited<ReturnType<typeof setup>>['view'], name: string | RegExp) => {
  await act(async () => { await fireEvent.press(view.getByRole('button', { name })) })
}

describe('EnableBankingSetupScreen', () => {
  it('opens on signing in, and opens Enable Banking\'s sign-in page in the browser sheet', async () => {
    const { view, props } = await setup()
    expect(view.getByText('Step 1 of 5')).toBeOnTheScreen()
    expect(view.getByText('Sign in to Enable Banking')).toBeOnTheScreen()
    await press(view, 'Open Enable Banking')
    expect(props.onOpenUrl).toHaveBeenCalledWith('https://enablebanking.com/sign-in/')
  })

  it('walks forwards and back through the steps', async () => {
    const { view } = await setup({ certificatePem: CERTIFICATE })
    await press(view, 'Continue')
    expect(view.getByText('Step 2 of 5')).toBeOnTheScreen()
    await press(view, 'Continue')
    expect(view.getByText('Activate by linking accounts')).toBeOnTheScreen()
    await press(view, 'Back')
    expect(view.getByText('Create the application')).toBeOnTheScreen()
  })

  it('says why when the server\'s shared credential serves another household', async () => {
    const { view } = await setup({ sharedUnavailable: true })
    expect(view.getByText(/covers one household only/)).toBeOnTheScreen()
  })

  describe('create the application', () => {
    it('creates the certificate, without a code until the server asks for one', async () => {
      const { view, props } = await setup({ initialStep: 'create_application' })
      expect(view.queryByLabelText('Authenticator code')).not.toBeOnTheScreen()
      // Nothing to register yet, so nothing to continue to.
      expect(view.queryByRole('button', { name: 'Continue' })).not.toBeOnTheScreen()
      await press(view, 'Create certificate')
      expect(props.onCreateCertificate).toHaveBeenCalledWith(undefined)
    })

    it('sends the authenticator code once two-factor asked for it, and clears the field', async () => {
      const { view, props } = await setup({ initialStep: 'create_application', askForCode: true, failure: { reason: 'totp-required', revisit: null } })
      expect(view.getByText('Enter your authenticator code to continue.')).toBeOnTheScreen()
      await fireEvent.changeText(view.getByLabelText('Authenticator code'), '123 456')
      await press(view, 'Create certificate')
      expect(props.onCreateCertificate).toHaveBeenCalledWith('123456')
      expect(view.getByLabelText('Authenticator code').props.value).toBe('')
    })

    it('offers both copying and sharing the certificate, and says which works best on a phone', async () => {
      const { view, props } = await setup({ initialStep: 'create_application', certificatePem: CERTIFICATE })
      await press(view, 'Copy certificate')
      expect(props.onCopy).toHaveBeenCalledWith(CERTIFICATE)
      expect(view.getByText('Copied.')).toBeOnTheScreen()
      await press(view, 'Share certificate')
      expect(props.onShareCertificate).toHaveBeenCalledTimes(1)
      expect(view.getByText(/On a phone, copying works best/)).toBeOnTheScreen()
    })

    it('says so when the share sheet does not open', async () => {
      const { view } = await setup({ initialStep: 'create_application', certificatePem: CERTIFICATE, onShareCertificate: jest.fn().mockResolvedValue(false) })
      await press(view, 'Share certificate')
      expect(view.getByText("Couldn't open the share sheet. Copy the certificate instead.")).toBeOnTheScreen()
    })

    it('puts Production in a warning and gives every Control Panel value a copy button', async () => {
      const { view, props } = await setup({ initialStep: 'create_application' })
      expect(view.getByText('Choose Production')).toBeOnTheScreen()
      for (const [label, value] of [
        ['Application name', 'WonderMoney'],
        ['Redirect URL', 'https://api.example.test/v1/banking/enable-banking/callback'],
        ['Privacy URL', 'https://docs.example.test/privacy'],
        ['Terms URL', 'https://docs.example.test/terms'],
      ]) {
        await press(view, `Copy ${label}`)
        expect(props.onCopy).toHaveBeenLastCalledWith(value)
      }
      await press(view, 'Copy Description')
      expect(props.onCopy).toHaveBeenCalledTimes(5)
      await press(view, 'Open Control Panel')
      expect(props.onOpenUrl).toHaveBeenCalledWith('https://enablebanking.com/cp/applications')
    })

    it('says when a value could not be copied', async () => {
      const { view } = await setup({ initialStep: 'create_application', onCopy: jest.fn().mockResolvedValue(false) })
      await press(view, 'Copy Redirect URL')
      expect(view.getByText("Couldn't copy. Press and hold the value to copy it instead.")).toBeOnTheScreen()
    })

    it('with a certificate already waiting, lets the person continue or replace it', async () => {
      const { view, props } = await setup({ initialStep: 'create_application', pendingExpiresAt: '2026-12-03T10:00:00.000Z' })
      expect(view.getByText(/A certificate is already waiting until/)).toBeOnTheScreen()
      expect(view.getByRole('button', { name: 'Continue' })).toBeOnTheScreen()
      await press(view, 'Create a new certificate')
      expect(props.onCreateCertificate).toHaveBeenCalledWith(undefined)
    })
  })

  it('tells the person to activate by linking accounts, not to request activation', async () => {
    const { view, props } = await setup({ initialStep: 'activate' })
    expect(view.getByText(/choose “Activate by linking accounts”/)).toBeOnTheScreen()
    expect(view.getByText(/Not “Request activation”/)).toBeOnTheScreen()
    await press(view, 'Open Control Panel')
    expect(props.onOpenUrl).toHaveBeenCalledWith('https://enablebanking.com/cp/applications')
  })

  describe('paste the application ID', () => {
    it('pastes from the clipboard and activates with the trimmed ID', async () => {
      const { view, props } = await setup({ initialStep: 'application_id', onReadClipboard: jest.fn().mockResolvedValue(' 6b1b3c2a-4e9d-4f2a-9c1b-1234567890ab\n') })
      expect(view.getByRole('button', { name: 'Activate' })).toBeDisabled()
      await press(view, 'Paste')
      expect(view.getByLabelText('Application ID').props.value).toBe('6b1b3c2a-4e9d-4f2a-9c1b-1234567890ab')
      await press(view, 'Activate')
      expect(props.onActivate).toHaveBeenCalledWith('6b1b3c2a-4e9d-4f2a-9c1b-1234567890ab', undefined)
    })

    it('says so when the clipboard has nothing to paste', async () => {
      const { view } = await setup({ initialStep: 'application_id' })
      await press(view, 'Paste')
      expect(view.getByText('The clipboard has no text to paste.')).toBeOnTheScreen()
    })

    it('shows until when the certificate waits', async () => {
      const { view } = await setup({ initialStep: 'application_id', pendingExpiresAt: '2026-12-03T10:00:00.000Z' })
      expect(view.getByText(/The certificate waits for its application ID until/)).toBeOnTheScreen()
    })
  })

  describe('errors', () => {
    it.each([
      ['application-not-found', "Enable Banking doesn't recognise this application ID with this certificate. Check the ID, and that you registered the application with this certificate.", 'Go to step 2: Create the application'],
      ['sandbox', "This is a Sandbox application, which can't reach a real bank. Register a new application with Environment set to Production.", 'Go to step 2: Create the application'],
      ['not-activated', "This application isn't activated yet. Choose “Activate by linking accounts” and link one of your own bank accounts, then try again.", 'Go to step 3: Activate by linking accounts'],
      ['refused', 'Enable Banking refused this key. Try again later, or register the application again.', 'Go to step 2: Create the application'],
      ['pending-missing', 'This certificate expired or was replaced. Create a new certificate and register it again.', 'Go to step 2: Create the application'],
    ] as const)('%s has its own message and leads back to the step to redo', async (reason, message, revisitLabel) => {
      const revisit = reason === 'not-activated' ? 'activate' : 'create_application'
      const { view } = await setup({ initialStep: 'application_id', failure: { reason, revisit } })
      expect(view.getByText(message)).toBeOnTheScreen()
      await press(view, revisitLabel)
      expect(view.getByTestId(`enable-banking-setup-${revisit}`)).toBeOnTheScreen()
    })

    it.each([
      ['totp-required', 'Enter your authenticator code to continue.'],
      ['invalid-totp', "That authenticator code isn't valid. Enter the current one."],
      ['rate-limited', 'Too many attempts. Wait a few minutes and try again.'],
      ['demo', 'This action is unavailable in demo mode.'],
      ['network', 'Check your connection and try again.'],
      ['unavailable', "Enable Banking or this server couldn't be reached. Try again in a moment."],
      ['general', 'Something went wrong. Please try again.'],
    ] as const)('%s is fixed on this step, with its own message', async (reason, message) => {
      const { view } = await setup({ initialStep: 'application_id', failure: { reason, revisit: null } })
      expect(view.getByText(message)).toBeOnTheScreen()
      expect(view.queryByRole('button', { name: /^Go to step/ })).not.toBeOnTheScreen()
    })

    it('offers to sign in again when the session is too old for this', async () => {
      const failure: EnableBankingSetupFailure = { reason: 'session-not-fresh', revisit: null }
      const { view, props } = await setup({ initialStep: 'create_application', failure })
      expect(view.getByText('For your security, sign in again before setting up your key.')).toBeOnTheScreen()
      await press(view, 'Sign in again')
      expect(props.onSignInAgain).toHaveBeenCalledTimes(1)
    })

    it('does not offer to go to the step the person is already on', async () => {
      const { view } = await setup({ initialStep: 'create_application', failure: { reason: 'sandbox', revisit: 'create_application' } })
      expect(view.queryByRole('button', { name: /^Go to step/ })).not.toBeOnTheScreen()
    })
  })
})
