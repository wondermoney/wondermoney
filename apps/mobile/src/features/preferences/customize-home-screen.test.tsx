import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { defaultDashboardLayout } from '@wondermoney/shared/dashboard-layout'
import { initMobileI18n } from '@/lib/i18n'

import { CustomizeHomeScreen, type CustomizeHomeScreenProps } from './customize-home-screen'

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true }) }))

async function renderScreen(overrides: Partial<CustomizeHomeScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: CustomizeHomeScreenProps = {
    layout: defaultDashboardLayout(),
    onMove: jest.fn(),
    onToggle: jest.fn(),
    onReset: jest.fn(),
    onRetryLoad: jest.fn(),
    onRetrySave: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  }
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <CustomizeHomeScreen {...props} />
    </I18nextProvider>,
  )
  return { view, props }
}

const rowOrder = (view: Awaited<ReturnType<typeof renderScreen>>['view']) =>
  view.getAllByTestId(/^customize-row-/).map((row) => row.props.testID as string)

describe('CustomizeHomeScreen', () => {
  it('lists every section in the saved order, net worth first', async () => {
    const { view } = await renderScreen({
      layout: [
        { id: 'net-worth', hidden: false },
        { id: 'loans', hidden: false },
        { id: 'this-month', hidden: true },
        { id: 'balance-sheet', hidden: false },
        { id: 'cashflow', hidden: false },
        { id: 'latest-transactions', hidden: false },
      ],
    })

    expect(rowOrder(view)).toEqual([
      'customize-row-net-worth',
      'customize-row-loans',
      'customize-row-this-month',
      'customize-row-balance-sheet',
      'customize-row-cashflow',
      'customize-row-latest-transactions',
    ])
    expect(view.getByTestId('customize-visible-this-month').props.value).toBe(false)
    expect(view.getByTestId('customize-visible-loans').props.value).toBe(true)
  })

  it('moves a section down', async () => {
    const { view, props } = await renderScreen()

    await fireEvent.press(view.getByTestId('customize-down-this-month'))

    expect(props.onMove).toHaveBeenCalledWith('this-month', 'down')
  })

  it('hides a section with its visibility switch', async () => {
    const { view, props } = await renderScreen()

    await fireEvent(view.getByTestId('customize-visible-loans'), 'valueChange', false)

    expect(props.onToggle).toHaveBeenCalledWith('loans', false)
  })

  it('keeps net worth first and visible', async () => {
    const { view } = await renderScreen()

    const toggle = view.getByTestId('customize-visible-net-worth')
    expect(toggle.props.value).toBe(true)
    expect(toggle.props.disabled).toBe(true)
    expect(view.getByTestId('customize-up-net-worth').props.accessibilityState.disabled).toBe(true)
    expect(view.getByTestId('customize-down-net-worth').props.accessibilityState.disabled).toBe(true)
    expect(view.getByText('Always shown first')).toBeOnTheScreen()
  })

  it('cannot move the second section up past net worth', async () => {
    const { view } = await renderScreen()

    expect(view.getByTestId('customize-up-insights').props.accessibilityState.disabled).toBe(true)
    expect(view.getByTestId('customize-down-latest-transactions').props.accessibilityState.disabled).toBe(true)
  })

  it('resets to the default order', async () => {
    const { view, props } = await renderScreen()

    await fireEvent.press(view.getByRole('button', { name: 'Reset to default' }))

    expect(props.onReset).toHaveBeenCalledTimes(1)
  })

  it('explains a failed load and offers a retry', async () => {
    const { view, props } = await renderScreen({ isLoadError: true })

    expect(view.getByText('Could not load your home layout.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(props.onRetryLoad).toHaveBeenCalledTimes(1)
  })

  it('reports a failed save without hiding the list', async () => {
    const { view, props } = await renderScreen({ saveError: true })

    expect(view.getByText('Could not save. Try again.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(props.onRetrySave).toHaveBeenCalledTimes(1)
    expect(view.getByTestId('customize-row-loans')).toBeOnTheScreen()
  })
})
