import { render } from '@testing-library/react-native'

import { OnboardingRoute } from './onboarding-route'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn(() => false)
const mockAddListener = jest.fn(() => jest.fn())

jest.mock('expo-router', () => ({
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

jest.mock('./use-onboarding-bootstrap', () => ({
  useOnboardingBootstrap: () => mockLoadedBootstrap,
}))

jest.mock('./use-complete-onboarding', () => ({
  useCompleteOnboarding: () => ({ isPending: false, mutateAsync: jest.fn() }),
  classifyCompleteOnboardingFailure: jest.fn(),
}))

let capturedOnCreateAccount: (() => void) | undefined
jest.mock('./onboarding-screen', () => ({
  OnboardingScreen: (props: { onCreateAccount: () => void }) => {
    capturedOnCreateAccount = props.onCreateAccount
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

    capturedOnCreateAccount?.()

    expect(mockPush).toHaveBeenCalledWith('/onboarding/create-account?version=7')
    expect(mockPush).not.toHaveBeenCalledWith(expect.objectContaining({ params: expect.anything() }))
  })
})
