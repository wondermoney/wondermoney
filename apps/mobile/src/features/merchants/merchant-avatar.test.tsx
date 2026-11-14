import { act, fireEvent, render } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native'

import { ServerSwitchProvider } from '@/components/providers/server-switch-provider'
import { merchantAvatarColors } from '@/theme/tokens'

import { MerchantAvatar } from './merchant-avatar'
import { merchantColorIndex } from './merchant-avatar-model'

const mockImageAuthorization = jest.fn<Promise<string | null>, []>()
let mockRuntime: { imageAuthorization?: () => Promise<string | null> } | null = null
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useOptionalProductRuntime: () => (mockRuntime ? { runtime: mockRuntime } : null),
}))

const API = 'https://api.example.test'
const PROXY_LOGO = `${API}/v1/account/transaction-merchants/12/logo`
const THIRD_PARTY_LOGO = 'https://logos.example.org/starbucks.png'

// The avatar is decorative (hidden from screen readers), so queries have to look at hidden elements.
const hidden = { includeHiddenElements: true }
/** expo-image hands its native view the source as a list. */
const sourceOf = (node: { props: { source?: unknown } }) => [node.props.source].flat()[0]
const style = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>

function OnServer({ children }: { children: ReactNode }) {
  return <ServerSwitchProvider value={{ apiBaseUrl: API, usesDefaultServer: true, switchServer: jest.fn() }}>{children}</ServerSwitchProvider>
}

const renderAvatar = (props: React.ComponentProps<typeof MerchantAvatar>) => render(<OnServer><MerchantAvatar testID="avatar" {...props} /></OnServer>)

beforeEach(() => {
  mockImageAuthorization.mockReset().mockResolvedValue('Bearer session-token')
  mockRuntime = { imageAuthorization: mockImageAuthorization }
})

describe('MerchantAvatar', () => {
  it("shows the initial on the merchant's own colour when there is no logo, and makes no image request", async () => {
    const view = await renderAvatar({ name: 'starbucks', resolvedLogoUrl: null })
    const colors = merchantAvatarColors.light[merchantColorIndex('starbucks')]!
    expect(view.getByText('S', hidden)).toBeOnTheScreen()
    expect(style(view.getByText('S', hidden))).toMatchObject({ color: colors.foreground })
    expect(style(view.getByTestId('avatar', hidden))).toMatchObject({ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.background })
    expect(view.queryByTestId('avatar-image', hidden)).toBeNull()
    expect(mockImageAuthorization).not.toHaveBeenCalled()
  })

  it('loads a third-party logo with no Authorization header and never reads the session', async () => {
    const view = await renderAvatar({ name: 'Starbucks', resolvedLogoUrl: THIRD_PARTY_LOGO })
    const image = view.getByTestId('avatar-image', hidden)
    expect(sourceOf(image)).toEqual({ uri: THIRD_PARTY_LOGO })
    expect(image.props.recyclingKey).toBe(THIRD_PARTY_LOGO)
    expect(mockImageAuthorization).not.toHaveBeenCalled()
  })

  it("attaches the bearer token to a logo on the API's own origin", async () => {
    const view = await renderAvatar({ name: 'Starbucks', resolvedLogoUrl: PROXY_LOGO })
    const image = await view.findByTestId('avatar-image', hidden)
    expect(sourceOf(image)).toEqual({ uri: PROXY_LOGO, headers: { Authorization: 'Bearer session-token' } })
  })

  it('treats a look-alike host or another port as third-party', async () => {
    for (const uri of ['https://api.example.test.evil.example/logo.png', 'https://api.example.test:8443/v1/logo', 'http://api.example.test/v1/logo']) {
      const view = await renderAvatar({ name: 'Starbucks', resolvedLogoUrl: uri })
      expect(sourceOf(view.getByTestId('avatar-image', hidden))).toEqual({ uri })
      await view.unmount()
    }
    expect(mockImageAuthorization).not.toHaveBeenCalled()
  })

  it('shows the initial instead of requesting an API logo when there is no session', async () => {
    mockImageAuthorization.mockResolvedValue(null)
    const view = await renderAvatar({ name: 'Starbucks', resolvedLogoUrl: PROXY_LOGO })
    await act(async () => { await Promise.resolve() })
    expect(view.queryByTestId('avatar-image', hidden)).toBeNull()
    expect(view.getByText('S', hidden)).toBeOnTheScreen()

    mockRuntime = null
    const signedOut = await renderAvatar({ name: 'Starbucks', resolvedLogoUrl: PROXY_LOGO })
    expect(signedOut.queryByTestId('avatar-image', hidden)).toBeNull()
  })

  it('falls back to the initial when the logo fails to load, and tries again for a new URL', async () => {
    const view = await renderAvatar({ name: 'Café Nero', resolvedLogoUrl: THIRD_PARTY_LOGO })
    await fireEvent(view.getByTestId('avatar-image', hidden), 'error', { nativeEvent: { error: 'failed' } })
    expect(view.queryByTestId('avatar-image', hidden)).toBeNull()
    expect(view.getByText('C', hidden)).toBeOnTheScreen()

    const next = 'https://logos.example.org/cafe-nero.png'
    await view.rerender(<OnServer><MerchantAvatar name="Café Nero" resolvedLogoUrl={next} testID="avatar" /></OnServer>)
    expect(sourceOf(view.getByTestId('avatar-image', hidden))).toEqual({ uri: next })
  })

  it('ignores a logo that is not an http(s) URL', async () => {
    const view = await renderAvatar({ name: 'Starbucks', resolvedLogoUrl: 'javascript:alert(1)' })
    expect(view.queryByTestId('avatar-image', hidden)).toBeNull()
    expect(view.getByText('S', hidden)).toBeOnTheScreen()
  })

  it('is decorative and takes no touches: hidden from screen readers', async () => {
    const view = await renderAvatar({ name: 'Starbucks' })
    const avatar = view.getByTestId('avatar', hidden)
    expect(avatar.props.accessible).toBe(false)
    expect(avatar.props.importantForAccessibility).toBe('no-hide-descendants')
    expect(avatar.props.pointerEvents).toBe('none')
  })
})
