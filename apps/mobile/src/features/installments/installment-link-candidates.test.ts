import { amountTolerance, isLinkableRow, linkCandidates, linkSearchFilters } from './installment-link-candidates'

const row = (transactionKey: number, day: string, settlementAmount: number, fields: Record<string, unknown> = {}) => ({
  transactionKey,
  transactionDate: `${day}T00:00:00.000Z`,
  settlementAmount,
  description: `Row ${transactionKey}`,
  ...fields,
})

const installment = { amount: 25, scheduledDate: '2026-11-05' }

describe('installment link candidates', () => {
  it('keeps charges of about the installment amount near its day, closest first', () => {
    const rows = [
      row(1, '2026-11-20', -26),
      row(2, '2026-11-06', -25),
      row(3, '2026-11-01', -25, { transactionMerchantKey: { name: 'Laptop shop' } }),
      row(4, '2026-11-05', -60), // another amount
      row(5, '2027-01-05', -25), // two months off
      row(6, '2026-11-05', 25), // money in
      row(7, '2026-11-05', -25, { hidden: true }),
      row(8, '2026-11-05', -25, { installment: { installmentPlanKey: 1, installmentNumber: 1, installmentCount: 4 } }),
      row(-1, '2026-11-05', -25), // a synthetic opening-balance row
    ]
    const candidates = linkCandidates(rows, installment)
    expect(candidates.map((candidate) => candidate.transactionKey)).toEqual([2, 3, 1])
    expect(candidates[1]).toMatchObject({ title: 'Laptop shop', day: '2026-11-01', amount: 25, amountDifference: 0, dayDistance: 4 })
    expect(candidates[2]).toMatchObject({ amountDifference: 1 })
  })

  it('shows every charge in the window with other amounts on', () => {
    const rows = [row(4, '2026-11-05', -60), row(2, '2026-11-06', -25)]
    expect(linkCandidates(rows, installment, { showAllAmounts: true }).map((candidate) => [candidate.transactionKey, candidate.amountDifference])).toEqual([[2, 0], [4, 35]])
  })

  it('allows 10% of the installment, at least one unit', () => {
    expect(amountTolerance(100)).toBe(10)
    expect(amountTolerance(4)).toBe(1)
    expect(linkCandidates([row(1, '2026-11-05', -4.99), row(2, '2026-11-05', -5.01)], { amount: 4, scheduledDate: '2026-11-05' }).map((candidate) => candidate.transactionKey)).toEqual([1])
  })

  it('searches posted charges a month either side of the scheduled day', () => {
    expect(linkSearchFilters('2026-11-05')).toEqual({
      fromDate: '2026-10-05T00:00:00.000Z',
      toDate: '2026-12-06T23:59:59.999Z',
      direction: 'out',
      statuses: ['BOOKED'],
      limit: 500,
    })
  })

  it('links only a real, visible charge that pays no installment', () => {
    expect(isLinkableRow(row(1, '2026-11-05', -1))).toBe(true)
    expect(isLinkableRow(row(1, '2026-11-05', 1))).toBe(false)
    expect(isLinkableRow(row(0, '2026-11-05', -1))).toBe(false)
    expect(isLinkableRow(row(1, '2026-11-05', -1, { settlementAmount: null }))).toBe(false)
  })
})
