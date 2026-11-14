import { previewAfterAssetMappings, previewWithAssetGroups } from './portfolio-import-api-payloads'
import {
  assetGroupDetails,
  assetGroupTitle,
  decisionBatches,
  decisionForChoice,
  groupsNeedingReview,
  recommendedChoices,
  selectableCandidates,
} from './portfolio-import-asset-review-view-model'
import { portfolioImportAssetMappingsWriteSchema, portfolioImportPreviewResponseSchema } from './portfolio-import-contract'

const groups = portfolioImportPreviewResponseSchema.parse(previewWithAssetGroups).assetGroups

describe('portfolio import asset review view model', () => {
  it('reviews the ambiguous, unmatched and provider-error groups only', () => {
    expect(groupsNeedingReview(groups).map((group) => group.id)).toEqual([1, 2, 3])
    const resolved = portfolioImportPreviewResponseSchema.parse(previewAfterAssetMappings).assetGroups
    expect(groupsNeedingReview(resolved).map((group) => group.id)).toEqual([1])
  })

  it('offers only listings with a symbol, since the API refuses the others', () => {
    expect(selectableCandidates(groups[0]!).map((candidate) => candidate.symbol)).toEqual(['EXF.AS', 'EXF.DE'])
    expect(selectableCandidates(groups[1]!)).toEqual([])
  })

  it('titles a group by what the file called the asset and lists the rest', () => {
    expect(assetGroupTitle(groups[0]!)).toBe('Example Fund')
    expect(assetGroupDetails(groups[0]!)).toBe('EXF · NL0000000001 · XAMS · EUR')
    expect(assetGroupTitle(groups[1]!)).toBe('ZZZQ')
    expect(assetGroupDetails(groups[1]!)).toBe('')
    expect(assetGroupTitle(groups[2]!)).toBe('Provider Down Corp')
    expect(assetGroupDetails(groups[2]!)).toBe('US0000000003')
    expect(assetGroupTitle({ ...groups[1]!, identity: { brokerAssetName: null, brokerExchange: null, brokerTicker: null, currency: null, isin: null } })).toBeNull()
  })

  it('pre-selects the server recommendation and nothing else', () => {
    expect(recommendedChoices(groupsNeedingReview(groups))).toEqual({ 1: { action: 'use_candidate', candidateId: 1, symbol: 'EXF.AS' } })
    // A recommendation pointing at a listing without a symbol cannot be sent, so it is not pre-selected.
    const unusable = { ...groups[0]!, recommendedCandidateId: 3 }
    expect(recommendedChoices([unusable])).toEqual({})
  })

  it('turns each choice into the decision the API takes', () => {
    const decisions = [
      decisionForChoice(1, { action: 'use_candidate', candidateId: 2, symbol: 'EXF.DE' }),
      decisionForChoice(2, { action: 'use_external_symbol', symbol: ' ZZZQ.US ' }),
      decisionForChoice(3, { action: 'use_existing_asset', financialAssetId: 1, symbol: 'AAPL' }),
      decisionForChoice(4, { action: 'skip_group' }),
    ]
    expect(decisions).toEqual([
      { action: 'use_candidate', candidateId: 2, groupId: 1 },
      { action: 'use_external_symbol', groupId: 2, symbol: 'ZZZQ.US' },
      { action: 'use_existing_asset', financialAssetId: 1, groupId: 3 },
      { action: 'skip_group', groupId: 4 },
    ])
    expect(portfolioImportAssetMappingsWriteSchema.safeParse({ decisions }).success).toBe(true)
  })

  it('splits decisions into requests of at most 100, in order', () => {
    const decisions = Array.from({ length: 250 }, (_, index) => decisionForChoice(index + 1, { action: 'skip_group' }))
    const batches = decisionBatches(decisions)
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50])
    expect(batches.flat()).toEqual(decisions)
    expect(batches.every((batch) => portfolioImportAssetMappingsWriteSchema.safeParse({ decisions: batch }).success)).toBe(true)
    expect(decisionBatches([])).toEqual([])
  })
})
