import React from 'react'
import { render } from '@testing-library/react-native'

import OnboardingLayout from './_layout'

const mockStackProps = jest.fn()
const mockScreenNames: string[] = []

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  const Native = jest.requireActual<typeof import('react-native')>('react-native')
  const Stack = ({ children, ...props }: { children: React.ReactNode; screenOptions?: unknown }) => {
    mockStackProps(props)
    return ReactModule.createElement(Native.View, null, children)
  }
  const MockStackScreen = ({ name }: { name: string }) => {
    mockScreenNames.push(name)
    return null
  }
  MockStackScreen.displayName = 'MockStackScreen'
  Stack.Screen = MockStackScreen
  return { Stack }
})

describe('OnboardingLayout', () => {
  beforeEach(() => {
    mockStackProps.mockClear()
    mockScreenNames.length = 0
  })

  // Without an explicit layout, Expo Router has no declared initial route
  // for the implicit stack behind root-router.tsx's bare
  // `Stack.Screen name="onboarding"` entry, and every sign-in lands on
  // create-account (which sorts before index alphabetically) with no params,
  // instead of the onboarding journey.
  it('declares index before create-account so it is unambiguously the initial route', async () => {
    await render(<OnboardingLayout />)
    expect(mockScreenNames).toEqual(['index', 'create-account'])
  })

  it('disables the header and native transition, matching the rest of the app', async () => {
    await render(<OnboardingLayout />)
    expect(mockStackProps).toHaveBeenCalledWith({
      screenOptions: { headerShown: false, animation: 'none' },
    })
  })
})
