import type { NetWorthDto } from './net-worth-contract'

export type NetWorthCompleteness = 'partial' | 'unknown'

export type NetWorthSummaryViewModel = Readonly<NetWorthDto & {
  completeness: NetWorthCompleteness
}>

export const mapNetWorthSummary = (dto: NetWorthDto): NetWorthSummaryViewModel => ({
  ...dto,
  // Tolerate a partial summary (an older cached shape): no rows reads as an empty breakdown.
  rows: Array.isArray(dto.rows) ? dto.rows : [],
  completeness: (dto.unsupportedCurrencies?.loans ?? 0) > 0
    || (dto.unsupportedCurrencies?.portfolios ?? 0) > 0
    ? 'partial'
    : 'unknown',
})
