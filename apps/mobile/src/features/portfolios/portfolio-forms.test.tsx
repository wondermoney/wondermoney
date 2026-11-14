import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { PortfolioCreateScreen } from './portfolio-create-screen'
import { PortfolioSettingsScreen } from './portfolio-settings-screen'

const currencies = [{ currencyKey: 151, code: 'EUR', description: 'Euro' }, { currencyKey: 152, code: 'USD', description: 'US Dollar' }]
const commonCreate = { currencies, pending: false, unknownPayload: null, failure: null, detailState: 'idle' as const, confirmedPortfolioId: null, refreshingList: false, listRefreshFailed: false, onBack: jest.fn(), onRefreshList: jest.fn(), onRetryDetail: jest.fn() }
const settingsModel = { id: 7, name: 'Future', description: 'Long horizon', currency: 'EUR', benchmarkSymbol: null, excluded: false, targetAllocation: null, accountLink: null }
const linkAccounts = [
  { accountKey: 22, accountName: 'Checking', accountType: 'CHECKING', source: 'open_banking' },
  { accountKey: 21, accountName: 'Brokerage cash', accountType: 'INVESTMENT', source: 'open_banking' },
]
const storedLink = { accountKey: 21, accountName: 'Brokerage cash', mode: 'includes_holdings' as const }
const commonSettings = { model: settingsModel, pending: false, failure: null, unknownPayload: null, reconciling: false, reconciliation: null, onBack: jest.fn(), onReconcile: jest.fn(), onAcknowledgeReconciliation: jest.fn(), onDismissApplied: jest.fn() }
async function provider(node: React.ReactNode, locale: 'en' | 'pt-PT' | 'es' = 'en') { const i18n = await initMobileI18n(locale); return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>) }

