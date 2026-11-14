import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { PasskeySignIn } from './passkey-sign-in'

const mockSignInWithPasskey = jest.fn()
let mockAvailable = true

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signInWithPasskey: mockSignInWithPasskey }),
}))
jest.mock('@/lib/server/use-instance', () => ({
  usePasskeyAvailable: () => mockAvailable,
}))

async function renderButton() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><PasskeySignIn /></I18nextProvider>)
}

describe('PasskeySignIn', () => {
  beforeEach(() => {
    mockAvailable = true
    mockSignInWithPasskey.mockReset()
  })

  it('is hidden where the phone would not hand the app this server\'s passkeys', async () => {
    mockAvailable = false
    const view = await renderButton()
    expect(view.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull()
  })

  it('signs in with a passkey and shows nothing more when the session is accepted', async () => {
    mockSignInWithPasskey.mockResolvedValue({ status: 'accepted' })
    const view = await renderButton()

    await fireEvent.press(view.getByRole('button', { name: 'Sign in with a passkey' }))

    await waitFor(() => expect(mockSignInWithPasskey).toHaveBeenCalledTimes(1))
    expect(view.queryByRole('alert')).toBeNull()
  })

  it('says nothing when the person closes the passkey prompt', async () => {
    mockSignInWithPasskey.mockResolvedValue({ status: 'cancelled' })
    const view = await renderButton()

    await fireEvent.press(view.getByRole('button', { name: 'Sign in with a passkey' }))

    await waitFor(() => expect(view.getByRole('button', { name: 'Sign in with a passkey' })).toBeEnabled())
    expect(view.queryByRole('alert')).toBeNull()
  })

  it('points to the password when the passkey sign-in fails', async () => {
    mockSignInWithPasskey.mockResolvedValue({ status: 'unavailable' })
    const view = await renderButton()

    await fireEvent.press(view.getByRole('button', { name: 'Sign in with a passkey' }))

    expect(await view.findByRole('alert')).toHaveTextContent("Signing in with that passkey didn't work. Try again, or use your password.")
  })
})
