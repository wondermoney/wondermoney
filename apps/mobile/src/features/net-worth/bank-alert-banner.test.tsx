import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import type { BankAlertDto } from '@/features/banking/bank-alerts-contract'
import type { BankAlertBannerModel } from '@/features/banking/bank-alerts-view-model'
import { initMobileI18n } from '@/lib/i18n'

import { BankAlertBanner } from './bank-alert-banner'

const alert = (overrides: Partial<BankAlertDto> & Pick<BankAlertDto, 'kind'>): BankAlertDto => ({
  id: 'a1',
  institutionName: 'Banco X',
  bankId: 'BX',
  expiresAt: null,
  daysUntilExpiry: null,
  failingSince: null,
  ...overrides,
})

const banner = (primary: BankAlertDto, moreCount = 0): BankAlertBannerModel => ({ primary, moreCount, ids: [primary.id] })

async function renderBanner(model: BankAlertBannerModel, language = 'en') {
  const i18n = await initMobileI18n(language)
  const onNavigate = jest.fn()
  const onDismiss = jest.fn()
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <BankAlertBanner locale={language} model={model} onDismiss={onDismiss} onNavigate={onNavigate} />
    </I18nextProvider>,
  )
  return { view, onNavigate, onDismiss }
}

describe('BankAlertBanner', () => {
  it('says how many days of access are left', async () => {
    const { view } = await renderBanner(banner(alert({ kind: 'consent_expiring', daysUntilExpiry: 7, expiresAt: '2026-11-16T00:00:00.000Z' })))
    expect(view.getByText('Banco X: access ends in 7 days')).toBeOnTheScreen()
    expect(view.getByText('Reconnect to keep your data syncing.')).toBeOnTheScreen()
  })

  it('words the last day and an unknown day count', async () => {
    const today = await renderBanner(banner(alert({ kind: 'consent_expiring', daysUntilExpiry: 0 })))
    expect(today.view.getByText('Banco X: access ends within a day')).toBeOnTheScreen()
    const unknown = await renderBanner(banner(alert({ kind: 'consent_expiring', institutionName: null })))
    expect(unknown.view.getByText('Your bank: access ends soon')).toBeOnTheScreen()
  })

  it('says the bank ended access early', async () => {
    const { view } = await renderBanner(banner(alert({ kind: 'consent_revoked' })))
    expect(view.getByText('Banco X ended access early')).toBeOnTheScreen()
  })

  it('says since when a failing bank has not updated', async () => {
    const { view } = await renderBanner(banner(alert({ kind: 'sync_failing', failingSince: '2026-11-05T12:00:00.000Z' })))
    expect(view.getByText("Banco X hasn't updated since Nov 5")).toBeOnTheScreen()
    const undated = await renderBanner(banner(alert({ kind: 'sync_failing', failingSince: 'garbage' })))
    expect(undated.view.getByText("Banco X hasn't updated recently")).toBeOnTheScreen()
  })

  it('counts the other alerts in one banner', async () => {
    const { view } = await renderBanner(banner(alert({ kind: 'consent_revoked' }), 2))
    expect(view.getByText('Reconnect to resume syncing. And 2 more bank alerts.')).toBeOnTheScreen()
  })

  it('reconnects through the bank connections screen and dismisses', async () => {
    const { view, onNavigate, onDismiss } = await renderBanner(banner(alert({ kind: 'consent_revoked' })))
    await fireEvent.press(view.getByRole('button', { name: 'Reconnect' }))
    expect(onNavigate).toHaveBeenCalledWith('/more/banking')
    await fireEvent.press(view.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('is translated', async () => {
    const pt = await renderBanner(banner(alert({ kind: 'consent_expiring', daysUntilExpiry: 1 }), 1), 'pt-PT')
    expect(pt.view.getByText('Banco X: o acesso termina dentro de 1 dia')).toBeOnTheScreen()
    expect(pt.view.getByRole('button', { name: 'Voltar a ligar' })).toBeOnTheScreen()
    const es = await renderBanner(banner(alert({ kind: 'consent_revoked' })), 'es')
    expect(es.view.getByText('Banco X ha finalizado el acceso antes de tiempo')).toBeOnTheScreen()
  })
})
