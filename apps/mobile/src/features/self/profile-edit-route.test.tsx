import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { ProfileEditRoute } from './profile-edit-route'

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn()
const mockAddListener = jest.fn(() => () => {})
const mockProfile = jest.fn()
const mockMutateAsync = jest.fn()
let mockPending = false

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
  useNavigation: () => ({ addListener: mockAddListener }),
}))
jest.mock('./use-self-resource', () => ({ useProfile: () => mockProfile() }))
jest.mock('./use-update-profile', () => {
  const actual = jest.requireActual('./use-update-profile')
  return { ...actual, useUpdateProfile: () => ({ mutateAsync: mockMutateAsync, isPending: mockPending }) }
})

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><ProfileEditRoute /></I18nextProvider>)
}

const loaded = { data: { profile: { emailAddress: 'a@b.com', firstName: 'Ada', lastName: 'Lovelace', mfaEnabled: false } }, isLoading: false }

describe('ProfileEditRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset(); mockBack.mockReset(); mockCanGoBack.mockReset()
    mockProfile.mockReset(); mockMutateAsync.mockReset(); mockPending = false
    mockCanGoBack.mockReturnValue(true)
  })

  it('shows a skeleton until the profile is available', async () => {
    mockProfile.mockReturnValue({ data: undefined, isLoading: true })
    const view = await renderRoute()
    expect(view.getByLabelText('Loading your profile')).toBeOnTheScreen()
  })

  it('prefills from the loaded profile and returns to the profile after a saved change', async () => {
    mockProfile.mockReturnValue(loaded)
    mockMutateAsync.mockResolvedValue(undefined)
    const view = await renderRoute()
    await fireEvent.changeText(view.getByLabelText('First name'), 'Grace')
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({ firstName: 'Grace', lastName: 'Lovelace' }))
    expect(mockBack).toHaveBeenCalledTimes(1)
  })

  it('keeps the editor open with a specific error when the save is not confirmed', async () => {
    mockProfile.mockReturnValue(loaded)
    mockMutateAsync.mockRejectedValue(new ApiError('network'))
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(view.getByRole('alert')).toBeOnTheScreen())
    expect(mockBack).not.toHaveBeenCalled()
    expect(view.getByText(/could not be confirmed/i)).toBeOnTheScreen()
  })

  it('registers a guard against leaving mid-save', async () => {
    mockProfile.mockReturnValue(loaded)
    await renderRoute()
    expect(mockAddListener).toHaveBeenCalledWith('beforeRemove', expect.any(Function))
  })
})
