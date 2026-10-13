import type { NetWorthDto } from './net-worth-contract'

export type NetWorthCompleteness = 'partial' | 'unknown'

export type NetWorthSummaryViewModel = Readonly<NetWorthDto & {
  completeness: NetWorthCompleteness
}>

export const mapNetWorthSummary = (dto: NetWorthDto): NetWorthSummaryViewModel => ({
  ...dto,
  completeness: dto.unsupportedCurrencies.loans > 0
    || dto.unsupportedCurrencies.portfolios > 0
    ? 'partial'
    : 'unknown',
})
