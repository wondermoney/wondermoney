import { fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { AssetCreateScreen } from './asset-create-screen'
import { AssetDetailScreen, type ManualAssetManageActions } from './asset-detail-screen'
import { AssetEditScreen } from './asset-edit-screen'
import { AssetsScreen } from './assets-screen'
import { localToday } from './manual-assets-view-model'
import { assetDetailFixture, assetFixture, assetsFixture, walletDetailFixture } from './test-fixtures'
import { ValuationScreen } from './valuation-screen'

// The Skia canvas needs a native backend jest doesn't have.
jest.mock('victory-native', () => ({ CartesianChart: () => null, Area: () => null, Line: () => null }))

const renderScreen = async (node: React.ReactElement, language = 'en') => {
  const i18n = await initMobileI18n(language)
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

const list = (data = assetsFixture()) => <AssetsScreen state={{ status: 'loaded', data }} onOpenAsset={jest.fn()} onCreateAsset={jest.fn()} onRefresh={jest.fn()} />

describe('Assets list', () => {
  it('leads with the household total and lists each asset with its kind and value', async () => {
    const onOpenAsset = jest.fn()
    const view = await renderScreen(<AssetsScreen state={{ status: 'loaded', data: assetsFixture([assetFixture, { ...assetFixture, manualAssetKey: 8, name: 'Car', kind: 'vehicle', value: 18_000, valueInUserCurrency: 18_000, isPrivate: true }], { totalValue: 268_000 }) }} onOpenAsset={onOpenAsset} onCreateAsset={jest.fn()} onRefresh={jest.fn()} />)
    expect(view.getByRole('header', { name: 'Assets' })).toBeOnTheScreen()
    expect(within(view.getByTestId('assets-summary')).getByText('Total value')).toBeOnTheScreen()
    // Sorted by name, the private one marked.
    const car = view.getByRole('button', { name: /^Car, Vehicle, Private, €18,000\.00, EUR/ })
    expect(view.getByRole('button', { name: /^Family home, Property, €250,000\.00, EUR, Valued Jun 1, 2026/ })).toBeOnTheScreen()
    await fireEvent.press(car)
    expect(onOpenAsset).toHaveBeenCalledWith(8)
  })

  it('shows an asset with no exchange rate in its own currency, out of the total, and says so', async () => {
    const view = await renderScreen(list(assetsFixture(
      [assetFixture, { ...assetFixture, manualAssetKey: 9, name: 'Flat in Lagos', currency: 'NGN', currencyKey: 9, value: 90_000_000, valueInUserCurrency: null }],
      { isComplete: false, unconvertedAssets: 1, unconvertedCurrencies: ['NGN'] },
    )))
    expect(view.getByRole('button', { name: /^Flat in Lagos, Property, NGN\s?90,000,000\.00, NGN, No exchange rate/ })).toBeOnTheScreen()
    expect(view.getByText('1 asset is left out of the total: there is no exchange rate for NGN yet.')).toBeOnTheScreen()
  })

  it('keeps archived assets in their own section at their last value', async () => {
    const view = await renderScreen(list(assetsFixture([assetFixture, { ...assetFixture, manualAssetKey: 10, name: 'Old car', kind: 'vehicle', archived: true, archivedAt: '2026-07-01T09:00:00.000Z', value: null, valueInUserCurrency: null, lastValuation: { manualAssetValuationKey: 3, date: '2026-05-01', value: 3000, note: null } }])))
    expect(within(view.getByTestId('assets-archived')).getByRole('button', { name: /^Old car, Vehicle, €3,000\.00/ })).toBeOnTheScreen()
  })

  it('offers to add the first asset, and explains that a value is no transaction', async () => {
    const onCreateAsset = jest.fn()
    const view = await renderScreen(<AssetsScreen state={{ status: 'loaded', data: assetsFixture([], { totalValue: 0 }) }} onOpenAsset={jest.fn()} onCreateAsset={onCreateAsset} onRefresh={jest.fn()} />)
    expect(view.getByText(/Updating a value never creates a transaction/)).toBeOnTheScreen()
    expect(view.queryByTestId('assets-add')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Add asset' }))
    expect(onCreateAsset).toHaveBeenCalled()
  })

  it('reads in Portuguese, addressing the reader as tu', async () => {
    const view = await renderScreen(<AssetsScreen state={{ status: 'loaded', data: assetsFixture([], { totalValue: 0 }) }} onOpenAsset={jest.fn()} onCreateAsset={jest.fn()} onRefresh={jest.fn()} />, 'pt-PT')
    expect(view.getByText('Conta a tua casa e o teu carro no património')).toBeOnTheScreen()
  })
})

describe('Asset detail', () => {
  const detail = (data = assetDetailFixture(), onUpdateValue = jest.fn()) => <AssetDetailScreen state={{ status: 'loaded', data }} onBack={jest.fn()} onUpdateValue={onUpdateValue} onRefresh={jest.fn()} />

  it('shows the value today, the chart, the valuations newest first and the change since purchase', async () => {
    const onUpdateValue = jest.fn()
    const view = await renderScreen(detail(assetDetailFixture(), onUpdateValue))
    expect(view.getByText('Value today')).toBeOnTheScreen()
    expect(view.getByTestId('net-worth-chart')).toBeOnTheScreen()
    const valuations = within(view.getByTestId('asset-valuations')).getAllByLabelText(/^(Jun 1, 2026|Jan 10, 2025),/)
    expect(valuations.map((row) => row.props.accessibilityLabel)).toEqual(['Jun 1, 2026, €250,000.00, Agent estimate', 'Jan 10, 2025, €200,000.00'])
    expect(view.getByLabelText('Change since purchase, +€50,000.00 · +25%')).toBeOnTheScreen()
    expect(view.getByLabelText('Visibility, Shared with your household')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Update value' }))
    expect(onUpdateValue).toHaveBeenCalled()
  })

  it('shows the converted value for another currency, or says there is no rate', async () => {
    const converted = await renderScreen(detail(assetDetailFixture({ currency: 'USD', value: 300_000, valueInUserCurrency: 276_000 })))
    expect(converted.getByText(/276,000/)).toBeOnTheScreen()
    await converted.unmount()
    const noRate = await renderScreen(detail(assetDetailFixture({ currency: 'NGN', value: 90_000_000, valueInUserCurrency: null })))
    expect(noRate.getByText('1 asset is left out of the total: there is no exchange rate for NGN yet.')).toBeOnTheScreen()
    expect(noRate.queryByText(/€/)).not.toBeOnTheScreen()
  })

  it('marks a growth estimate and names the owner of a shared asset the viewer does not own', async () => {
    const view = await renderScreen(detail(assetDetailFixture({ value: 262_500, valueInUserCurrency: 262_500, growthRule: { annualRatePercent: 5, startDate: null }, isOwner: false, ownerFirstName: 'Rui' })))
    expect(view.getByText('Estimated from the yearly change since the valuation of Jun 1, 2026')).toBeOnTheScreen()
    expect(view.getByLabelText('Yearly change, +5%')).toBeOnTheScreen()
    expect(view.getByLabelText('Owner, Rui')).toBeOnTheScreen()
  })

  it('has nothing to update on an archived asset, which shows its last value', async () => {
    const view = await renderScreen(detail(assetDetailFixture({ archived: true, archivedAt: '2026-07-01T09:00:00.000Z', value: null, valueInUserCurrency: null })))
    expect(view.getByText('Last valued')).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Update value' })).not.toBeOnTheScreen()
  })

  it('shows no equity for an asset with no loan against it', async () => {
    const view = await renderScreen(detail())
    expect(view.queryByTestId('asset-equity')).not.toBeOnTheScreen()
  })

  it('shows the equity: value today less what is owed on the secured loans, then each loan', async () => {
    const view = await renderScreen(detail(assetDetailFixture({
      linkedLoans: [
        { loanKey: 3, name: 'Mortgage', currency: 'EUR', outstandingPrincipal: 150_000, outstandingPrincipalInAssetCurrency: 150_000 },
        { loanKey: 4, name: 'Family loan', currency: 'USD', outstandingPrincipal: 11_000, outstandingPrincipalInAssetCurrency: 10_000 },
      ],
      linkedDebt: 160_000,
      equity: 90_000,
    })))
    const equity = within(view.getByTestId('asset-equity'))
    expect(equity.getByRole('header', { name: 'Equity' })).toBeOnTheScreen()
    expect(equity.getByLabelText('Value today, €250,000.00')).toBeOnTheScreen()
    expect(equity.getByLabelText('Owed on secured loans, €160,000.00')).toBeOnTheScreen()
    expect(equity.getByLabelText('Equity, €90,000.00')).toBeOnTheScreen()
    expect(equity.getByLabelText('Mortgage, €150,000.00')).toBeOnTheScreen()
    // A loan in another currency in its own, with the API's conversion beside it.
    expect(equity.getByLabelText("Family loan, $11,000.00, €10,000.00 at today's rate")).toBeOnTheScreen()
    expect(equity.queryByText(/Underwater/)).not.toBeOnTheScreen()
  })

  it('marks negative equity with its minus sign and a note, not colour alone', async () => {
    const view = await renderScreen(detail(assetDetailFixture({
      linkedLoans: [{ loanKey: 3, name: 'Mortgage', currency: 'EUR', outstandingPrincipal: 270_000, outstandingPrincipalInAssetCurrency: 270_000 }],
      linkedDebt: 270_000,
      equity: -20_000,
    })))
    const equity = within(view.getByTestId('asset-equity'))
    expect(equity.getByLabelText('Equity, -€20,000.00')).toBeOnTheScreen()
    expect(equity.getByText('Underwater: more is owed on its loans than it is worth.')).toBeOnTheScreen()
  })

  it('says why there is no equity when a loan has no exchange rate, and shows no total', async () => {
    const view = await renderScreen(detail(assetDetailFixture({
      linkedLoans: [
        { loanKey: 3, name: 'Mortgage', currency: 'EUR', outstandingPrincipal: 150_000, outstandingPrincipalInAssetCurrency: 150_000 },
        { loanKey: 5, name: 'Naira loan', currency: 'NGN', outstandingPrincipal: 9_000_000, outstandingPrincipalInAssetCurrency: null },
      ],
      linkedDebt: null,
      equity: null,
      unconvertedLoanCurrencies: ['NGN'],
    })))
    const equity = within(view.getByTestId('asset-equity'))
    expect(equity.getByRole('alert')).toHaveTextContent('Equity cannot be worked out: there is no exchange rate from NGN to EUR yet.')
    expect(equity.getByLabelText('Owed on secured loans, —')).toBeOnTheScreen()
    expect(equity.getByLabelText('Equity, —')).toBeOnTheScreen()
    expect(equity.getByLabelText(/^Naira loan, NGN\s?9,000,000\.00$/)).toBeOnTheScreen()
  })

  it('reads an archived asset as having no equity', async () => {
    const view = await renderScreen(detail(assetDetailFixture({
      archived: true, archivedAt: '2026-07-01T09:00:00.000Z', value: null, valueInUserCurrency: null,
      linkedLoans: [{ loanKey: 3, name: 'Mortgage', currency: 'EUR', outstandingPrincipal: 150_000, outstandingPrincipalInAssetCurrency: 150_000 }],
      linkedDebt: 150_000,
      equity: null,
    })))
    const equity = within(view.getByTestId('asset-equity'))
    expect(equity.getByLabelText('Equity, —')).toBeOnTheScreen()
    expect(equity.getByText('An archived asset has no value today, so it has no equity.')).toBeOnTheScreen()
  })

  it('reads the equity in Portuguese', async () => {
    const view = await renderScreen(detail(assetDetailFixture({
      linkedLoans: [{ loanKey: 3, name: 'Crédito habitação', currency: 'EUR', outstandingPrincipal: 150_000, outstandingPrincipalInAssetCurrency: 150_000 }],
      linkedDebt: 150_000,
      equity: 100_000,
    })), 'pt-PT')
    expect(within(view.getByTestId('asset-equity')).getByRole('header', { name: 'Capital próprio' })).toBeOnTheScreen()
  })

  it('says a missing asset may be private to the other member, with no retry', async () => {
    const view = await renderScreen(<AssetDetailScreen state={{ status: 'not-found' }} onBack={jest.fn()} onUpdateValue={jest.fn()} onRefresh={jest.fn()} />)
    expect(view.getByText('It may have been deleted, or it is private to the other member of your household.')).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
  })
})

describe('Add asset', () => {
  const currencies = [{ currencyKey: 1, code: 'EUR', description: 'Euro' }, { currencyKey: 2, code: 'USD', description: 'US Dollar' }]

  it("starts in the viewer's currency and sends the asset once the required fields are valid", async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen(<AssetCreateScreen currencies={currencies} userCurrency="USD" loading={false} metadataError={false} pending={false} outcome={null} onBack={jest.fn()} onCreate={onCreate} />)
    expect(view.getByRole('button', { name: 'Add asset' })).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Name'), 'Car')
    await fireEvent.changeText(view.getByLabelText('Current value'), '18000')
    await fireEvent.changeText(view.getByLabelText('Yearly change in percent, optional'), '-15')
    await fireEvent.press(view.getByRole('switch', { name: 'Private asset' }))
    await fireEvent.press(view.getByRole('button', { name: 'Add asset' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      name: 'Car', kind: 'property', currencyKey: 2, value: 18_000, valuationDate: localToday(), isPrivate: true, growthRule: { annualRatePercent: -15 },
    }))
  })

  it('reads amounts in the app language and flags one it cannot read', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen(<AssetCreateScreen currencies={currencies} userCurrency="EUR" loading={false} metadataError={false} pending={false} outcome={null} onBack={jest.fn()} onCreate={onCreate} />, 'pt-PT')
    await fireEvent.changeText(view.getByLabelText('Nome'), 'Casa')
    await fireEvent.changeText(view.getByLabelText('Valor atual'), '250.000,50')
    await fireEvent.press(view.getByRole('button', { name: 'Adicionar bem' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ value: 250_000.5, currencyKey: 1 })))
    await fireEvent.changeText(view.getByLabelText('Preço de compra, opcional'), 'muito')
    expect(view.getByText('Introduz zero ou mais')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Adicionar bem' })).toBeDisabled()
  })

  it('sends the growth start date with the yearly change, and flags one that is not a day', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen(<AssetCreateScreen currencies={currencies} userCurrency="EUR" loading={false} metadataError={false} pending={false} outcome={null} onBack={jest.fn()} onCreate={onCreate} />)
    await fireEvent.changeText(view.getByLabelText('Name'), 'Flat')
    await fireEvent.changeText(view.getByLabelText('Current value'), '300000')
    await fireEvent.changeText(view.getByLabelText('Yearly change in percent, optional'), '2')
    expect(view.getByText('The value stays as it is until this date.')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Changes from'), 'soon')
    expect(view.getByText('Enter a valid date (YYYY-MM-DD).')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Add asset' })).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Changes from'), '2027-01-01')
    expect(view.queryByText('Enter a valid date (YYYY-MM-DD).')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Add asset' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ growthRule: { annualRatePercent: 2, startDate: '2027-01-01' } })))
  })

  it('shows why a save failed', async () => {
    const view = await renderScreen(<AssetCreateScreen currencies={currencies} userCurrency="EUR" loading={false} metadataError={false} pending={false} outcome="demo" onBack={jest.fn()} onCreate={jest.fn()} />)
    expect(view.getByText('The demo is read-only, so nothing was saved.')).toBeOnTheScreen()
  })
})

describe('Update value', () => {
  it('records the value for today with an optional note, and says it is no transaction', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen(<ValuationScreen assetName="Family home" currency="EUR" pending={false} outcome={null} onBack={jest.fn()} onSave={onSave} />)
    expect(view.getByText(/Recording a value never creates a transaction/)).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Save value' })).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Value'), '265000')
    await fireEvent.changeText(view.getByLabelText('Note, optional'), ' Agent ')
    await fireEvent.press(view.getByRole('button', { name: 'Save value' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ value: 265_000, date: localToday(), note: 'Agent' }))
  })
})

