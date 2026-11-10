import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { themeTokens } from '@/theme/tokens'

import { accountMark, assetMark, EntityMark, markInitials, portfolioMark } from './entity-mark'

const palette = themeTokens.colors.light
// The mark is decorative (hidden from screen readers), so queries have to look at hidden elements.
const hidden = { includeHiddenElements: true }
const style = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>

describe('EntityMark', () => {
  it('draws a logo on a forced white backing with a hairline, whatever the theme', async () => {
    const view = await render(<EntityMark image="https://cdn.example/aapl.png" initials="AAPL" testID="mark" />)
    const mark = view.getByTestId('mark', hidden)
    expect(style(mark)).toMatchObject({ width: 36, height: 36, backgroundColor: '#ffffff', borderColor: palette.border, borderRadius: themeTokens.radius.md })
    expect(view.getByTestId('mark-image', hidden)).toBeOnTheScreen()
  })

  it('falls back to the first two letters, in mono on the muted surface, when the logo fails to load', async () => {
    const view = await render(<EntityMark image="https://cdn.example/broken.png" initials="AAPL" testID="mark" />)
    await fireEvent(view.getByTestId('mark-image', hidden), 'error', { nativeEvent: { error: 'failed' } })
    expect(view.queryByTestId('mark-image', hidden)).toBeNull()
    expect(view.getByText('AA', hidden)).toBeOnTheScreen()
    expect(style(view.getByTestId('mark', hidden))).toMatchObject({ backgroundColor: palette.muted })
  })

  it('treats a missing or non-http logo as missing', async () => {
    const view = await render(<EntityMark image="javascript:alert(1)" initials="Caixa Geral" testID="mark" />)
    expect(view.queryByTestId('mark-image', hidden)).toBeNull()
    expect(view.getByText('CG', hidden)).toBeOnTheScreen()
  })

  it("puts a category's icon on the category's own colours, and a readable ink when only the background is set", async () => {
    const coloured = await render(<EntityMark icon={{ name: 'coffee', bgColor: '#FEE2E2', textColor: '#991B1B' }} testID="mark" />)
    expect(style(coloured.getByTestId('mark', hidden))).toMatchObject({ backgroundColor: '#FEE2E2' })
    const dark = await render(<EntityMark icon={{ name: 'coffee', bgColor: '#111111' }} testID="dark" />)
    expect(style(dark.getByTestId('dark', hidden))).toMatchObject({ backgroundColor: '#111111' })
    const unsafe = await render(<EntityMark icon={{ name: 'coffee', bgColor: 'red; drop' }} testID="unsafe" />)
    expect(style(unsafe.getByTestId('unsafe', hidden))).toMatchObject({ backgroundColor: palette.muted })
  })

  it('is 24pt at sm, and decorative: hidden from screen readers', async () => {
    const view = await render(<EntityMark glyph="landmark" size="sm" testID="mark" />)
    const mark = view.getByTestId('mark', hidden)
    expect(style(mark)).toMatchObject({ width: 24, height: 24 })
    expect(mark.props.accessible).toBe(false)
    expect(mark.props.importantForAccessibility).toBe('no-hide-descendants')
  })
})

describe('mark sources', () => {
  it('shows coins for a cash position, else the logo with the ticker as fallback (web FinancialAssetLogo)', () => {
    expect(assetMark('CURRENCY_EUR', 'https://cdn.example/eur.png')).toEqual({ glyph: 'coins' })
    expect(assetMark('AAPL', null)).toMatchObject({ image: null, initials: 'AAPL' })
  })

  it("gives an account its institution's logo, then its letters, then its type's glyph, then a bank", () => {
    expect(accountMark({ logoUrl: 'https://cdn.example/b.png', institutionName: 'Bank' })).toMatchObject({ image: 'https://cdn.example/b.png', initials: 'Bank' })
    expect(accountMark({ type: 'credit_card' }).glyph).toBe('credit-card')
    expect(accountMark({ type: 'MORTGAGE' }).glyph).toBe('home')
    expect(accountMark({}).glyph).toBe('landmark')
  })

  it('gives a portfolio a briefcase when it has no broker', () => {
    expect(portfolioMark()).toEqual({ image: null, initials: null, glyph: 'briefcase' })
  })

  it('takes the first letters of two words, or the first two of one', () => {
    expect(markInitials('Caixa Geral de Depósitos')).toBe('CG')
    expect(markInitials('aapl.us')).toBe('AA')
    expect(markInitials('  ·  ')).toBeNull()
  })
})
