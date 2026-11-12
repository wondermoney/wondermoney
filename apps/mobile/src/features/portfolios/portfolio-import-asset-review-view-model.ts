import {
  isBlockingAssetGroup,
  PORTFOLIO_IMPORT_ASSET_MAPPING_BATCH_SIZE,
  type PortfolioImportAssetCandidateDto,
  type PortfolioImportAssetGroupDto,
  type PortfolioImportAssetMappingDecision,
} from './portfolio-import-contract'

/**
 * What the person picked for one group, held on the device until the whole review is sent. The
 * symbol travels with each pick only so the card can say what the group was mapped to.
 */
export type PortfolioImportAssetChoice =
  | Readonly<{ action: 'use_candidate'; candidateId: number; symbol: string }>
  | Readonly<{ action: 'use_external_symbol'; symbol: string }>
  | Readonly<{ action: 'use_existing_asset'; financialAssetId: number; symbol: string }>
  | Readonly<{ action: 'skip_group' }>

/** A security the household already holds in this portfolio, offered as a mapping target. */
export type PortfolioImportExistingAsset = Readonly<{ financialAssetId: number; name: string; symbol: string }>

export type SelectableCandidate = PortfolioImportAssetCandidateDto & Readonly<{ symbol: string }>

/** The groups the person has to decide: the ones the API blocks confirmation on. */
export function groupsNeedingReview(groups: readonly PortfolioImportAssetGroupDto[]): PortfolioImportAssetGroupDto[] {
  return groups.filter(isBlockingAssetGroup)
}

/** Listings the API will accept as `use_candidate`: one without a symbol is refused. */
export function selectableCandidates(group: PortfolioImportAssetGroupDto): SelectableCandidate[] {
  return group.candidates.filter((candidate): candidate is SelectableCandidate => Boolean(candidate.symbol?.trim()))
}

/** The broker's own name for the asset, or the next most specific thing the file carried. */
export function assetGroupTitle(group: PortfolioImportAssetGroupDto): string | null {
  const { brokerAssetName, brokerTicker, isin } = group.identity
  return brokerAssetName || brokerTicker || isin || null
}

/** The rest of what the file said about the asset (ticker, ISIN, venue, currency), title excluded. */
export function assetGroupDetails(group: PortfolioImportAssetGroupDto): string {
  const title = assetGroupTitle(group)
  const { brokerExchange, brokerTicker, currency, isin } = group.identity
  const details = [brokerTicker, isin, brokerExchange, currency].filter((value): value is string => Boolean(value) && value !== title)
  return [...new Set(details)].join(' · ')
}

/**
 * The server's recommendation (a unique ISIN-and-venue match) pre-selected for each group, as
 * web's review does; the person can still change it before sending.
 */
export function recommendedChoices(groups: readonly PortfolioImportAssetGroupDto[]): Record<number, PortfolioImportAssetChoice> {
  const choices: Record<number, PortfolioImportAssetChoice> = {}
  for (const group of groups) {
    if (group.recommendedCandidateId == null) continue
    const candidate = selectableCandidates(group).find((item) => item.id === group.recommendedCandidateId)
    if (candidate) choices[group.id] = { action: 'use_candidate', candidateId: candidate.id, symbol: candidate.symbol }
  }
  return choices
}

export function decisionForChoice(groupId: number, choice: PortfolioImportAssetChoice): PortfolioImportAssetMappingDecision {
  switch (choice.action) {
    case 'use_candidate': return { action: 'use_candidate', candidateId: choice.candidateId, groupId }
    case 'use_external_symbol': return { action: 'use_external_symbol', groupId, symbol: choice.symbol.trim() }
    case 'use_existing_asset': return { action: 'use_existing_asset', financialAssetId: choice.financialAssetId, groupId }
    case 'skip_group': return { action: 'skip_group', groupId }
  }
}

/** Requests of at most the API's per-request limit, in the order given. */
export function decisionBatches(decisions: readonly PortfolioImportAssetMappingDecision[]): PortfolioImportAssetMappingDecision[][] {
  const batches: PortfolioImportAssetMappingDecision[][] = []
  for (let start = 0; start < decisions.length; start += PORTFOLIO_IMPORT_ASSET_MAPPING_BATCH_SIZE) {
    batches.push(decisions.slice(start, start + PORTFOLIO_IMPORT_ASSET_MAPPING_BATCH_SIZE))
  }
  return batches
}