describe('Asset detail: edit, archive and delete', () => {
  afterEach(() => jest.restoreAllMocks())
  const actions = (over: Partial<ManualAssetManageActions> = {}): ManualAssetManageActions => ({
    pending: false,
    onEdit: jest.fn(),
    onSetArchived: jest.fn().mockResolvedValue(null),
    onDelete: jest.fn().mockResolvedValue(null),
    ...over,
  })
  const detail = (manage?: ManualAssetManageActions, data = assetDetailFixture()) => <AssetDetailScreen state={{ status: 'loaded', data }} onBack={jest.fn()} onUpdateValue={jest.fn()} onRefresh={jest.fn()} manage={manage} />
  // Answers the confirmation: the second button proceeds, the first cancels.
  const answer = (proceed: boolean) => jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => buttons?.[proceed ? 1 : 0]?.onPress?.())

  it('offers Edit beside Update value, and Archive and Delete under the details', async () => {
    const manage = actions()
    const view = await renderScreen(detail(manage))
    await fireEvent.press(view.getByRole('button', { name: 'Edit asset' }))
    expect(manage.onEdit).toHaveBeenCalled()
    expect(within(view.getByTestId('asset-manage')).getByRole('button', { name: 'Archive' })).toBeOnTheScreen()
    expect(within(view.getByTestId('asset-manage')).getByRole('button', { name: 'Delete asset' })).toBeOnTheScreen()
    // Correcting a valuation is still on the web; editing, archiving and deleting no longer are.
    expect(view.getByText('Correct or remove a valuation in WonderMoney on the web.')).toBeOnTheScreen()
  })

  it('offers none of them without the actions', async () => {
    const view = await renderScreen(detail())
    expect(view.queryByRole('button', { name: 'Edit asset' })).not.toBeOnTheScreen()
    expect(view.queryByTestId('asset-manage')).not.toBeOnTheScreen()
  })

  it('deletes only once confirmed, with the web warning', async () => {
    const manage = actions()
    const alert = answer(false)
    const view = await renderScreen(detail(manage))
    await fireEvent.press(view.getByRole('button', { name: 'Delete asset' }))
    await waitFor(() => expect(alert).toHaveBeenCalledWith(
      'Delete this asset?',
      'Its valuations go with it, and it leaves your net worth history. This cannot be undone.',
      [expect.objectContaining({ text: 'Cancel', style: 'cancel' }), expect.objectContaining({ text: 'Delete asset', style: 'destructive' })],
      expect.anything(),
    ))
    expect(manage.onDelete).not.toHaveBeenCalled()
    alert.mockImplementation((_title, _message, buttons) => buttons?.[1]?.onPress?.())
    await fireEvent.press(view.getByRole('button', { name: 'Delete asset' }))
    await waitFor(() => expect(manage.onDelete).toHaveBeenCalledTimes(1))
  })

  it('archives once confirmed, and brings an archived asset back without asking', async () => {
    const manage = actions()
    const alert = answer(true)
    const view = await renderScreen(detail(manage))
    await fireEvent.press(view.getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(manage.onSetArchived).toHaveBeenCalledWith(true))
    expect(alert).toHaveBeenCalledWith('Archive this asset?', 'It stops counting in net worth from today. Its history stays.', expect.anything(), expect.anything())
    await view.unmount()
    alert.mockClear()
    const archived = await renderScreen(detail(manage, assetDetailFixture({ archived: true, archivedAt: '2026-07-01T09:00:00.000Z', value: null, valueInUserCurrency: null })))
    // An archived asset can still be edited, but has no value to update.
    expect(archived.getByRole('button', { name: 'Edit asset' })).toBeOnTheScreen()
    expect(archived.queryByRole('button', { name: 'Update value' })).not.toBeOnTheScreen()
    await fireEvent.press(archived.getByRole('button', { name: 'Bring back' }))
    await waitFor(() => expect(manage.onSetArchived).toHaveBeenCalledWith(false))
    expect(alert).not.toHaveBeenCalled()
  })

  it('says the demo is read-only when it refuses a delete', async () => {
    answer(true)
    const view = await renderScreen(detail(actions({ onDelete: jest.fn().mockResolvedValue('demo') })))
    await fireEvent.press(view.getByRole('button', { name: 'Delete asset' }))
    expect(await within(view.getByTestId('asset-manage')).findByText('The demo is read-only, so nothing was saved.')).toBeOnTheScreen()
  })

  it('waits while a write is in flight', async () => {
    const view = await renderScreen(detail(actions({ pending: true })))
    expect(view.getByRole('button', { name: 'Edit asset' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Archive' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Delete asset' })).toBeDisabled()
  })

  it('leaves a crypto wallet to its own controls', async () => {
    const view = await renderScreen(detail(actions(), walletDetailFixture()))
    expect(view.queryByRole('button', { name: 'Edit asset' })).not.toBeOnTheScreen()
    expect(view.queryByTestId('asset-manage')).not.toBeOnTheScreen()
  })

  it('reads in Portuguese', async () => {
    const view = await renderScreen(detail(actions()), 'pt-PT')
    expect(view.getByRole('button', { name: 'Editar bem' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Eliminar bem' })).toBeOnTheScreen()
  })
})

describe('Edit asset', () => {
  const edit = (asset = assetFixture, onSave = jest.fn().mockResolvedValue(undefined), outcome: React.ComponentProps<typeof AssetEditScreen>['outcome'] = null) => (
    <AssetEditScreen state={{ status: 'loaded', asset }} pending={false} outcome={outcome} onBack={jest.fn()} onSave={onSave} />
  )

  it('starts from the asset, saves nothing until something changes, then sends only the change', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen(edit({ ...assetFixture, notes: 'Keys with Ana' }, onSave))
    expect(view.getByLabelText('Name').props.value).toBe('Family home')
    expect(view.getByLabelText('Purchase price, optional').props.value).toBe('200000')
    expect(view.getByLabelText('Notes, optional').props.value).toBe('Keys with Ana')
    // The currency and the value are not here: Update value changes the value.
    expect(view.queryByLabelText('Current value')).not.toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Name'), ' Beach house ')
    await fireEvent.press(view.getByRole('button', { name: 'Kind, Property' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Other' }))
    await fireEvent.changeText(view.getByLabelText('Yearly change in percent, optional'), '-2.5')
    await fireEvent.changeText(view.getByLabelText('Notes, optional'), '')
    await fireEvent.press(view.getByRole('switch', { name: 'Private asset' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      name: 'Beach house', kind: 'other', growthRule: { annualRatePercent: -2.5, startDate: null }, isPrivate: true, notes: null,
    }))
  })

  it('shows what is wrong and keeps the save disabled', async () => {
    const onSave = jest.fn()
    const view = await renderScreen(edit(assetFixture, onSave))
    await fireEvent.changeText(view.getByLabelText('Name'), '  ')
    expect(view.getByText('This field is required')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Name'), 'Family home')
    await fireEvent.changeText(view.getByLabelText('Purchase price, optional'), '-5')
    expect(view.getByText('Enter zero or more')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Purchase price, optional'), '')
    await fireEvent.changeText(view.getByLabelText('Yearly change in percent, optional'), '-100')
    expect(view.getByText('Enter a percentage above -100 and up to 1000')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('reads numbers in the app language', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen(edit({ ...assetFixture, purchasePrice: 200_000.5 }, onSave), 'pt-PT')
    expect(view.getByLabelText('Preço de compra, opcional').props.value).toBe('200000,5')
    await fireEvent.changeText(view.getByLabelText('Preço de compra, opcional'), '210.000,75')
    await fireEvent.press(view.getByRole('button', { name: 'Guardar alterações' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ purchasePrice: 210_000.75 }))
  })

  it("leaves privacy to the asset's owner, and says so", async () => {
    const view = await renderScreen(edit({ ...assetFixture, isOwner: false, ownerFirstName: 'Rui' }))
    expect(view.queryByRole('switch', { name: 'Private asset' })).not.toBeOnTheScreen()
    expect(view.getByText("Only the asset's owner can change whether it is private.")).toBeOnTheScreen()
  })

  it('shows why a save failed, the demo included', async () => {
    const view = await renderScreen(edit(assetFixture, jest.fn(), 'demo'))
    expect(view.getByText('The demo is read-only, so nothing was saved.')).toBeOnTheScreen()
  })

  it('says when the asset is gone', async () => {
    const view = await renderScreen(<AssetEditScreen state={{ status: 'not-found' }} pending={false} outcome={null} onBack={jest.fn()} onSave={jest.fn()} />)
    expect(view.getByText('This asset no longer exists, or it is private to the other member of your household.')).toBeOnTheScreen()
  })
})
