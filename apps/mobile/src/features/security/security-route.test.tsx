import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { SecurityRoute } from './security-route'

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn()
const mockAddListener = jest.fn(() => () => {})
const mockSignOut = jest.fn()
const mockMutateAsync = jest.fn()
let mockPending = false

const mockFactorStatusRefetch = jest.fn()
let mockFactorStatus: {
  isLoading: boolean
  isError: boolean
  data?: { hasVerifiedFactor: boolean; verifiedFactorId: string | null }
} = { isLoading: false, isError: false, data: { hasVerifiedFactor: false, verifiedFactorId: null } }
const mockStartMutate = jest.fn()
const mockStartReset = jest.fn()
let mockStart: { isPending: boolean; data?: { status: string; factorId?: string; totp?: { secret: string; uri: string } } } = { isPending: false }
const mockConfirmMutateAsync = jest.fn()
const mockConfirmReset = jest.fn()
let mockConfirm: { isPending: boolean; data?: { status: string } } = { isPending: false }
const mockUnenrollMutate = jest.fn()
let mockUnenroll: { isPending: boolean; data?: { status: string } } = { isPending: false }

const mockChangePasswordMutateAsync = jest.fn()
let mockChangePassword: { isPending: boolean; data?: { status: string } } = { isPending: false }
let mockProfile: { data?: { profile: { emailAddress: string } } } = { data: { profile: { emailAddress: 'person@example.com' } } }

const mockAppLockSetEnabled = jest.fn()
let mockAppLock: { isLoaded: boolean; enabled: boolean } = { isLoaded: true, enabled: false }

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
  useNavigation: () => ({ addListener: mockAddListener }),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signOut: mockSignOut }),
}))
jest.mock('./use-delete-account', () => {
  const actual = jest.requireActual('./use-delete-account')
  return {
    ...actual,
    useDeleteAccount: () => ({ mutateAsync: mockMutateAsync, isPending: mockPending }),
  }
})
jest.mock('./use-mfa-factor-status', () => ({
  useMfaFactorStatus: () => ({ ...mockFactorStatus, refetch: mockFactorStatusRefetch }),
}))
jest.mock('./use-mfa-enrollment', () => ({
  useMfaEnrollment: () => ({
    start: { ...mockStart, mutate: mockStartMutate, reset: mockStartReset },
    confirm: { ...mockConfirm, mutateAsync: mockConfirmMutateAsync, reset: mockConfirmReset },
  }),
}))
jest.mock('./use-mfa-unenroll', () => ({
  useMfaUnenroll: () => ({ ...mockUnenroll, mutate: mockUnenrollMutate }),
}))
jest.mock('./use-change-password', () => ({
  useChangePassword: () => ({ ...mockChangePassword, mutateAsync: mockChangePasswordMutateAsync }),
}))
jest.mock('@/features/self/use-self-resource', () => ({
  useProfile: () => mockProfile,
}))
jest.mock('@/components/providers/app-lock-provider', () => ({
  useAppLock: () => ({ ...mockAppLock, setEnabled: mockAppLockSetEnabled }),
}))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><SecurityRoute /></I18nextProvider>)
}

const acknowledgeAndDelete = async (view: Awaited<ReturnType<typeof renderRoute>>) => {
  await fireEvent.press(view.getByRole('checkbox'))
  await fireEvent.press(view.getByRole('button', { name: 'Delete account permanently' }))
}

