import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { SimplefinConnectScreen, type SimplefinConnectScreenProps } from '../simplefin-connect-screen'

const renderScreen = async (props: Partial<SimplefinConnectScreenProps> = {}) => {
  const i18n = await initMobileI18n('en')
  const handlers = { onBack: jest.fn(), onSubmit: jest.fn(), onOpenBridge: jest.fn() }
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <SimplefinConnectScreen failure={null} submitting={false} {...handlers} {...props} />
    </I18nextProvider>,
  )
  return { view, i18n, ...handlers, ...props }
}

describe('SimplefinConnectScreen', () => {
  it('takes the token without autocorrect or autocapitalisation', async () => {
    const { view } = await renderScreen()
    const field = view.getByTestId('simplefin-setup-token')
    expect(field.props.autoCorrect).toBe(false)
    expect(field.props.autoCapitalize).toBe('none')
    expect(field.props.spellCheck).toBe(false)
  })

  it('does not submit an empty token', async () => {
    const { view, i18n, onSubmit } = await renderScreen()
    const submit = view.getByRole('button', { name: i18n.t('banking.simplefin.submit') })
    expect(submit).toBeDisabled()
    await fireEvent.changeText(view.getByTestId('simplefin-setup-token'), '   ')
    await fireEvent.press(submit)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the trimmed token once and clears the field', async () => {
    const { view, i18n, onSubmit } = await renderScreen()
    const field = view.getByTestId('simplefin-setup-token')
    await fireEvent.changeText(field, '  aHR0cHM6Ly9icmlkZ2U=\n')
    await fireEvent.press(view.getByRole('button', { name: i18n.t('banking.simplefin.submit') }))
    expect(onSubmit).toHaveBeenCalledWith('aHR0cHM6Ly9icmlkZ2U=')
    expect(view.getByTestId('simplefin-setup-token').props.value).toBe('')
  })

  it("shows the API's own message when it refused the token", async () => {
    const { view } = await renderScreen({ failure: { reason: 'rejected', serverMessage: 'This setup token was already used or does not exist.' } })
    expect(view.getByText('This setup token was already used or does not exist.')).toBeOnTheScreen()
  })

  it.each(['token-invalid', 'token-already-claimed', 'server-not-allowed'] as const)('shows translated copy for %s', async (reason) => {
    const { view, i18n } = await renderScreen({ failure: { reason, serverMessage: null } })
    const copy = i18n.t(`banking.simplefin.failures.${reason}`)
    expect(copy).not.toBe(`banking.simplefin.failures.${reason}`)
    expect(view.getByText(copy)).toBeOnTheScreen()
  })

  it('falls back to its own wording when there is no server message', async () => {
    const { view, i18n } = await renderScreen({ failure: { reason: 'unreachable', serverMessage: null } })
    expect(view.getByText(i18n.t('banking.simplefin.failures.unreachable'))).toBeOnTheScreen()
  })

  it('links to SimpleFIN Bridge', async () => {
    const { view, i18n, onOpenBridge } = await renderScreen()
    await fireEvent.press(view.getByRole('button', { name: i18n.t('banking.simplefin.bridgeLink') }))
    expect(onOpenBridge).toHaveBeenCalledTimes(1)
  })

  it('locks the field and the back control while connecting', async () => {
    const { view, i18n } = await renderScreen({ submitting: true })
    expect(view.getByTestId('simplefin-setup-token').props.editable).toBe(false)
    expect(view.getByRole('button', { name: i18n.t('banking.simplefin.connecting') })).toBeDisabled()
  })
})
