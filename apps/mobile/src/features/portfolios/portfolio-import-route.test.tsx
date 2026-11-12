import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { previewWithAssetGroups } from './portfolio-import-api-payloads'
import { portfolioImportPreviewResponseSchema } from './portfolio-import-contract'
import { PortfolioImportRoute } from './portfolio-import-route'

const mockReplace = jest.fn()
const mockUsePreventRemove = jest.fn((_preventRemove: boolean, _onPrevented?: (options: { data: { action: object }; repeat: () => void }) => void) => jest.fn())
const mockGetDocumentAsync = jest.fn()
const mockStart = jest.fn()
const mockConfirm = jest.fn()
const mockReset = jest.fn()
const mockUseExistingAssets = jest.fn((_portfolioId: number, _enabled: boolean) => [] as readonly { financialAssetId: number; name: string; symbol: string }[])
let mockParams: Record<string, string | string[] | undefined> = {}
let mockImportState: { state: { phase: string; preview?: unknown }; start: typeof mockStart; confirm: typeof mockConfirm; reset: typeof mockReset } = {
  state: { phase: 'idle' }, start: mockStart, confirm: mockConfirm, reset: mockReset,
}

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ replace: mockReplace }), usePreventRemove: (preventRemove: boolean, onPrevented?: (options: { data: { action: object }; repeat: () => void }) => void) => mockUsePreventRemove(preventRemove, onPrevented) }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args) }))
// The review's ticker search is network-backed and tested on its own (portfolio-ticker-search-field.test.tsx).
jest.mock('./portfolio-ticker-search-field', () => ({ PortfolioTickerSearchField: () => null }))
jest.mock('./use-portfolio-import', () => ({
  usePortfolioImport: () => mockImportState,
  usePortfolioImportExistingAssets: (portfolioId: number, enabled: boolean) => mockUseExistingAssets(portfolioId, enabled),
}))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><PortfolioImportRoute /></I18nextProvider>)
}

describe('PortfolioImportRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset(); mockUsePreventRemove.mockClear()
    mockGetDocumentAsync.mockReset(); mockStart.mockReset(); mockConfirm.mockReset(); mockReset.mockReset()
    mockUseExistingAssets.mockClear()
    mockParams = { portfolioId: '7' }
    mockImportState = { state: { phase: 'idle' }, start: mockStart, confirm: mockConfirm, reset: mockReset }
  })

  it('shows an invalid-id failure and never mounts a picker for a malformed portfolio id', async () => {
    mockParams = { portfolioId: '03' }
    const view = await renderRoute()
    expect(view.getByText('Portfolio not available')).toBeOnTheScreen()
    expect(mockGetDocumentAsync).not.toHaveBeenCalled()
  })

  it('starts the import with the picked file', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///a.csv', name: 'a.csv' }] })
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Choose CSV file' }))
    expect(mockGetDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ type: expect.arrayContaining(['text/csv']) }))
    expect(mockStart).toHaveBeenCalledWith({ uri: 'file:///a.csv', name: 'a.csv' })
  })

  it('never starts the import when the picker is cancelled', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null })
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Choose CSV file' }))
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('navigates back to the portfolio on back and done', async () => {
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Back to portfolio' }))
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/portfolio/[portfolioId]', params: { portfolioId: '7' } })
  })

  it('guards navigation away while an import is in flight, but not once it settles', async () => {
    mockImportState = { state: { phase: 'parsing' }, start: mockStart, confirm: mockConfirm, reset: mockReset }
    await renderRoute()
    expect(mockUsePreventRemove.mock.lastCall?.[0]).toBe(true)

    const preview = {
      assetGroups: [], importSessionId: 41, limits: { rowsPerBucket: 25 }, portfolioId: 7,
      rows: { duplicate: [], invalid: [], needsAssetReview: [], ready: [] },
      status: 'ready_to_import', summary: { blockingRows: 0, canConfirm: true, duplicateRows: 0, failedRows: 0, importableRows: 1, importedRows: 0, invalidRows: 0, needsAssetReviewRows: 0, readyRows: 1, skippedRows: 0, totalRows: 1 },
    }
    mockImportState = { state: { phase: 'review', preview }, start: mockStart, confirm: mockConfirm, reset: mockReset }
    await renderRoute()
    expect(mockUsePreventRemove.mock.lastCall?.[0]).toBeFalsy()
  })

  it('loads the portfolio holdings only while groups need review, and offers them there', async () => {
    await renderRoute()
    expect(mockUseExistingAssets.mock.lastCall).toEqual([7, false])

    mockUseExistingAssets.mockReturnValue([{ financialAssetId: 1, name: 'Apple', symbol: 'AAPL' }])
    mockImportState = { state: { phase: 'review', preview: portfolioImportPreviewResponseSchema.parse(previewWithAssetGroups) }, start: mockStart, confirm: mockConfirm, reset: mockReset }
    const view = await renderRoute()
    expect(mockUseExistingAssets.mock.lastCall).toEqual([7, true])
    expect(view.getAllByRole('button', { name: 'Choose a holding in this portfolio' }).length).toBeGreaterThan(0)
  })
})