describe('SecurityRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset(); mockBack.mockReset(); mockCanGoBack.mockReset()
    mockSignOut.mockReset(); mockMutateAsync.mockReset(); mockPending = false
    mockFactorStatusRefetch.mockReset()
    mockFactorStatus = { isLoading: false, isError: false, data: { hasVerifiedFactor: false, verifiedFactorId: null } }
    mockStartMutate.mockReset(); mockStartReset.mockReset()
    mockStart = { isPending: false }
    mockConfirmMutateAsync.mockReset(); mockConfirmReset.mockReset()
    mockConfirm = { isPending: false }
    mockUnenrollMutate.mockReset()
    mockUnenroll = { isPending: false }
    mockChangePasswordMutateAsync.mockReset()
    mockChangePassword = { isPending: false }
    mockProfile = { data: { profile: { emailAddress: 'person@example.com' } } }
    mockAppLockSetEnabled.mockReset()
    mockAppLock = { isLoaded: true, enabled: false }
  })

  it('retires the local session by signing out only after a confirmed deletion', async () => {
    mockMutateAsync.mockResolvedValue(undefined)
    const view = await renderRoute()
    await acknowledgeAndDelete(view)
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1))
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(view.queryByRole('alert')).not.toBeOnTheScreen()
  })

  it('keeps the user signed in and shows a specific failure when deletion is not confirmed', async () => {
    mockMutateAsync.mockRejectedValue(new ApiError('network'))
    const view = await renderRoute()
    await acknowledgeAndDelete(view)
    await waitFor(() => expect(view.getByRole('alert')).toBeOnTheScreen())
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(view.getByText(/could not confirm your account was deleted/i)).toBeOnTheScreen()
  })

  it('uses native back when history exists and falls back to More otherwise', async () => {
    mockCanGoBack.mockReturnValue(true)
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Back to More' }))
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()

    mockCanGoBack.mockReturnValue(false)
    const view2 = await renderRoute()
    await fireEvent.press(view2.getByRole('button', { name: 'Back to More' }))
    expect(mockReplace).toHaveBeenCalledWith('/more')
  })

  it('registers a guard that prevents leaving while a deletion is in flight', async () => {
    await renderRoute()
    expect(mockAddListener).toHaveBeenCalledWith('beforeRemove', expect.any(Function))
  })

  describe('two-factor authentication wiring', () => {
    it('starts enrollment on request and shows the returned secret', async () => {
      const view = await renderRoute()
      await fireEvent.press(view.getByRole('button', { name: 'Turn on two-factor authentication' }))
      expect(mockStartMutate).toHaveBeenCalledTimes(1)

      mockStart = {
        isPending: false,
        data: { status: 'enrolled', factorId: 'factor-1', totp: { secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' } },
      }
      const view2 = await renderRoute()
      expect(view2.getByText('JBSWY3DPEHPK3PXP')).toBeOnTheScreen()
    })

    it('confirms with the typed code and resets to the enabled state on success', async () => {
      mockStart = {
        isPending: false,
        data: { status: 'enrolled', factorId: 'factor-1', totp: { secret: 'secret', uri: 'uri' } },
      }
      mockConfirmMutateAsync.mockResolvedValue({ status: 'verified' })
      const view = await renderRoute()
      await fireEvent.changeText(view.getByLabelText('6-digit code'), '123456')
      await fireEvent.press(view.getByRole('button', { name: 'Confirm code' }))
      await waitFor(() => expect(mockConfirmMutateAsync).toHaveBeenCalledWith('123456'))
      expect(mockStartReset).toHaveBeenCalledTimes(1)
    })

    it('keeps the pending factor and surfaces an invalid code without resetting', async () => {
      mockStart = {
        isPending: false,
        data: { status: 'enrolled', factorId: 'factor-1', totp: { secret: 'secret', uri: 'uri' } },
      }
      mockConfirmMutateAsync.mockResolvedValue({ status: 'invalid-code' })
      const view = await renderRoute()
      await fireEvent.changeText(view.getByLabelText('6-digit code'), '000000')
      await fireEvent.press(view.getByRole('button', { name: 'Confirm code' }))
      await waitFor(() => expect(mockConfirmMutateAsync).toHaveBeenCalledWith('000000'))
      expect(mockStartReset).not.toHaveBeenCalled()
    })

    it('resets both enrollment mutations on cancel', async () => {
      mockStart = {
        isPending: false,
        data: { status: 'enrolled', factorId: 'factor-1', totp: { secret: 'secret', uri: 'uri' } },
      }
      const view = await renderRoute()
      await fireEvent.press(view.getByRole('button', { name: 'Cancel setup' }))
      expect(mockStartReset).toHaveBeenCalledTimes(1)
      expect(mockConfirmReset).toHaveBeenCalledTimes(1)
    })

    it('turns off using the verified factor id', async () => {
      mockFactorStatus = { isLoading: false, isError: false, data: { hasVerifiedFactor: true, verifiedFactorId: 'factor-9' } }
      const view = await renderRoute()
      await fireEvent.press(view.getByRole('button', { name: 'Turn off two-factor authentication' }))
      expect(mockUnenrollMutate).toHaveBeenCalledWith('factor-9')
    })

    it('retries the factor status check on request', async () => {
      mockFactorStatus = { isLoading: false, isError: true }
      const view = await renderRoute()
      await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
      expect(mockFactorStatusRefetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('password change wiring', () => {
    const fillAndSubmit = async (view: Awaited<ReturnType<typeof renderRoute>>) => {
      await fireEvent.changeText(view.getByLabelText('Current password'), 'oldpassword')
      await fireEvent.changeText(view.getByLabelText('New password'), 'newpassword123')
      await fireEvent.changeText(view.getByLabelText('Repeat new password'), 'newpassword123')
      await fireEvent.press(view.getByRole('button', { name: 'Save new password' }))
    }

    it('submits with the profile email and shows a success message once updated', async () => {
      mockChangePasswordMutateAsync.mockResolvedValue({ status: 'updated' })
      const view = await renderRoute()
      await fillAndSubmit(view)
      await waitFor(() => expect(mockChangePasswordMutateAsync).toHaveBeenCalledWith({
        email: 'person@example.com',
        currentPassword: 'oldpassword',
        newPassword: 'newpassword123',
      }))
      expect(view.getByText('Your password has been updated.')).toBeOnTheScreen()
    })

    it('surfaces an invalid-current-password failure without a success message', async () => {
      mockChangePasswordMutateAsync.mockResolvedValue({ status: 'invalid-current-password' })
      mockChangePassword = { isPending: false, data: { status: 'invalid-current-password' } }
      const view = await renderRoute()
      await fillAndSubmit(view)
      await waitFor(() => expect(mockChangePasswordMutateAsync).toHaveBeenCalledTimes(1))
      expect(view.getByRole('alert')).toHaveTextContent(/current password/i)
      expect(view.queryByText('Your password has been updated.')).not.toBeOnTheScreen()
    })

    it('does not submit when the profile email has not loaded yet', async () => {
      mockProfile = { data: undefined }
      const view = await renderRoute()
      await fillAndSubmit(view)
      expect(mockChangePasswordMutateAsync).not.toHaveBeenCalled()
    })
  })

  describe('app lock wiring', () => {
    it('confirms with a device prompt before turning on', async () => {
      mockAppLockSetEnabled.mockResolvedValue({ status: 'enabled' })
      const view = await renderRoute()
      await fireEvent.press(view.getByRole('button', { name: 'Turn on app lock' }))
      expect(mockAppLockSetEnabled).toHaveBeenCalledWith(true, 'Confirm to turn on app lock')
    })

    it('surfaces an unavailable failure using the reported capability', async () => {
      mockAppLockSetEnabled.mockResolvedValue({ status: 'unavailable', capability: 'not-enrolled' })
      const view = await renderRoute()
      await fireEvent.press(view.getByRole('button', { name: 'Turn on app lock' }))
      await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent(/set up face id/i))
    })

    it('turns off without requiring a device prompt confirmation from the caller', async () => {
      mockAppLock = { isLoaded: true, enabled: true }
      mockAppLockSetEnabled.mockResolvedValue({ status: 'disabled' })
      const view = await renderRoute()
      await fireEvent.press(view.getByRole('button', { name: 'Turn off app lock' }))
      expect(mockAppLockSetEnabled).toHaveBeenCalledWith(false, 'Confirm to turn on app lock')
    })
  })
})