describe('portfolio forms', () => {
  it('stages and confirms the trimmed create payload with the validated default currency', async () => {
    const submit = jest.fn().mockResolvedValue(undefined); const view = await provider(<PortfolioCreateScreen {...commonCreate} defaultCurrencyId={151} onSubmit={submit} />)
    await fireEvent.changeText(view.getByLabelText('Portfolio name'), '  Long term  '); await fireEvent.press(view.getByRole('button', { name: 'Review portfolio' })); expect(view.getByText('Long term')).toBeOnTheScreen(); expect(view.getByText('EUR · Euro')).toBeOnTheScreen(); await fireEvent.press(view.getByRole('button', { name: 'Create portfolio' })); await waitFor(() => expect(submit).toHaveBeenCalledWith({ name: 'Long term', currencyId: 151 }))
  })
  it('requires explicit currency selection when no safe default exists and exposes no broker control', async () => {
    const submit = jest.fn(); const view = await provider(<PortfolioCreateScreen {...commonCreate} defaultCurrencyId={null} onSubmit={submit} />)
    await fireEvent.changeText(view.getByLabelText('Portfolio name'), 'Future'); expect(view.getByRole('button', { name: 'Review portfolio' })).toBeDisabled(); expect(view.queryByText(/broker/i)).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: /^Portfolio currency,/ })); await fireEvent.press(view.getByRole('radio', { name: 'USD · US Dollar' }))
    expect(view.getByRole('button', { name: 'Review portfolio' })).toBeEnabled(); await fireEvent.press(view.getByRole('button', { name: 'Review portfolio' })); expect(view.getByLabelText('Portfolio currency: USD · US Dollar')).toBeOnTheScreen(); expect(submit).not.toHaveBeenCalled()
  })
  it('freezes a sparse settings review and requires explicit confirmation for description clearing', async () => {
    const save = jest.fn().mockResolvedValue(undefined); const view = await provider(<PortfolioSettingsScreen {...commonSettings} onSave={save} />)
    await fireEvent.changeText(view.getByLabelText('Description'), '')
    await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
    expect(save).not.toHaveBeenCalled()
    expect(view.getByLabelText('Description: Remove the current description')).toBeOnTheScreen()
    expect(view.queryByLabelText('Portfolio name: Future')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm changes' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ description: null }))
    expect(view.queryByText(/delete|transaction|import|rebuild/i)).not.toBeOnTheScreen()
  })
  it('discards a frozen settings review for editing or cancellation before rebuilding it', async () => {
    const save = jest.fn().mockResolvedValue(undefined); const view = await provider(<PortfolioSettingsScreen {...commonSettings} onSave={save} />)
    await fireEvent.changeText(view.getByLabelText('Portfolio name'), 'Renamed')
    await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
    expect(view.getByLabelText('Portfolio name: Renamed')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Edit changes' }))
    await fireEvent.changeText(view.getByLabelText('Portfolio name'), 'Final name')
    await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
    expect(view.getByLabelText('Portfolio name: Final name')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Cancel changes' }))
    expect(view.getByDisplayValue('Future')).toBeOnTheScreen()
    expect(save).not.toHaveBeenCalled()
  })
  it('reviews and saves a benchmark change', async () => {
    const save = jest.fn().mockResolvedValue(undefined); const view = await provider(<PortfolioSettingsScreen {...commonSettings} onSave={save} />)
    await fireEvent.changeText(view.getByLabelText('Benchmark ticker'), '  SPY  ')
    await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
    expect(view.getByLabelText('Benchmark ticker: SPY')).toBeOnTheScreen()
    expect(view.queryByLabelText('Portfolio name: Future')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm changes' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ benchmarkSymbol: 'SPY' }))
  })
  it('clearing the benchmark field submits an explicit null, not an omitted field', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const view = await provider(<PortfolioSettingsScreen {...commonSettings} model={{ ...settingsModel, benchmarkSymbol: 'SPY' }} onSave={save} />)
    await fireEvent.changeText(view.getByLabelText('Benchmark ticker'), '')
    await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
    expect(view.getByLabelText('Benchmark ticker: Remove the current benchmark')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm changes' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ benchmarkSymbol: null }))
  })
  it('excluding a portfolio from the aggregate dashboard is independently toggleable and reviewable', async () => {
    const save = jest.fn().mockResolvedValue(undefined); const view = await provider(<PortfolioSettingsScreen {...commonSettings} onSave={save} />)
    expect(view.getByRole('switch', { name: 'Exclude from aggregate dashboard' })).not.toBeChecked()
    expect(view.getByRole('button', { name: 'Review changes' })).toBeDisabled()
    await fireEvent(view.getByRole('switch', { name: 'Exclude from aggregate dashboard' }), 'valueChange', true)
    await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
    expect(view.getByLabelText('Exclude from aggregate dashboard: On')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm changes' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ excluded: true }))
  })
  it('applies a preset, reviews it, and submits exactly the preset asset classes', async () => {
    const save = jest.fn().mockResolvedValue(undefined); const view = await provider(<PortfolioSettingsScreen {...commonSettings} onSave={save} />)
    await fireEvent.press(view.getByRole('button', { name: 'Balanced' }))
    expect(view.getByLabelText('Equities')).toHaveDisplayValue('60')
    await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
    expect(view.getByLabelText('Equities: 60%')).toBeOnTheScreen()
    expect(view.getByLabelText('Fixed income: 30%')).toBeOnTheScreen()
    expect(view.getByLabelText('Cash & equivalents: 10%')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm changes' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ targetAllocation: { 'Equities': 60, 'Fixed Income': 30, 'Cash & Equivalents': 10 } }))
  })
  it('clearing an existing target allocation submits an explicit null', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const view = await provider(<PortfolioSettingsScreen {...commonSettings} model={{ ...settingsModel, targetAllocation: { 'Equities': 100 } }} onSave={save} />)
    await fireEvent.press(view.getByRole('button', { name: 'Clear allocation' }))
    await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
    expect(view.getByLabelText('Target allocation: Target allocation removed')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm changes' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ targetAllocation: null }))
  })
  it('rejects an unparsable percentage in the target allocation fields', async () => {
    const save = jest.fn(); const view = await provider(<PortfolioSettingsScreen {...commonSettings} onSave={save} />)
    await fireEvent.changeText(view.getByLabelText('Equities'), 'abc')
    expect(view.getByRole('alert')).toHaveTextContent('Enter a percentage of 0 or more.')
    expect(view.getByRole('button', { name: 'Review changes' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
    expect(save).not.toHaveBeenCalled()
  })
  it('reads target percentages in the app language', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const i18n = await initMobileI18n('pt-PT')
    const view = await provider(<PortfolioSettingsScreen {...commonSettings} onSave={save} />, 'pt-PT')
    await fireEvent.changeText(view.getByLabelText(i18n.t('portfolioSettings.allocation.classes.equities')), '87,5')
    await fireEvent.changeText(view.getByLabelText(i18n.t('portfolioSettings.allocation.classes.cashEquivalents')), '12,5')
    expect(view.queryByRole('alert')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: i18n.t('portfolioSettings.review') }))
    await fireEvent.press(view.getByRole('button', { name: i18n.t('portfolioSettings.confirm') }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ targetAllocation: { 'Equities': 87.5, 'Cash & Equivalents': 12.5 } }))
  })
  it('flags an empty settings name under its row and closes through the form bar', async () => {
    const back = jest.fn(); const view = await provider(<PortfolioSettingsScreen {...commonSettings} onBack={back} onSave={jest.fn()} />)
    await fireEvent.changeText(view.getByLabelText('Portfolio name'), '  ')
    expect(view.getByText('Enter a name up to 255 characters.')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Review changes' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Close' }))
    expect(back).toHaveBeenCalledTimes(1)
  })
  it.each(['pt-PT', 'es'] as const)('renders localized, labelled write controls in %s', async (locale) => {
    const view = await provider(<PortfolioCreateScreen {...commonCreate} defaultCurrencyId={151} onSubmit={jest.fn()} />, locale); expect(view.getByRole('header')).toBeOnTheScreen(); expect(view.getByRole('button', { name: /EUR · Euro$/ })).toBeOnTheScreen(); expect(view.getByRole('button', { name: locale === 'es' ? 'Revisar cartera' : 'Rever portefólio' })).toBeOnTheScreen()
  })
  describe('account link', () => {
    const chooseAccount = async (view: Awaited<ReturnType<typeof provider>>, name: string) => {
      await fireEvent.press(view.getByRole('button', { name: /^Account that holds this portfolio,/ }))
      await fireEvent.press(view.getByRole('radio', { name }))
    }

    it('links an account, preselecting cash only for a synced one, and reviews the link before saving', async () => {
      const save = jest.fn().mockResolvedValue(undefined)
      const view = await provider(<PortfolioSettingsScreen {...commonSettings} accounts={linkAccounts} onSave={save} />)
      expect(view.getByRole('button', { name: 'Account that holds this portfolio, Not linked' })).toBeOnTheScreen()
      expect(view.queryByText("Does this account's balance include your investments?")).not.toBeOnTheScreen()
      await chooseAccount(view, 'Brokerage cash')
      expect(view.getByRole('button', { name: "Does this account's balance include your investments?, No, cash only" })).toBeOnTheScreen()
      expect(view.getByText("Net worth counts the account's cash and this portfolio.")).toBeOnTheScreen()
      await fireEvent.press(view.getByRole('button', { name: /^Does this account's balance include your investments\?,/ }))
      await fireEvent.press(view.getByRole('radio', { name: 'Yes, it includes them' }))
      await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
      expect(view.getByLabelText('Account that holds this portfolio: Brokerage cash · Yes, it includes them')).toBeOnTheScreen()
      await fireEvent.press(view.getByRole('button', { name: 'Confirm changes' }))
      await waitFor(() => expect(save).toHaveBeenCalledWith({ accountLink: { accountId: 21, mode: 'includes_holdings' } }))
    })

    it('unlinks with an explicit null', async () => {
      const save = jest.fn().mockResolvedValue(undefined)
      const view = await provider(<PortfolioSettingsScreen {...commonSettings} accounts={linkAccounts} model={{ ...settingsModel, accountLink: storedLink }} onSave={save} />)
      expect(view.getByRole('button', { name: 'Account that holds this portfolio, Brokerage cash' })).toBeOnTheScreen()
      await chooseAccount(view, 'Not linked')
      await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
      expect(view.getByLabelText('Account that holds this portfolio: Not linked')).toBeOnTheScreen()
      await fireEvent.press(view.getByRole('button', { name: 'Confirm changes' }))
      await waitFor(() => expect(save).toHaveBeenCalledWith({ accountLink: null }))
    })

    it('never sends an unchanged link with other changes, and names the stored account before the accounts load', async () => {
      const save = jest.fn().mockResolvedValue(undefined)
      const view = await provider(<PortfolioSettingsScreen {...commonSettings} model={{ ...settingsModel, accountLink: storedLink }} onSave={save} />)
      expect(view.getByRole('button', { name: 'Account that holds this portfolio, Brokerage cash' })).toBeOnTheScreen()
      await fireEvent.changeText(view.getByLabelText('Portfolio name'), 'Renamed')
      await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
      await fireEvent.press(view.getByRole('button', { name: 'Confirm changes' }))
      await waitFor(() => expect(save).toHaveBeenCalledWith({ name: 'Renamed' }))
    })

    it('tells a partner who holds the link, and nothing about the account', async () => {
      const view = await provider(<PortfolioSettingsScreen {...commonSettings} accounts={linkAccounts} failure="link-held" linkHolder="Ana" onSave={jest.fn()} />)
      // The partner's private account is not among this member's accounts and the link reads as none.
      expect(view.getByRole('button', { name: 'Account that holds this portfolio, Not linked' })).toBeOnTheScreen()
      expect(view.getByText('Already linked by Ana')).toBeOnTheScreen()
    })

    it('falls back to the older refusal without a name', async () => {
      const view = await provider(<PortfolioSettingsScreen {...commonSettings} failure="link-managed" onSave={jest.fn()} />)
      expect(view.getByText(/only another household member can see, so only they can change the link/)).toBeOnTheScreen()
    })

    it.each(['pt-PT', 'es'] as const)('names the holder in %s', async (locale) => {
      const view = await provider(<PortfolioSettingsScreen {...commonSettings} failure="link-held" linkHolder="Ana" onSave={jest.fn()} />, locale)
      expect(view.getByText(locale === 'es' ? 'Ya vinculada por Ana' : 'Já ligado por Ana')).toBeOnTheScreen()
    })
  })
})
