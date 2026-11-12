import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { InstallmentBadge } from './installment-badge'

async function renderBadge(installment: React.ComponentProps<typeof InstallmentBadge>['installment'], language = 'en') {
  const i18n = await initMobileI18n(language)
  return render(<I18nextProvider i18n={i18n}><InstallmentBadge installment={installment} /></I18nextProvider>)
}

describe('InstallmentBadge', () => {
  it('shows "3/12" and says which installment it is', async () => {
    const view = await renderBadge({ installmentNumber: 3, installmentCount: 12 })
    expect(view.getByText('3/12')).toBeOnTheScreen()
    expect(view.getByLabelText('Installment 3 of 12')).toBeOnTheScreen()
  })

  it('says it in the reader’s language', async () => {
    expect((await renderBadge({ installmentNumber: 3, installmentCount: 12 }, 'pt-PT')).getByLabelText('Prestação 3 de 12')).toBeOnTheScreen()
    expect((await renderBadge({ installmentNumber: 3, installmentCount: 12 }, 'es')).getByLabelText('Cuota 3 de 12')).toBeOnTheScreen()
  })

  it('renders nothing for a row that is not an installment', async () => {
    const view = await renderBadge(null)
    expect(view.queryByTestId('installment-badge')).not.toBeOnTheScreen()
    expect(view.toJSON()).toBeNull()
  })
})
