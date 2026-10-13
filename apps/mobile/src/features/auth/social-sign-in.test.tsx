import { act, render } from '@testing-library/react-native'

import { themeTokens } from '@/theme/tokens'

import { SocialSignIn } from './social-sign-in'

const mockSubmit = jest.fn()
let capturedProps: Record<string, unknown> | null = null

jest.mock('./use-social-sign-in', () => ({
  useSocialSignIn: () => ({
    available: ['apple', 'google'],
    pending: null,
    failure: null,
    submit: mockSubmit,
  }),
}))

jest.mock('./social-sign-in-buttons', () => ({
  SocialSignInButtons: (props: Record<string, unknown>) => {
    capturedProps = props
    return null
  },
}))

describe('SocialSignIn', () => {
  beforeEach(() => {
    mockSubmit.mockReset()
    capturedProps = null
  })

  it('hands the available providers and the resolved palette to the buttons', async () => {
    await render(<SocialSignIn />)

    expect(capturedProps?.providers).toEqual(['apple', 'google'])
    expect(capturedProps?.scheme).toBe('light')
    expect(capturedProps?.palette).toBe(themeTokens.colors.light)
  })

  it('runs the caller hook before opening the native sheet', async () => {
    const onBeforeSignIn = jest.fn()
    await render(<SocialSignIn onBeforeSignIn={onBeforeSignIn} />)

    await act(async () => (capturedProps?.onPress as (provider: string) => void)('apple'))

    expect(onBeforeSignIn).toHaveBeenCalledTimes(1)
    expect(mockSubmit).toHaveBeenCalledWith('apple')
    expect(onBeforeSignIn.mock.invocationCallOrder[0]).toBeLessThan(mockSubmit.mock.invocationCallOrder[0])
  })
})
