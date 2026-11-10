import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import type { FxState } from '@/lib/api/fx-status'
import { initMobileI18n } from '@/lib/i18n'

import { FxStatusLabel } from './fx-status-label'

async function renderLabel(state: FxState, language: 'en' | 'pt-PT' | 'es' = 'en') {
  const i18n = await initMobileI18n(language)
  return render(<I18nextProvider i18n={i18n}><FxStatusLabel locale={language === 'en' ? 'en-GB' : language} state={state} /></I18nextProvider>)
}

describe('FxStatusLabel', () => {
  it('says nothing for an exact amount', async () => {
    const view = await renderLabel({ status: 'exact' })
    expect(view.queryByTestId('fx-status-label')).not.toBeOnTheScreen()
  })

  it('marks an amount with no exchange rate as not converted, naming the currency for screen readers', async () => {
    const view = await renderLabel({ status: 'missing', amount: -10_000, currency: 'JPY' })
    const label = view.getByTestId('fx-status-label')
    expect(label).toHaveTextContent('Not converted')
    expect(label.props.accessibilityLabel).toMatch(/Not converted\. No exchange rate for JPY yet/)
  })

  it('marks an amount converted at an old rate as estimated, with the rate date', async () => {
    const view = await renderLabel({ status: 'provisional', rateDate: '2026-11-03' })
    const label = view.getByTestId('fx-status-label')
    expect(label).toHaveTextContent(/Estimated.*Rate of 3 Nov 2026/)
    expect(label.props.accessibilityLabel).toMatch(/Converted at the rate from 3 Nov 2026/)
  })

  it('is translated into Portuguese and Spanish', async () => {
    expect((await renderLabel({ status: 'missing', amount: 1, currency: 'JPY' }, 'pt-PT')).getByTestId('fx-status-label')).toHaveTextContent('Não convertido')
    expect((await renderLabel({ status: 'provisional', rateDate: '2026-11-03' }, 'es')).getByTestId('fx-status-label')).toHaveTextContent(/Estimado/)
  })
})
