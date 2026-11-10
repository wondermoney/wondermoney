import type { EntityMarkSource } from '@/components/ui/entity-mark'

import type { RecentTransactionDto } from './recent-transactions-contract'
import { transactionMark } from './transaction-mark'

/** Sign expressed as text so it never depends on colour alone. Zero has no direction. */
export type RecentTransactionDirection = 'credit' | 'debit' | null

export type RecentTransactionRow =
  | Readonly<{
      kind: 'persisted'
      displayName: string | null
      occurredAt: string | null
      amount: number | null
      currencyCode: string | null
      direction: RecentTransactionDirection
      /** Category, transfer arrows or the uncategorised tag. Absent from rows built before the API sent it. */
      mark?: EntityMarkSource
    }>
  | Readonly<{
      kind: 'synthetic-initial-balance'
      occurredAt: string | null
      amount: number | null
      currencyCode: string | null
    }>

function directionOf(amount: number | null): RecentTransactionDirection {
  if (amount === null || amount === 0) return null
  return amount > 0 ? 'credit' : 'debit'
}

export function mapRecentTransactions(dtos: readonly RecentTransactionDto[]): readonly RecentTransactionRow[] {
  return dtos.map((dto): RecentTransactionRow => {
    if (dto.entryType === 'synthetic_initial_balance') {
      return {
        kind: 'synthetic-initial-balance',
        occurredAt: dto.occurredAt,
        amount: dto.amount,
        currencyCode: dto.currencyCode,
      }
    }
    return {
      kind: 'persisted',
      displayName: dto.displayName,
      occurredAt: dto.occurredAt,
      amount: dto.amount,
      currencyCode: dto.currencyCode,
      direction: directionOf(dto.amount),
      mark: transactionMark({
        transfer: dto.transfer === true,
        category: dto.category ? { name: dto.category.icon, bgColor: dto.category.bgColor, textColor: dto.category.textColor } : null,
      }),
    }
  })
}
