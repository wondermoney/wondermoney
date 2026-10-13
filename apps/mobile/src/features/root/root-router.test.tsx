import React from 'react'
import { render } from '@testing-library/react-native'

import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { RootRouter } from './root-router'

const mockUseProductRuntime = jest.fn()
const mockStackProps = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => mockUseProductRuntime(),
}))
jest.mock('expo-linking', () => ({
  useURL: () => null,
}))
jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  const Native = jest.requireActual<typeof import('react-native')>('react-native')
  const Stack = ({ children, ...props }: { children: React.ReactNode; screenOptions?: unknown }) => {
    mockStackProps(props)
    return ReactModule.createElement(Native.View, null, children)
  }
  Stack.Protected = function Protected({ guard, children }: { guard: boolean; children: React.ReactNode }) {
    return guard ? <>{children}</> : null
  }
  Stack.Screen = ({ name }: { name: string }) => ReactModule.createElement(Native.Text, null, name)
  const useRouter = () => ({ replace: jest.fn(), canGoBack: () => true, back: jest.fn(), push: jest.fn() })
  return { Stack, useRouter, usePathname: () => mockPathname() }
})
const mockPathname = jest.fn(() => '/sign-in')
jest.mock('@/lib/telemetry/analytics', () => ({
  ...jest.requireActual<typeof import('@/lib/telemetry/analytics')>('@/lib/telemetry/analytics'),
  captureAnalyticsEvent: jest.fn(),
}))

describe('RootRouter', () => {
  beforeEach(() => {
    mockStackProps.mockClear()
  })

  it('disables root headers and native route transitions', async () => {
    mockUseProductRuntime.mockReturnValue({ routeState: { status: 'signed-out' } })

    await render(<RootRouter />)

    expect(mockStackProps).toHaveBeenCalledWith({
      screenOptions: { headerShown: false, animation: 'none' },
    })
  })

  it.each([
    ['signed-out', 'sign-in'],
    ['authenticated', '(app)'],
    ['deactivating', '(app)'],
    ['mfa-required', 'access'],
    ['sign-out-failed', 'access'],
  ])('guards %s to %s without tabs', async (status, route) => {
    mockUseProductRuntime.mockReturnValue({ routeState: { status } })
    const view = await render(<RootRouter />)
    expect(view.getByText(route)).toBeOnTheScreen()
    expect(view.queryByText('(tabs)')).not.toBeOnTheScreen()
  })

  it('registers sign-up in the signed-out branch', async () => {
    mockUseProductRuntime.mockReturnValue({ routeState: { status: 'signed-out' }, activationError: null })
    const view = await render(<RootRouter />)
    expect(view.getByText('sign-up')).toBeOnTheScreen()
  })

  it('registers forgot-password and reset-password in the signed-out branch', async () => {
    mockUseProductRuntime.mockReturnValue({ routeState: { status: 'signed-out' }, activationError: null })
    const view = await render(<RootRouter />)
    expect(view.getByText('forgot-password')).toBeOnTheScreen()
    expect(view.getByText('reset-password')).toBeOnTheScreen()
  })

  it('observes screen views above every route guard, for the signed-out tree too (RAD-518)', async () => {
    jest.mocked(captureAnalyticsEvent).mockClear()
    mockPathname.mockReturnValue('/sign-up')
    mockUseProductRuntime.mockReturnValue({ routeState: { status: 'signed-out' } })

    await render(<RootRouter />)

    expect(jest.mocked(captureAnalyticsEvent)).toHaveBeenCalledWith('feature_screen_viewed', { screen: 'sign_up' })
  })
})
