import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { themeTokens } from '@/theme/tokens'

import { PageHeader } from './page-header'

describe('PageHeader', () => {
  it('uses the one page-title treatment and preserves accessible help', async () => {
    const view = await render(<PageHeader helpText="Learn about accounts" title="Accounts" />)
    const title = view.getByRole('header', { name: 'Accounts' })
    const help = view.getByRole('button', { name: 'Learn about accounts' })

    expect(StyleSheet.flatten(title.props.style)).toMatchObject({
      fontSize: themeTokens.typography.scale.title.fontSize,
      lineHeight: themeTokens.typography.scale.title.lineHeight,
      fontWeight: themeTokens.typography.scale.title.fontWeight,
    })
    expect(help.props.accessibilityLabel).toBe('Learn about accounts')
    fireEvent.press(help)
  })

  it('is declarative — a supporting sentence is not rendered', async () => {
    // `subtitle` is retained as a deprecated no-op so the 30 pre-port call
    // sites kept compiling while they were cleaned up. It must never render.
    const view = await render(<PageHeader subtitle="Your connected accounts" title="Accounts" />)

    expect(view.queryByText('Your connected accounts')).toBeNull()
    expect(view.getByRole('header', { name: 'Accounts' })).toBeTruthy()
  })

  it('carries provenance, which is not a description', async () => {
    const view = await render(<PageHeader provenance="Updated 3:28 PM · 4 of 24" title="Accounts" />)
    expect(view.getByText('Updated 3:28 PM · 4 of 24')).toBeTruthy()
  })
})
