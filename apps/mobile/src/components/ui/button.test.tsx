import { act, fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { themeTokens } from '@/theme/tokens'

import { Button } from './button'

const palette = themeTokens.colors.light

describe('Button', () => {
  it('spends the accent on the primary action and nothing else', async () => {
    const view = await render(
      <>
        <Button label="Continue" onPress={jest.fn()} />
        <Button label="Cancel" onPress={jest.fn()} variant="secondary" />
        <Button label="Delete" onPress={jest.fn()} variant="destructive" />
      </>,
    )

    const style = (name: string) => StyleSheet.flatten(view.getByRole('button', { name }).props.style)

    expect(style('Continue').backgroundColor).toBe(palette.primary)
    expect(style('Cancel').backgroundColor).toBe(palette.secondary)
    expect(style('Delete').backgroundColor).toBe(palette.destructive)
  })

  it('gives the quiet filled variant a visible boundary', async () => {
    // `secondary` and `muted` are the same value, so on a muted surface the
    // fill does nothing and the border is the only thing making the control a
    // shape. Without it the button measured 1.00:1 against its background.
    const view = await render(<Button label="Cancel" onPress={jest.fn()} variant="secondary" />)
    const style = StyleSheet.flatten(view.getByRole('button', { name: 'Cancel' }).props.style)

    expect(style.borderColor).toBe(palette.input)
    expect(style.borderWidth).toBe(1)
  })

  it('meets the 48dp touch target and invokes its action', async () => {
    const onPress = jest.fn()
    const view = await render(<Button label="Save" onPress={onPress} />)
    const button = view.getByRole('button', { name: 'Save' })

    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      minHeight: themeTokens.touchTarget.minimum,
      borderRadius: themeTokens.radius.md,
    })
    expect(themeTokens.touchTarget.minimum).toBeGreaterThanOrEqual(themeTokens.touchTarget.wcagFloor)

    fireEvent.press(button)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('loading disables the control, announces busy, and keeps the label', async () => {
    const onPress = jest.fn()
    const view = await render(<Button label="Save" loading onPress={onPress} />)
    const button = view.getByRole('button', { name: 'Save' })

    expect(button.props.accessibilityState).toMatchObject({ disabled: true, busy: true })
    // A spinner over a live button is how a form gets submitted twice.
    fireEvent.press(button)
    expect(onPress).not.toHaveBeenCalled()
    // The label survives, so the user can still tell what they pressed.
    expect(view.getByText('Save')).toBeTruthy()
  })

  it('loading wins over an explicit disabled={false}', async () => {
    const view = await render(<Button disabled={false} label="Save" loading onPress={jest.fn()} />)
    expect(view.getByRole('button', { name: 'Save' }).props.accessibilityState).toMatchObject({ disabled: true })
  })

  it('disabled stops responding to a press it is ignoring', async () => {
    const onPress = jest.fn()
    const view = await render(<Button disabled label="Save" onPress={onPress} />)
    const button = view.getByRole('button', { name: 'Save' })

    expect(button.props.accessibilityState).toMatchObject({ disabled: true, busy: false })
    fireEvent.press(button)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('shows the focus ring instantly, without animating it in', async () => {
    const view = await render(<Button label="Save" onPress={jest.fn()} />)
    const style = () => StyleSheet.flatten(view.getByRole('button', { name: 'Save' }).props.style)
    // `fireEvent(el, 'focus')` does not reach a Pressable's focus handler under
    // RNTL, so the prop is driven directly. Verified by hand that the handler
    // is the component's own and that the host element carries it.
    const focus = async (event: 'onFocus' | 'onBlur') => {
      const handler = view.getByRole('button', { name: 'Save' }).props[event]
      await act(async () => handler({ nativeEvent: {} }))
    }

    await focus('onFocus')
    expect(style().borderColor).toBe(palette.ring)
    expect(style().borderWidth).toBe(2)

    await focus('onBlur')
    expect(style().borderColor).not.toBe(palette.ring)
  })
})
