import { portfolioResponseSchema, portfolioSettingsWriteSchema, portfolioTargetAllocationsEqual, type PortfolioSettingsWrite } from './portfolios-contract'

export type PortfolioSettingsReconciliation = 'applied' | 'not-applied' | 'uncertain'

export function reconcilePortfolioSettings(
  expectedPortfolioId: number,
  retainedPayload: Readonly<PortfolioSettingsWrite>,
  authoritativeResponse: unknown,
): PortfolioSettingsReconciliation {
  const payload = portfolioSettingsWriteSchema.safeParse(retainedPayload)
  const response = portfolioResponseSchema.safeParse(authoritativeResponse)
  if (!payload.success || !response.success || response.data.portfolio.portfolioKey !== expectedPortfolioId) return 'uncertain'

  const matches: boolean[] = []
  if (payload.data.name !== undefined) matches.push(response.data.portfolio.name === payload.data.name)
  if (payload.data.description !== undefined) {
    matches.push(payload.data.description === null
      ? response.data.portfolio.description == null
      : response.data.portfolio.description === payload.data.description)
  }
  if (payload.data.benchmarkSymbol !== undefined) {
    matches.push(payload.data.benchmarkSymbol === null
      ? response.data.portfolio.benchmarkSymbol == null
      : response.data.portfolio.benchmarkSymbol === payload.data.benchmarkSymbol)
  }
  if (payload.data.excluded !== undefined) matches.push(response.data.portfolio.excluded === payload.data.excluded)
  if (payload.data.favored !== undefined) matches.push(response.data.portfolio.favored === payload.data.favored)
  if (payload.data.targetAllocation !== undefined) {
    matches.push(portfolioTargetAllocationsEqual(payload.data.targetAllocation, response.data.portfolio.targetAllocation))
  }
  if (matches.length === 0) return 'uncertain'
  if (matches.every(Boolean)) return 'applied'
  if (matches.every((match) => !match)) return 'not-applied'
  return 'uncertain'
}
