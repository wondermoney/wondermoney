import { mapTransactions } from './transactions-view-model'
import {
  amountToUnits,
  canSplitTransaction,
  decimalToUnits,
  draftFromSplits,
  fillRemainder,
  formatUnitsForInput,
  isSplitTransaction,
  newSplitLineId,
  sameSplitDraft,
  type SplitDraftLine,
  splitCategoryCount,
  splitEvenly,
  splitTotalUnits,
  startSplitDraft,
  summarizeSplit,
  toSplitRequest,
  unitsToDecimal,
  unitsToNumber,
} from './transactions-split-view-model'
import { transactionFixture } from './test-fixtures'

const line = (amount: string, categoryId: number | null = null, notes = ''): SplitDraftLine => ({
  id: newSplitLineId(),
  categoryId,
  amount,
  notes,
})

const splitLine = (overrides: Partial<Parameters<typeof draftFromSplits>[0][number]> = {}) => ({
  transactionSplitKey: 1,
  amount: -60,
  appuserAmount: -60,
  category: { categoryKey: 3, name: 'Groceries', isSystemCategory: true },
  notes: null as string | null,
  position: 0,
  ...overrides,
})

const row = (overrides: Partial<typeof transactionFixture> = {}) => mapTransactions({ transactions: [{ ...transactionFixture, ...overrides }] })[0]!

describe('split money arithmetic', () => {
  it('counts money in exact units of 0.0001 and writes it back without a float', () => {
    expect(decimalToUnits('12.5')).toBe(125000n)
    expect(decimalToUnits('-12.5')).toBe(-125000n)
    expect(decimalToUnits('0.0001')).toBe(1n)
    expect(decimalToUnits('1.23456')).toBeNull()
    expect(unitsToDecimal(125000n)).toBe('12.5')
    expect(unitsToDecimal(-125000n)).toBe('-12.5')
    expect(unitsToDecimal(1n)).toBe('0.0001')
    expect(unitsToDecimal(0n)).toBe('0')
    expect(amountToUnits(12.5)).toBe(125000n)
    expect(unitsToNumber(-125000n)).toBe(-12.5)
  })

  it('writes a magnitude into the input in the reader’s number format', () => {
    expect(formatUnitsForInput(-125000n, 'en')).toBe('12.5')
    expect(formatUnitsForInput(1250000n, 'pt-PT')).toBe('125')
    expect(formatUnitsForInput(-123456n, 'es')).toBe('12,3456')
  })
})

describe('summarizeSplit', () => {
  it('balances three lines that add up to the amount', () => {
    const summary = summarizeSplit([line('33.33'), line('33.33'), line('33.34')], 1000000n, 'en')
    expect(summary.assignedUnits).toBe(1000000n)
    expect(summary.remainingUnits).toBe(0n)
    expect(summary.problem).toBeNull()
  })

  it('reads lines as magnitudes and takes the transaction’s sign', () => {
    const summary = summarizeSplit([line('60'), line('40')], -1000000n, 'en')
    expect(summary.lines.map((result) => result.units)).toEqual([-600000n, -400000n])
    expect(summary.problem).toBeNull()
  })

  it('reports what is left to assign, signed like the total', () => {
    const summary = summarizeSplit([line('60'), line('30')], -1000000n, 'en')
    expect(summary.remainingUnits).toBe(-100000n)
    expect(summary.problem).toBe('unassigned')
  })

  it('reports an over-assigned split with the opposite sign', () => {
    const summary = summarizeSplit([line('60'), line('60')], 1000000n, 'en')
    expect(summary.remainingUnits).toBe(-200000n)
    expect(summary.problem).toBe('over-assigned')
  })

  it('needs at least two lines', () => {
    expect(summarizeSplit([line('100')], 1000000n, 'en').problem).toBe('too-few-lines')
  })

  it('blocks saving while a line is blank, unreadable, zero or too precise', () => {
    expect(summarizeSplit([line('100'), line('')], 1000000n, 'en').problem).toBe('line-errors')
    expect(summarizeSplit([line('100'), line('abc')], 1000000n, 'en').problem).toBe('line-errors')
    expect(summarizeSplit([line('100'), line('0')], 1000000n, 'en').problem).toBe('line-errors')
    expect(summarizeSplit([line('100'), line('1.23456')], 1000000n, 'en').problem).toBe('line-errors')
    expect(summarizeSplit([line('100'), line('1.23456')], 1000000n, 'en').lines[1]?.error).toBe('too-precise')
  })

  it('reads a percentage as a share of the transaction, rounded to the cent', () => {
    const summary = summarizeSplit([line('25%'), line('75%')], 1000000n, 'en')
    expect(summary.lines.map((result) => result.units)).toEqual([250000n, 750000n])
    expect(summary.problem).toBeNull()
  })

  it('reads amounts in the app’s language', () => {
    const summary = summarizeSplit([line('1.234,56'), line('65,44')], 13000000n, 'pt-PT')
    expect(summary.lines[0]?.units).toBe(12345600n)
    expect(summary.problem).toBeNull()
  })
})

