import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { DebtStrategyScreen } from './debt-strategy-screen'
import type { DebtStrategyViewModel } from './debt-strategy-view-model'

const eligible: DebtStrategyViewModel = {
  eligible: true,
  avalanche: { months: 30, totalInterest: 1850, bars: [{ id: 1, name: 'Visa card', interest: 450, widthPercent: 32 }, { id: 2, name: 'Car loan', interest: 1400, widthPercent: 100 }] },
  snowball: { months: 32, totalInterest: 2100, bars: [{ id: 1, name: 'Visa card', interest: 500, widthPercent: 31 }, { id: 2, name: 'Car loan', interest: 1600, widthPercent: 100 }] },
  interestSaved: 250,
  cheaper: 'avalanche',
}

async function renderScreen(state: React.ComponentProps<typeof DebtStrategyScreen>['state'], currencyCode: string | null = 'EUR') {
  const i18n = await initMobileI18n('en')
  const onBack = jest.fn()
  const onRefresh = jest.fn()
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <DebtStrategyScreen state={state} currencyCode={currencyCode} onBack={onBack} onRefresh={onRefresh} />
    </I18nextProvider>,
  )
  return { view, onBack, onRefresh }
}

describe('DebtStrategyScreen', () => {
  it('renders nothing during an access transition', async () => {
    const { view } = await renderScreen({ status: 'access-transition' })
    expect(view.toJSON()).toBeNull()
  })

  it.each(['loading', 'error', 'invalid-response'] as const)('handles %s', async (status) => {
    const { view } = await renderScreen({ status })
    expect(view.toJSON()).not.toBeNull()
  })

  it('shows the ineligible message with fewer than two comparable debts', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { eligible: false }, refreshing: false })
    expect(view.getByText('Not enough debts to compare')).toBeOnTheScreen()
  })

  it('shows a stale banner on refresh-error while keeping prior data visible', async () => {
    const { view } = await renderScreen({ status: 'refresh-error', data: eligible, refreshing: false })
    expect(view.getByRole('alert')).toBeOnTheScreen()
    expect(view.getAllByText('Avalanche').length).toBeGreaterThan(0)
  })

  it('renders both strategy cards, the recommended badge on the cheaper one, and the savings sentence', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: eligible, refreshing: false })
    expect(view.getByText('Least interest')).toBeOnTheScreen()
    expect(view.getByText('Avalanche saves €250.00 in interest versus snowball.')).toBeOnTheScreen()
    expect(view.getByText('€1,850.00')).toBeOnTheScreen()
    expect(view.getByText('€2,100.00')).toBeOnTheScreen()
  })

  it('defaults the per-debt chart to the avalanche tab and switches to snowball on selection', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: eligible, refreshing: false })
    expect(view.getByText('€450.00')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('tab', { name: 'Snowball' }))
    expect(view.getByText('€500.00')).toBeOnTheScreen()
  })

  it('hides the recommended badge and savings sentence when interest is tied', async () => {
    const tied: DebtStrategyViewModel = { ...eligible, interestSaved: 0, cheaper: null }
    const { view } = await renderScreen({ status: 'loaded', data: tied, refreshing: false })
    expect(view.queryByText('Least interest')).toBeNull()
    expect(view.queryByText(/saves/)).toBeNull()
  })

  it('falls back to a plain number when no currency code is available', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: eligible, refreshing: false }, null)
    expect(view.getByText('1850')).toBeOnTheScreen()
  })
})
