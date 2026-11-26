import { render } from '@testing-library/react-native'

import { OnboardingRoute } from './onboarding-route'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn(() => false)
const mockAddListener = jest.fn(() => jest.fn())

let mockSearchParams: { resume?: string } = {}
let mockFileStorage = true
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
  useNavigation: () => ({ addListener: mockAddListener }),
}))

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 5 } }),
}))

const makeBootstrap = (onboarding: Record<string, unknown>) => ({
  data: {
    onboarding: {
      completed: false,
      completedVersion: null,
      required: true,
      skippable: true,
      steps: [],
      supportedActions: ['create_manual_account'],
      version: 7,
      ...onboarding,
    },
  },
  isAccessTransition: false,
  isInitialFailure: false,
  isNotFound: false,
  refetch: jest.fn(),
})

let mockLoadedBootstrap = makeBootstrap({})

jest.mock('@/lib/server/use-instance', () => ({
  useConfirmedFeature: (select: (features: { fileStorage: boolean }) => boolean) => select({ fileStorage: mockFileStorage }),
}))

jest.mock('./use-onboarding-bootstrap', () => ({
  useOnboardingBootstrap: () => mockLoadedBootstrap,
}))

const mockCompleteOnboarding = jest.fn()
jest.mock('./use-complete-onboarding', () => ({
  useCompleteOnboarding: () => ({ isPending: false, mutateAsync: mockCompleteOnboarding, reset: jest.fn() }),
  classifyCompleteOnboardingFailure: jest.fn(),
}))

let mockHasWritableAccount = false
jest.mock('./use-has-writable-account', () => ({
  useHasWritableAccount: () => mockHasWritableAccount,
}))

let capturedOnCreateAccount: ((from: 'account' | 'no-bank') => void) | undefined
let capturedOnImportStatement: (() => void | Promise<void>) | undefined
let capturedScreen: { resumeAt?: string; importAvailable?: boolean } = {}
jest.mock('./onboarding-screen', () => ({
  OnboardingScreen: (props: { onCreateAccount: (from: 'account' | 'no-bank') => void; onImportStatement: () => void | Promise<void>; resumeAt?: string; importAvailable?: boolean }) => {
    capturedOnCreateAccount = props.onCreateAccount
    capturedOnImportStatement = props.onImportStatement
    capturedScreen = { resumeAt: props.resumeAt, importAvailable: props.importAvailable }
    return null
  },
}))

describe('OnboardingRoute — leaving a journey the user no longer needs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadedBootstrap = makeBootstrap({})
    capturedOnCreateAccount = undefined
  })

  it('replaces with the app root when there is nothing to go back to', async () => {
    mockLoadedBootstrap = makeBootstrap({ completed: true, required: false })
    mockCanGoBack.mockReturnValue(false)

    await render(<OnboardingRoute />)

    expect(mockReplace).toHaveBeenCalledWith('/')
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('goes back when there is history, and navigates only once', async () => {
    mockLoadedBootstrap = makeBootstrap({ completed: true, required: false })
    mockCanGoBack.mockReturnValue(true)

    await render(<OnboardingRoute />)

    // The old code navigated from the render body, so a component that
    // re-rendered while still resolving to "leave" fired again each time. The
    // `hasLeft` ref is what prevents that; asserting the repeat case directly
    // needs `rerender()`, which on a component that returns null leaves RNTL's
    // shared root in a state where later `render()` calls silently no-op and
    // every subsequent test in the file fails.
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  // If the redirect ran in the render body and fell through to render the
  // journey, a user who did not need onboarding would get a frame of it while
  // navigating away. This assertion catches that.
  //
  // The error React logs for that ("cannot update a component while
  // rendering a different component") cannot be reproduced here: the router is
  // mocked with plain jest.fn()s, so calling `replace` updates no real state
  // and React has nothing to complain about. That half only shows against the
  // real expo-router store, on device.
  it('renders nothing while leaving, rather than flashing the journey', async () => {
    mockLoadedBootstrap = makeBootstrap({ completed: true, required: false })

    await render(<OnboardingRoute />)

    expect(capturedOnCreateAccount).toBeUndefined()
  })

  it('stays put and renders the journey for a user who still needs it', async () => {
    mockCanGoBack.mockReturnValue(true)

    await render(<OnboardingRoute />)

    expect(mockBack).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
    expect(capturedOnCreateAccount).toBeDefined()
  })
})

describe('OnboardingRoute — create-account navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadedBootstrap = makeBootstrap({})
    capturedOnCreateAccount = undefined
  })

  // router.push({ pathname, params }) (the object form) fails to deliver
  // `version` to the create-account screen in production builds —
  // useLocalSearchParams sees an empty {} there, landing on the
  // invalid-version fallback on every sign-in. This asserts the query-string
  // form used instead.
  it('pushes create-account as an explicit query string carrying the loaded version', async () => {
    await render(<OnboardingRoute />)
    expect(capturedOnCreateAccount).toBeDefined()

    capturedOnCreateAccount?.('account')

    expect(mockPush).toHaveBeenCalledWith('/onboarding/create-account?version=7&from=account')
    expect(mockPush).not.toHaveBeenCalledWith(expect.objectContaining({ params: expect.anything() }))
  })

  it('importing a statement takes the same screen first, then on to the import', async () => {
    await render(<OnboardingRoute />)

    await capturedOnImportStatement?.()

    expect(mockPush).toHaveBeenCalledWith('/onboarding/create-account?version=7&then=import&from=no-bank')
    expect(mockCompleteOnboarding).not.toHaveBeenCalled()
  })

  it('imports into an account the person can already write to, completing onboarding, instead of creating one', async () => {
    mockHasWritableAccount = true
    mockCompleteOnboarding.mockResolvedValueOnce({})
    await render(<OnboardingRoute />)

    await capturedOnImportStatement?.()

    expect(mockCompleteOnboarding).toHaveBeenCalledWith({ version: 7 })
    expect(mockReplace).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith('/accounts/transactions/import')
    expect(mockPush).not.toHaveBeenCalled()
    mockHasWritableAccount = false
  })

  it('still opens the import on an existing account when completing onboarding fails', async () => {
    mockHasWritableAccount = true
    mockCompleteOnboarding.mockRejectedValueOnce(new Error('network'))
    await render(<OnboardingRoute />)

    await capturedOnImportStatement?.()

    expect(mockReplace).toHaveBeenCalledWith('/accounts/transactions/import')
    expect(mockPush).not.toHaveBeenCalled()
    mockHasWritableAccount = false
  })

  it('reopens the journey where the manual-account screen was opened from', async () => {
    mockSearchParams = { resume: 'no-bank' }
    await render(<OnboardingRoute />)
    expect(capturedScreen.resumeAt).toBe('no-bank')
    mockSearchParams = {}
  })

  it('offers the import only where the server stores files', async () => {
    mockFileStorage = false
    await render(<OnboardingRoute />)
    expect(capturedScreen.importAvailable).toBe(false)
    mockFileStorage = true
  })
})
