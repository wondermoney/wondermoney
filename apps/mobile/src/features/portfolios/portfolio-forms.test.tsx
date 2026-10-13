import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { PortfolioCreateScreen } from './portfolio-create-screen'
import { PortfolioSettingsScreen } from './portfolio-settings-screen'

const currencies = [{ currencyKey: 151, code: 'EUR', description: 'Euro' }, { currencyKey: 152, code: 'USD', description: 'US Dollar' }]
const commonCreate = { currencies, pending: false, unknownPayload: null, failure: null, detailState: 'idle' as const, confirmedPortfolioId: null, refreshingList: false, listRefreshFailed: false, onBack: jest.fn(), onRefreshList: jest.fn(), onRetryDetail: jest.fn() }
const settingsModel = { id: 7, name: 'Future', description: 'Long horizon', currency: 'EUR', benchmarkSymbol: null, excluded: false, favored: false, targetAllocation: null }
const commonSettings = { model: settingsModel, pending: false, failure: null, unknownPayload: null, reconciling: false, reconciliation: null, onBack: jest.fn(), onReconcile: jest.fn(), onAcknowledgeReconciliation: jest.fn(), onDismissApplied: jest.fn() }
async function provider(node: React.ReactNode, locale: 'en' | 'pt-PT' | 'es' = 'en') { const i18n = await initMobileI18n(locale); return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>) }

describe('portfolio forms', () => {
  it('stages and confirms the trimmed create payload with the validated default currency', async () => {
    const submit = jest.fn().mockResolvedValue(undefined); const view = await provider(<PortfolioCreateScreen {...commonCreate} defaultCurrencyId={151} onSubmit={submit} />)
    await fireEvent.changeText(view.getByLabelText('Portfolio name'), '  Long term  '); await fireEvent.press(view.getByRole('button', { name: 'Review portfolio' })); expect(view.getByText('Long term')).toBeOnTheScreen(); expect(view.getByText('EUR · Euro')).toBeOnTheScreen(); await fireEvent.press(view.getByRole('button', { name: 'Create portfolio' })); await waitFor(() => expect(submit).toHaveBeenCalledWith({ name: 'Long term', currencyId: 151 }))
  })
  it('requires explicit currency selection when no safe default exists and exposes no broker control', async () => {
    const submit = jest.fn(); const view = await provider(<PortfolioCreateScreen {...commonCreate} defaultCurrencyId={null} onSubmit={submit} />)
    await fireEvent.changeText(view.getByLabelText('Portfolio name'), 'Future'); await fireEvent.press(view.getByRole('button', { name: 'Review portfolio' })); expect(view.getByRole('alert')).toHaveTextContent(/choose an available currency/i); expect(view.queryByText(/broker/i)).not.toBeOnTheScreen(); expect(submit).not.toHaveBeenCalled()
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
  it('reviews and saves a benchmark change alongside a dashboard-visibility toggle', async () => {
    const save = jest.fn().mockResolvedValue(undefined); const view = await provider(<PortfolioSettingsScreen {...commonSettings} onSave={save} />)
    await fireEvent.changeText(view.getByLabelText('Benchmark ticker'), '  SPY  ')
    await fireEvent.press(view.getByRole('switch', { name: 'Highlight on dashboard' }))
    await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
    expect(view.getByLabelText('Benchmark ticker: SPY')).toBeOnTheScreen()
    expect(view.getByLabelText('Highlight on dashboard: On')).toBeOnTheScreen()
    expect(view.queryByLabelText('Portfolio name: Future')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm changes' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ benchmarkSymbol: 'SPY', favored: true }))
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
    expect(view.getByRole('switch', { name: 'Exclude from aggregate dashboard' }).props.accessibilityState.checked).toBe(false)
    await fireEvent.press(view.getByRole('switch', { name: 'Exclude from aggregate dashboard' }))
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
    await fireEvent.press(view.getByRole('button', { name: 'Review changes' }))
    expect(view.getByRole('alert')).toBeOnTheScreen()
    expect(save).not.toHaveBeenCalled()
  })
  it.each(['pt-PT', 'es'] as const)('renders localized, labelled write controls in %s', async (locale) => {
    const view = await provider(<PortfolioCreateScreen {...commonCreate} defaultCurrencyId={151} onSubmit={jest.fn()} />, locale); expect(view.getByRole('header')).toBeOnTheScreen(); expect(view.getAllByRole('radio')).toHaveLength(2); expect(view.getByRole('button', { name: locale === 'es' ? 'Revisar cartera' : 'Rever portefólio' })).toBeOnTheScreen()
  })
})
