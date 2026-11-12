import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Pressable as MockPressable, Text as MockText } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { previewAfterAssetMappings, previewWithAssetGroups } from './portfolio-import-api-payloads'
import { portfolioImportPreviewResponseSchema } from './portfolio-import-contract'
import { PortfolioImportScreen } from './portfolio-import-screen'
import type { PortfolioImportPhase } from './use-portfolio-import'

const palette = themeTokens.colors.light

// The screen only needs to exercise composition/gating around the review step; the ticker search
// itself (a real network-backed autocomplete) has its own dedicated test at
// portfolio-ticker-search-field.test.tsx, so it's stubbed here to a single deterministic pick.
// (Imports used by a jest.mock factory must be "mock"-prefixed so Jest's hoisting allows them.)
jest.mock('./portfolio-ticker-search-field', () => ({
  PortfolioTickerSearchField: ({ label, onSelect }: { label: string; onSelect: (result: { symbol: string }) => void }) => (
    <MockPressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onSelect({ symbol: 'XYZ' })}>
      <MockText>{label}</MockText>
    </MockPressable>
  ),
}))

const readyPreview = {
  assetGroups: [], importSessionId: 41, limits: { rowsPerBucket: 25 }, portfolioId: 7,
  rows: { duplicate: [], invalid: [], needsAssetReview: [], ready: [] },
  status: 'ready_to_import' as const,
  summary: { blockingRows: 0, canConfirm: true, duplicateRows: 1, failedRows: 0, importableRows: 3, importedRows: 0, invalidRows: 1, needsAssetReviewRows: 0, readyRows: 3, skippedRows: 0, totalRows: 5 },
}

// Captured API previews: ambiguous (1, recommended EXF.AS), unmatched (2, "ZZZQ") and
// provider-error (3, "Provider Down Corp") groups need review; group 4 matched on its own.
const reviewPreview = portfolioImportPreviewResponseSchema.parse(previewWithAssetGroups)
const holdings = [{ financialAssetId: 1, name: 'Apple', symbol: 'AAPL' }]

