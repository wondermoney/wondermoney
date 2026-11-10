export type BalanceSource = Readonly<{
  id: number
  date: string
  accountId: number
  /** The settled amount in the reader's currency. */
  amount: number | null
  /** The account's balance after this transaction, in the reader's currency. */
  convertedBalance: number | null
}>

export type BalancePoint = Readonly<{ x: number; balance: number }>

const endOfDay = (time: number) => {
  const date = new Date(time)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

/**
 * Web's `buildAccountTransactionsChartData` (balance series only): for each day
 * with activity, the sum over accounts of each account's latest balance by the
 * end of that day; an opening point at the range start and a closing point
 * today, so the line spans the whole period.
 */
export function buildBalanceSeries(rows: readonly BalanceSource[], fromDate?: string, now = Date.now()): BalancePoint[] {
  const txs = rows
    .filter((row) => row.convertedBalance !== null && Number.isFinite(Date.parse(row.date)))
    .map((row) => ({ ...row, time: Date.parse(row.date), balance: row.convertedBalance as number }))
    .sort((a, b) => a.time - b.time || a.id - b.id)
  if (txs.length === 0) return []
  const accountIds = [...new Set(txs.map((tx) => tx.accountId))]
  const balanceAt = (time: number) => accountIds.reduce((sum, accountId) => {
    let latest: number | null = null
    for (const tx of txs) {
      if (tx.accountId !== accountId) continue
      if (tx.time > time) break
      latest = tx.balance
    }
    return latest === null ? sum : sum + latest
  }, 0)
  const days = [...new Set(txs.map((tx) => endOfDay(tx.time)))]
  const points: BalancePoint[] = days.map((day) => ({ x: day, balance: balanceAt(day) }))
  const from = fromDate ? Date.parse(fromDate) : NaN
  if (Number.isFinite(from) && !days.includes(endOfDay(from)) && from < days[0]!) {
    const opening = accountIds.reduce((sum, accountId) => {
      const first = txs.find((tx) => tx.accountId === accountId)
      if (!first) return sum
      return sum + (first.id > 0 ? first.balance - (first.amount ?? 0) : first.balance)
    }, 0)
    points.unshift({ x: from, balance: opening })
  }
  const today = endOfDay(now)
  if (!days.includes(today) && today > points[points.length - 1]!.x) points.push({ x: today, balance: balanceAt(today) })
  return points
}
