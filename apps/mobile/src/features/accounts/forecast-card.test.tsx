import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ForecastCard } from './forecast-card'
import type { AccountForecastDto } from './forecast-contract'

const series: AccountForecastDto = {
  accountKey: 7,
  complete: true,
  currency: 'EUR',
  lowPoint: { balance: 900, date: '2026-03-06' },
  openingBalance: 1000,
  points: [{ balance: 900, date: '2026-03-06' }],
  projected: [],
}

async function renderCard(value: AccountForecastDto) {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><ForecastCard days={30} locale="en" state={{ status: 'loaded', series: value }} /></I18nextProvider>)
}

describe('ForecastCard', () => {
  it('lists the card installments still to come as projections, with their "n/N"', async () => {
    const view = await renderCard({ ...series, projectedInstallments: [{ accountKey: 7, amount: 25, currency: 'EUR', date: '2026-03-05', installmentCount: 12, installmentNumber: 3, installmentPlanKey: 11, name: 'Laptop' }] })
    expect(view.getByText('Next installments')).toBeOnTheScreen()
    expect(view.getByText('Laptop')).toBeOnTheScreen()
    expect(view.getByTestId('forecast-installment-11-3')).toHaveTextContent('3/12')
    expect(view.getByText('Not counted in reports')).toBeOnTheScreen()
  })

  it('shows nothing extra for a series without them', async () => {
    const view = await renderCard(series)
    expect(view.queryByText('Next installments')).not.toBeOnTheScreen()
    expect(view.queryByText('Not counted in reports')).not.toBeOnTheScreen()
  })
})
