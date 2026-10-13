import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Pressable as MockPressable, Text as MockText } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { PortfolioImportScreen } from './portfolio-import-screen'
import type { PortfolioImportAssetGroupDto } from './portfolio-import-contract'
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

const ambiguousGroup: PortfolioImportAssetGroupDto = {
  candidates: [{ financialAssetId: 501, name: 'Apple Inc', exchange: 'NASDAQ', symbol: 'AAPL' }],
  id: 1, isin: null, rawAssetName: 'Apple', rawSymbol: 'AAPL', rowCount: 2, status: 'ambiguous',
}
const unmatchedGroup: PortfolioImportAssetGroupDto = {
  candidates: [], id: 2, isin: null, rawAssetName: null, rawSymbol: 'ACME', rowCount: 1, status: 'unmatched',
}

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

  it('renders the asset review step and lets every group be resolved before submitting the batch', async () => {
    const onResolveAssetGroups = jest.fn()
    const preview = {
      ...readyPreview,
      assetGroups: [ambiguousGroup, unmatchedGroup],
      summary: { ...readyPreview.summary, canConfirm: false, needsAssetReviewRows: 3 },
    }
    const { view } = await renderScreen({ phase: 'review', preview }, { onResolveAssetGroups })

    expect(view.getByRole('button', { name: 'Import transactions' })).toBeDisabled()
    const submit = view.getByRole('button', { name: 'Confirm asset mappings' })
    expect(submit).toBeDisabled()

    await fireEvent.press(view.getByRole('button', { name: 'AAPL · Apple Inc · NASDAQ' }))
    expect(view.getByRole('button', { name: 'Confirm asset mappings' })).toBeDisabled()

    await fireEvent.press(view.getByRole('button', { name: 'Search for a ticker' }))
    expect(view.getByRole('button', { name: 'Confirm asset mappings' })).not.toBeDisabled()

    await fireEvent.press(view.getByRole('button', { name: 'Confirm asset mappings' }))
    expect(onResolveAssetGroups).toHaveBeenCalledWith([
      { assetGroupId: 1, resolution: { financialAssetId: 501, type: 'match' } },
      { assetGroupId: 2, resolution: { symbol: 'XYZ', type: 'external_symbol' } },
    ])
  })

  it('does not block the review UI on groups already matched automatically', async () => {
    const matchedGroup: PortfolioImportAssetGroupDto = { ...ambiguousGroup, id: 3, status: 'matched' }
    const preview = { ...readyPreview, assetGroups: [matchedGroup] }
    const { view } = await renderScreen({ phase: 'review', preview })
    expect(view.queryByRole('button', { name: 'Confirm asset mappings' })).toBeNull()
    expect(view.getByRole('button', { name: 'Import transactions' })).not.toBeDisabled()
  })
})