async function renderScreen(state: PortfolioImportPhase, overrides: Partial<React.ComponentProps<typeof PortfolioImportScreen>> = {}) {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof PortfolioImportScreen> = {
    state, onPickFile: jest.fn(), onConfirm: jest.fn(), onReset: jest.fn(), onBack: jest.fn(),
    onResolveAssetGroups: jest.fn(), resolvingAssetGroups: false, palette, ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><PortfolioImportScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('PortfolioImportScreen', () => {
  it('offers to choose a file when idle', async () => {
    const onPickFile = jest.fn()
    const { view } = await renderScreen({ phase: 'idle' }, { onPickFile })
    await fireEvent.press(view.getByRole('button', { name: 'Choose CSV file' }))
    expect(onPickFile).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['uploading', 'Uploading file…'],
    ['parsing', 'Reading your file…'],
    ['mapping', 'Matching columns…'],
  ] as const)('shows a progress indicator for the %s phase', async (phase, label) => {
    const { view } = await renderScreen({ phase })
    expect(view.getByRole('progressbar')).toHaveTextContent(label)
  })

  it('shows a progress indicator for the confirming phase', async () => {
    const { view } = await renderScreen({ phase: 'confirming', preview: readyPreview })
    expect(view.getByRole('progressbar')).toHaveTextContent('Importing transactions…')
  })

  it('shows the row-status summary and lets a ready import be confirmed', async () => {
    const onConfirm = jest.fn()
    const { view } = await renderScreen({ phase: 'review', preview: readyPreview }, { onConfirm })
    expect(view.getByLabelText('Ready to import: 3')).toBeOnTheScreen()
    expect(view.getByLabelText('Already imported: 1')).toBeOnTheScreen()
    expect(view.getByLabelText('Could not be read: 1')).toBeOnTheScreen()
    const confirmButton = view.getByRole('button', { name: 'Import transactions' })
    expect(confirmButton).not.toBeDisabled()
    await fireEvent.press(confirmButton)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables confirm and explains why when rows need asset review but no structured groups are available', async () => {
    const preview = { ...readyPreview, summary: { ...readyPreview.summary, canConfirm: false, needsAssetReviewRows: 2 } }
    const { view } = await renderScreen({ phase: 'review', preview })
    expect(view.getByRole('button', { name: 'Import transactions' })).toBeDisabled()
    expect(view.getByRole('alert')).toHaveTextContent(/manual matching/i)
  })

  it('disables confirm and explains why when nothing is importable', async () => {
    const preview = { ...readyPreview, summary: { ...readyPreview.summary, canConfirm: false, readyRows: 0, needsAssetReviewRows: 0 } }
    const { view } = await renderScreen({ phase: 'review', preview })
    expect(view.getByRole('alert')).toHaveTextContent(/no rows could be imported/i)
  })

  it('shows a success message with the imported count', async () => {
    const preview = { ...readyPreview, summary: { ...readyPreview.summary, importedRows: 3 } }
    const { view } = await renderScreen({ phase: 'succeeded', preview })
    expect(view.getByText('3 transactions imported.')).toBeOnTheScreen()
  })

  it.each([
    ['upload-failed', /could not upload the file/i],
    ['unmapped-columns', /could not automatically match/i],
    ['processing-failed', /could not process this file/i],
    ['general', /could not complete the import/i],
  ] as const)('surfaces the %s failure with a try-again action', async (reason, matcher) => {
    const onReset = jest.fn()
    const { view } = await renderScreen({ phase: 'failed', reason }, { onReset })
    expect(view.getByRole('alert')).toHaveTextContent(matcher)
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('disables navigation while an import is in flight', async () => {
    const { view } = await renderScreen({ phase: 'uploading' })
    expect(view.getByRole('button', { name: 'Back to portfolio' })).toBeDisabled()
  })

  it('reviews every open group: recommended listing pre-selected, ticker search, holding, then one batch', async () => {
    const onResolveAssetGroups = jest.fn()
    const { view } = await renderScreen({ phase: 'review', preview: reviewPreview }, { onResolveAssetGroups, existingAssets: holdings })

    expect(view.getByRole('button', { name: 'Import transactions' })).toBeDisabled()
    expect(view.getByText('Example Fund')).toBeOnTheScreen()
    expect(view.getByText('EXF · NL0000000001 · XAMS · EUR')).toBeOnTheScreen()
    expect(view.getByText('ZZZQ')).toBeOnTheScreen()
    expect(view.getByText('Provider Down Corp')).toBeOnTheScreen()
    expect(view.queryByText('Apple')).toBeNull()
    expect(view.getByLabelText('Mapped to EXF.AS')).toBeOnTheScreen()
    expect(view.getByText('1 of 3 resolved')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Confirm asset mappings' })).toBeDisabled()

    await fireEvent.press(view.getAllByRole('button', { name: 'Search for a ticker' })[0]!)
    await fireEvent.press(view.getByRole('button', { name: 'Choose a holding in this portfolio' }))
    await fireEvent.press(view.getByRole('radio', { name: 'AAPL' }))

    const submit = view.getByRole('button', { name: 'Confirm asset mappings' })
    expect(submit).not.toBeDisabled()
    await fireEvent.press(submit)
    expect(onResolveAssetGroups).toHaveBeenCalledWith([
      { action: 'use_candidate', candidateId: 1, groupId: 1 },
      { action: 'use_external_symbol', groupId: 2, symbol: 'XYZ' },
      { action: 'use_existing_asset', financialAssetId: 1, groupId: 3 },
    ])
  })

  it('lets a pre-selected group be changed to another listing or skipped', async () => {
    const onResolveAssetGroups = jest.fn()
    const preview = { ...reviewPreview, assetGroups: reviewPreview.assetGroups.filter((group) => group.id === 1) }
    const { view } = await renderScreen({ phase: 'review', preview }, { onResolveAssetGroups })

    await fireEvent.press(view.getByRole('button', { name: 'Change' }))
    // The listing without a symbol cannot be chosen, so it is not offered.
    expect(view.getByRole('button', { name: 'EXF.AS · Example Fund · AS' })).toBeOnTheScreen()
    expect(view.queryByText(/Nameless listing/)).toBeNull()
    expect(view.queryByRole('button', { name: 'Choose a holding in this portfolio' })).toBeNull()
    await fireEvent.press(view.getByRole('button', { name: 'EXF.DE · Example Fund · XETRA' }))
    expect(view.getByLabelText('Mapped to EXF.DE')).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'Change' }))
    await fireEvent.press(view.getByRole('button', { name: 'Skip this group' }))
    await fireEvent.press(view.getByRole('button', { name: 'Confirm asset mappings' }))
    expect(onResolveAssetGroups).toHaveBeenCalledWith([{ action: 'skip_group', groupId: 1 }])
  })

  it('does not ask again about groups the server matched, selected or skipped', async () => {
    const resolved = portfolioImportPreviewResponseSchema.parse(previewAfterAssetMappings)
    const preview = { ...resolved, assetGroups: resolved.assetGroups.filter((group) => group.id !== 1), summary: { ...resolved.summary, canConfirm: true } }
    const { view } = await renderScreen({ phase: 'review', preview })
    expect(view.queryByRole('button', { name: 'Confirm asset mappings' })).toBeNull()
    expect(view.getByRole('button', { name: 'Import transactions' })).not.toBeDisabled()
  })

  it('lists each row that failed in a partial import with its reason', async () => {
    const preview = {
      ...readyPreview,
      rows: { ...readyPreview.rows, failed: [
        { failureReason: 'Insufficient quantity to sell', id: 707, raw: { Symbol: 'AMD' }, rowNumber: 7, status: 'failed' as const },
        { id: 708, raw: { Symbol: 'X' }, rowNumber: 9, status: 'failed' as const },
      ] },
      status: 'partial' as const,
      summary: { ...readyPreview.summary, failedRows: 2, importedRows: 2 },
    }
    const { view } = await renderScreen({ phase: 'succeeded', preview })
    expect(view.getByText(/Some rows could not be imported/)).toBeOnTheScreen()
    expect(view.getByLabelText('Row 7: Insufficient quantity to sell')).toBeOnTheScreen()
    expect(view.getByLabelText('Row 9: No reason was recorded.')).toBeOnTheScreen()
  })

  it('shows no failed-rows list when the API predates the bucket', async () => {
    const { view } = await renderScreen({ phase: 'succeeded', preview: { ...readyPreview, status: 'succeeded' as const, summary: { ...readyPreview.summary, importedRows: 3 } } })
    expect(view.queryByTestId('portfolio-import-failed-row')).not.toBeOnTheScreen()
  })
})
