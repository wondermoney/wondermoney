import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ProfileRoute } from './profile-route'

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn()
const mockProfile = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
}))
jest.mock('./use-self-resource', () => ({
  useProfile: () => mockProfile(),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signOut: jest.fn() }),
}))

describe('self route adapters', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockBack.mockReset()
    mockCanGoBack.mockReset()
    mockProfile.mockReset()
  })

  it.each([
    [ProfileRoute, mockProfile],
  ] as const)('uses native back for pushed self routes', async (Route, hook) => {
    mockCanGoBack.mockReturnValue(true)
    hook.mockReturnValue({ isLoading: true, refetch: jest.fn() })
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><Route /></I18nextProvider>)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it.each([
    [ProfileRoute, mockProfile],
  ] as const)('falls back safely to More without route history', async (Route, hook) => {
    mockCanGoBack.mockReturnValue(false)
    hook.mockReturnValue({ isLoading: true, refetch: jest.fn() })
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><Route /></I18nextProvider>)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockBack).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith('/more')
  })
})