describe('splitEvenly', () => {
  it('shares the amount in whole cents, the leftover cents going to the first lines', () => {
    const parts = splitEvenly(1000000n, 3)
    expect(parts).toEqual([333400n, 333300n, 333300n])
    expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(1000000n)
  })

  it('keeps a four-decimal total exact by giving the sub-cent to the first line', () => {
    const parts = splitEvenly(100001n, 3)
    expect(parts).toEqual([33401n, 33300n, 33300n])
    expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(100001n)
  })

  it('keeps the transaction’s sign', () => {
    expect(splitEvenly(-1000000n, 2)).toEqual([-500000n, -500000n])
  })

  it('returns nothing for no lines', () => {
    expect(splitEvenly(1000000n, 0)).toEqual([])
  })
})

describe('fillRemainder', () => {
  it('adds what is left to the line', () => {
    expect(fillRemainder(null, 400000n, 1000000n)).toBe(400000n)
    expect(fillRemainder(-600000n, -400000n, -1000000n)).toBe(-1000000n)
  })

  it('refuses a fill that would leave the line at zero or with the wrong sign', () => {
    expect(fillRemainder(null, 0n, 1000000n)).toBeNull()
    expect(fillRemainder(50000n, -100000n, 1000000n)).toBeNull()
  })
})

describe('toSplitRequest', () => {
  it('writes the signed decimal amounts, categories and trimmed notes the API takes', () => {
    const lines = [line('60', 3, '  Food  '), line('40', null, '   ')]
    const summary = summarizeSplit(lines, -1000000n, 'en')
    expect(toSplitRequest(lines, summary)).toEqual([
      { amount: '-60', categoryId: 3, notes: 'Food' },
      { amount: '-40', categoryId: null, notes: null },
    ])
  })

  it('refuses a line without an amount', () => {
    const lines = [line('60'), line('')]
    expect(() => toSplitRequest(lines, summarizeSplit(lines, 1000000n, 'en'))).toThrow()
  })
})

describe('drafts from a saved split', () => {
  it('keeps the API order and writes each line back as a magnitude', () => {
    const drafts = draftFromSplits([
      splitLine({ transactionSplitKey: 2, amount: -40, position: 1, notes: 'House' }),
      splitLine({ transactionSplitKey: 1, amount: -60, position: 0 }),
    ], 'en')
    expect(drafts.map((draft) => [draft.categoryId, draft.amount, draft.notes])).toEqual([
      [3, '60', ''],
      [3, '40', 'House'],
    ])
  })

  it('starts a new split with the current category and two empty amounts', () => {
    const drafts = startSplitDraft(row({ appuserSettlementAmount: -100, settlementAmount: -100 }))
    expect(drafts.map((draft) => [draft.categoryId, draft.amount])).toEqual([[3, ''], [null, '']])
  })

  it('compares drafts by what they would send, ignoring ids and blank notes', () => {
    expect(sameSplitDraft([line('60', 3, '  '), line('40', null)], [line('60', 3, ''), line('40', null)])).toBe(true)
    expect(sameSplitDraft([line('60', 3), line('40', null)], [line('60', 3), line('40', 4)])).toBe(false)
  })
})

describe('split facts on a row', () => {
  it('counts the categories a split uses, uncategorized counting once', () => {
    expect(splitCategoryCount([splitLine(), splitLine({ transactionSplitKey: 2, category: null }), splitLine({ transactionSplitKey: 3, category: null })])).toBe(2)
    expect(splitCategoryCount([])).toBe(0)
  })

  it('reads whether the row is split', () => {
    expect(isSplitTransaction(row())).toBe(false)
    expect(isSplitTransaction(row({ splits: [splitLine()] }))).toBe(true)
  })

  it('takes the amount to split from the settlement amount and the row’s direction', () => {
    expect(splitTotalUnits(row({ appuserSettlementAmount: -12.5, settlementAmount: -12.5 }))).toBe(-125000n)
    expect(splitTotalUnits(row({ appuserSettlementAmount: 12.5, settlementAmount: 12.5 }))).toBe(125000n)
    expect(splitTotalUnits(row({ settlementAmount: null }))).toBeNull()
    expect(splitTotalUnits(row({ settlementAmount: 0 }))).toBeNull()
  })

  it('offers a split only on a persisted row with an amount that is not a loan repayment', () => {
    expect(canSplitTransaction(row())).toBe(true)
    expect(canSplitTransaction(row({ transactionKey: -7 }))).toBe(false)
    expect(canSplitTransaction(row({ settlementAmount: null }))).toBe(false)
    expect(canSplitTransaction(row({ loanRepayment: { loanKey: 2, loanKeys: [2], loanName: 'Car', principalAmount: 8, interestAmount: 2, feeAmount: 0, spendingAmount: 2 } }))).toBe(false)
  })
})
