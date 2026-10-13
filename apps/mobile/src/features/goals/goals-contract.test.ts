import {
  archivedGoalsEndpoint,
  createGoalActivityEndpoint,
  createGoalAccountLinkEndpoint,
  createGoalAccountUnlinkEndpoint,
  createGoalArchiveEndpoint,
  createGoalAssignEndpoint,
  createGoalDetailEndpoint,
  createGoalMetadataEndpoint,
  createGoalMoveOutEndpoint,
  createGoalRestoreEndpoint,
  createGoalEndpoint,
  debtStrategyEndpoint,
  debtStrategyResponseSchema,
  goalActivityResponseSchema,
  goalDetailResponseSchema,
  goalListItemSchema,
  goalMetadataWriteSchema,
  goalCreateWriteSchema,
  goalReserveWriteSchema,
  goalsEndpoint,
  goalsResponseSchema,
  parseGoalId,
  parseGoalTargetDate,
  parseLocalizedGoalMoney,
} from './goals-contract'
import { debtStrategyFixture, goalFixture } from './test-fixtures'

describe('goals contract', () => {
  it('pins the read-only endpoint and preserves server order', () => {
    expect(goalsEndpoint).toMatchObject({ method: 'GET', path: '/v1/goals' })
    const parsed = goalsResponseSchema.parse({
      goals: [{ ...goalFixture, goalKey: 9 }, { ...goalFixture, goalKey: 2 }],
    })
    expect(parsed.goals.map((goal) => goal.goalKey)).toEqual([9, 2])
  })

  it('preserves explicit nulls and zero while accepting harmless additive fields', () => {
    const parsed = goalsResponseSchema.parse({
      goals: [{
        ...goalFixture,
        monthlyContributionTarget: null,
        targetAmount: 0,
        targetDate: null,
        summary: {
          ...goalFixture.summary,
          assignedThisMonth: 0,
          availableAmount: 0,
          monthlyShortfall: null,
          requiredMonthlyContribution: null,
          futureSummaryField: true,
        },
        futureGoalField: true,
      }],
      generatedAt: 'future',
    })
    expect(parsed.goals[0]).toMatchObject({
      monthlyContributionTarget: null,
      targetAmount: 0,
      targetDate: null,
      summary: { availableAmount: 0, monthlyShortfall: null },
    })
  })

  it.each([
    ['missing goals', {}],
    ['non-array goals', { goals: goalFixture }],
    ['missing links', { ...goalFixture, accountLinks: undefined }],
    ['bad link key', { ...goalFixture, accountLinks: [{ goalAccountLinkKey: 0, accountKey: { accountKey: 1, accountName: null } }] }],
    ['bad account key', { ...goalFixture, accountLinks: [{ goalAccountLinkKey: 1, accountKey: { accountKey: -1, accountName: null } }] }],
    ['missing account name', { ...goalFixture, accountLinks: [{ goalAccountLinkKey: 1, accountKey: { accountKey: 1 } }] }],
    ['lowercase currency', { ...goalFixture, currencyCode: 'eur' }],
    ['bad goal key', { ...goalFixture, goalKey: 0 }],
    ['nonfinite contribution', { ...goalFixture, monthlyContributionTarget: Infinity }],
    ['missing name', { ...goalFixture, name: undefined }],
    ['fractional priority', { ...goalFixture, priority: 1.2 }],
    ['bad lifecycle', { ...goalFixture, status: 'deleted' }],
    ['nonfinite summary', { ...goalFixture, summary: { ...goalFixture.summary, availableAmount: NaN } }],
    ['missing summary field', { ...goalFixture, summary: { ...goalFixture.summary, spentAmount: undefined } }],
    ['bad summary status', { ...goalFixture, summary: { ...goalFixture.summary, status: 'complete' } }],
    ['missing target', { ...goalFixture, targetAmount: undefined }],
    ['nonfinite target', { ...goalFixture, targetAmount: Infinity }],
    ['missing date', { ...goalFixture, targetDate: undefined }],
    ['invalid date', { ...goalFixture, targetDate: '2027-07-18' }],
  ])('rejects %s', (_label, candidate) => {
    const response = 'goals' in candidate ? candidate : { goals: [candidate] }
    expect(goalsResponseSchema.safeParse(response).success).toBe(false)
  })

  it('uses the endpoint-specific item schema', () => {
    expect(goalListItemSchema.safeParse(goalFixture).success).toBe(true)
  })

  it('strictly parses goal ids and pins detail and offset activity reads', () => {
    expect(parseGoalId('3')).toBe(3)
    for (const invalid of [undefined, ['3'], '03', '3.0', '-1', '9007199254740992']) expect(parseGoalId(invalid)).toBeNull()
    expect(createGoalDetailEndpoint(3)).toMatchObject({ method: 'GET', path: '/v1/goals/3' })
    const { summary, ...goal } = goalFixture
    expect(createGoalDetailEndpoint(3).schema.safeParse({ goal, summary }).success).toBe(true)
    expect(createGoalDetailEndpoint(3).schema.safeParse({ goal: { ...goal, goalKey: 4 }, summary }).success).toBe(false)
    expect(createGoalActivityEndpoint(3, 25)).toMatchObject({ method: 'GET', path: '/v1/goals/3/activity?limit=25&offset=25' })
    expect(() => createGoalDetailEndpoint(0)).toThrow()
    expect(() => createGoalActivityEndpoint(3, -1)).toThrow()
  })

  it('pins write paths, accepts the minimal link identity plus raw relation extras, and requires undefined 204', () => {
    const patch = createGoalMetadataEndpoint(3)
    const link = createGoalAccountLinkEndpoint(3, 42)
    const unlink = createGoalAccountUnlinkEndpoint(3, 42)
    expect(patch).toMatchObject({ method: 'PATCH', path: '/v1/goals/3' })
    expect(link).toMatchObject({ method: 'POST', path: '/v1/goals/3/accounts' })
    expect(unlink).toMatchObject({ method: 'DELETE', path: '/v1/goals/3/accounts/42' })
    expect(patch.schema.safeParse({ goal: { goalKey: 3, name: 'raw entity' } }).success).toBe(true)
    expect(patch.schema.safeParse({ goal: { goalKey: 4 } }).success).toBe(false)
    expect(link.schema.parse({ link: { goalAccountLinkKey: 9 } })).toEqual({ link: { goalAccountLinkKey: 9 } })
    expect(link.schema.safeParse({ link: { goalAccountLinkKey: 9, goalKey: { goalKey: 999, private: true }, accountKey: { accountKey: 777, balance: 'ignored' } } }).success).toBe(true)
    expect(link.schema.safeParse({ link: {} }).success).toBe(false)
    expect(link.schema.safeParse({ link: { goalAccountLinkKey: 0 } }).success).toBe(false)
    expect(unlink.schema.safeParse(undefined).success).toBe(true)
    expect(unlink.schema.safeParse({}).success).toBe(false)
  })

  it('allows only non-empty sparse metadata with trimmed names and four-decimal positive money', () => {
    expect(goalMetadataWriteSchema.parse({ name: '  Reserve  ' })).toEqual({ name: 'Reserve' })
    expect(goalMetadataWriteSchema.parse({ monthlyContributionTarget: null })).toEqual({ monthlyContributionTarget: null })
    expect(goalMetadataWriteSchema.safeParse({ targetAmount: 1.2345 }).success).toBe(true)
    for (const body of [
      {},
      { name: '   ' },
      { name: 'x'.repeat(101) },
      { targetAmount: 0 },
      { targetAmount: Infinity },
      { targetAmount: 1.23456 },
      { monthlyContributionTarget: -1 },
      { description: 'not writable' },
      { status: 'archived' },
      { targetDate: null },
      { currencyId: 1 },
      { priority: 1 },
      { availableAmount: 10 },
    ]) expect(goalMetadataWriteSchema.safeParse(body).success).toBe(false)
  })

  it('pins strict create body omission, date, money, and minimal positive identity response', () => {
    expect(createGoalEndpoint).toMatchObject({ method: 'POST', path: '/v1/goals', successStatuses: [201] })
    const targetDate = parseGoalTargetDate('2099-02-28', new Date('2026-07-20T00:00:00.000Z'))
    expect(targetDate).toBe('2099-02-28T00:00:00.000Z')
    expect(parseGoalTargetDate('2099-02-30', new Date('2026-07-20T00:00:00.000Z'))).toBeNull()
    expect(parseGoalTargetDate('2026-07-20', new Date('2026-07-20T00:00:00.000Z'))).toBeNull()
    const body = goalCreateWriteSchema.parse({ name: '  Home  ', targetAmount: 1.2345, targetDate })
    expect(body).toEqual({ name: 'Home', targetAmount: 1.2345, targetDate: '2099-02-28T00:00:00.000Z' })
    expect(body).not.toHaveProperty('currencyId')
    expect(body).not.toHaveProperty('description')
    expect(body).not.toHaveProperty('monthlyContributionTarget')
    expect(createGoalEndpoint.schema.parse({ goal: { goalKey: 42, currencyKey: { private: true }, tenantKey: 9 } })).toEqual({ goalId: 42 })
    expect(createGoalEndpoint.schema.parse({ goal: { goalKey: 42 }, additiveEnvelopeField: true })).toEqual({ goalId: 42 })
    for (const response of [{ goal: { goalKey: 0 } }, { goal: { goalKey: -1 } }, { goal: { goalKey: 1.5 } }, { goal: { goalKey: Number.MAX_SAFE_INTEGER + 1 } }, { goal: {} }]) {
      expect(createGoalEndpoint.schema.safeParse(response).success).toBe(false)
    }
    for (const invalid of [
      { name: ' ', targetAmount: 1 },
      { name: 'x'.repeat(101), targetAmount: 1 },
      { name: 'Home', targetAmount: 0 },
      { name: 'Home', targetAmount: Infinity },
      { name: 'Home', targetAmount: 1.23456 },
      { name: 'Home', targetAmount: 1, description: 'x'.repeat(501) },
      { name: 'Home', targetAmount: 1, monthlyContributionTarget: 0 },
      { name: 'Home', targetAmount: 1, monthlyContributionTarget: 1.23456 },
      { name: 'Home', targetAmount: 1, targetDate: '2099-02-28' },
      { name: 'Home', targetAmount: 1, currencyId: 1 },
    ]) expect(goalCreateWriteSchema.safeParse(invalid).success).toBe(false)
  })

  it('pins reserve write paths, bodies, and the actual goal plus summary success envelope', () => {
    const assign = createGoalAssignEndpoint(3)
    const moveOut = createGoalMoveOutEndpoint(3)
    expect(assign).toMatchObject({ method: 'POST', path: '/v1/goals/3/assign' })
    expect(moveOut).toMatchObject({ method: 'POST', path: '/v1/goals/3/move-out' })
    expect(goalReserveWriteSchema.parse({ amount: 12.3456 })).toEqual({ amount: 12.3456 })
    const response = { goal: { goalKey: 3, currencyKey: { code: 'EUR' }, privateRelation: true }, summary: goalFixture.summary }
    expect(assign.schema.safeParse(response).success).toBe(true)
    expect(moveOut.schema.safeParse(response).success).toBe(true)
    expect(assign.schema.safeParse({ goal: { goalKey: 4 }, summary: goalFixture.summary }).success).toBe(false)
    expect(assign.schema.safeParse({ goal: { goalKey: 3 } }).success).toBe(false)
    for (const body of [{}, { amount: 0 }, { amount: -1 }, { amount: Infinity }, { amount: 1.23456 }, { amount: 1, note: 'forbidden' }]) {
      expect(goalReserveWriteSchema.safeParse(body).success).toBe(false)
    }
  })

  it('pins the archived-goals read endpoint and the archive/restore write paths and envelopes', () => {
    expect(archivedGoalsEndpoint).toMatchObject({ method: 'GET', path: '/v1/goals?includeArchived=true' })
    const archive = createGoalArchiveEndpoint(3)
    const restore = createGoalRestoreEndpoint(3)
    expect(archive).toMatchObject({ method: 'DELETE', path: '/v1/goals/3' })
    expect(restore).toMatchObject({ method: 'POST', path: '/v1/goals/3/restore' })
    expect(archive.schema.safeParse({ goal: { goalKey: 3, status: 'archived' } }).success).toBe(true)
    expect(archive.schema.safeParse({ goal: { goalKey: 4 } }).success).toBe(false)
    expect(restore.schema.safeParse({ goal: { goalKey: 3, status: 'active' } }).success).toBe(true)
    expect(restore.schema.safeParse({ goal: { goalKey: 4 } }).success).toBe(false)
    expect(() => createGoalArchiveEndpoint(0)).toThrow(/goal id/i)
    expect(() => createGoalRestoreEndpoint(0)).toThrow(/goal id/i)
  })

  it('safely normalizes locale money with valid grouping and at most four decimals', () => {
    expect(parseLocalizedGoalMoney('1,234.5678', 'en')).toBe(1234.5678)
    expect(parseLocalizedGoalMoney('1 234,5678', 'pt-PT')).toBe(1234.5678)
    expect(parseLocalizedGoalMoney('1.234,5678', 'es')).toBe(1234.5678)
    expect(parseLocalizedGoalMoney('10,0', 'pt-PT')).toBe(10)
    for (const [value, locale] of [['1,23.45', 'en'], ['12.34,56', 'es'], ['1,23456', 'pt-PT'], ['0', 'en'], ['-1', 'en'], ['Infinity', 'en']] as const) {
      expect(parseLocalizedGoalMoney(value, locale)).toBeNull()
    }
  })

  it('does not require Intl formatToParts, which is unavailable in Hermes', () => {
    const original = Intl.NumberFormat.prototype.formatToParts
    Object.defineProperty(Intl.NumberFormat.prototype, 'formatToParts', { value: undefined, configurable: true })
    try {
      expect(parseLocalizedGoalMoney('1,234.5678', 'en')).toBe(1234.5678)
    } finally {
      Object.defineProperty(Intl.NumberFormat.prototype, 'formatToParts', { value: original, configurable: true })
    }
  })

  it('models the serialized detail response without web-only entity fields', () => {
    const { summary, monthlyContributionTarget: _monthlyContributionTarget, ...goal } = goalFixture
    const parsed = goalDetailResponseSchema.parse({
      goal: { ...goal, description: 'not exposed', icon: 'not exposed', createdAt: 'not exposed' },
      summary,
      unrelated: true,
    })
    expect(parsed.goal).not.toHaveProperty('description')
    expect(parsed.goal).not.toHaveProperty('icon')
    expect(parsed.goal).not.toHaveProperty('createdAt')
    expect(parsed.goal.monthlyContributionTarget).toBeNull()
    expect(parsed).toMatchObject({ goal: { goalKey: 3 }, summary: { status: 'behind' } })
  })

  it('keeps only safe raw activity fields and normalizes the populated currency code', () => {
    const parsed = goalActivityResponseSchema.parse({
      activities: [{
        goalActivityKey: 4,
        type: 'assigned',
        amount: 25,
        occurredAt: '2026-07-19T10:00:00.000Z',
        note: null,
        currencyKey: { currencyKey: 1, code: 'EUR', description: 'Euro' },
        goalKey: { private: 'relation' },
        tenantKey: { private: 'relation' },
      }],
      limit: 25,
      offset: 0,
      total: 1,
      unrelated: true,
    })
    expect(parsed.activities[0]).toEqual({
      goalActivityKey: 4,
      type: 'assigned',
      amount: 25,
      occurredAt: '2026-07-19T10:00:00.000Z',
      note: null,
      currencyCode: 'EUR',
    })
    expect(parsed.activities[0]).not.toHaveProperty('goalKey')
    expect(parsed.activities[0]).not.toHaveProperty('tenantKey')
  })

  it.each([
    ['unsafe activity id', { goalActivityKey: 0, type: 'assigned', occurredAt: '2026-07-19T10:00:00.000Z' }],
    ['unknown type', { goalActivityKey: 1, type: 'transferred', occurredAt: '2026-07-19T10:00:00.000Z' }],
    ['nonfinite amount', { goalActivityKey: 1, type: 'assigned', amount: Infinity, occurredAt: '2026-07-19T10:00:00.000Z' }],
    ['invalid date', { goalActivityKey: 1, type: 'assigned', occurredAt: '19 July' }],
    ['lowercase currency', { goalActivityKey: 1, type: 'assigned', occurredAt: '2026-07-19T10:00:00.000Z', currencyKey: { code: 'eur' } }],
  ])('rejects %s in activity', (_label, activity) => {
    expect(goalActivityResponseSchema.safeParse({ activities: [activity], limit: 25, offset: 0, total: 1 }).success).toBe(false)
  })
})

describe('debt strategy contract', () => {
  it('pins the read-only endpoint and parses the strict avalanche/snowball comparison', () => {
    expect(debtStrategyEndpoint).toMatchObject({ method: 'GET', path: '/v1/goals/debt-strategy' })
    expect(debtStrategyResponseSchema.parse(debtStrategyFixture)).toEqual(debtStrategyFixture)
  })
  it('allows both strategies to be null when there are fewer than two debts', () => {
    const ineligible = { debts: [debtStrategyFixture.debts[0]], extraBudget: 0, avalanche: null, snowball: null }
    expect(debtStrategyResponseSchema.parse(ineligible)).toEqual(ineligible)
  })
  it('allows a nullable months on a per-debt result that never pays off', () => {
    const withNeverPaysOff = {
      ...debtStrategyFixture,
      avalanche: { ...debtStrategyFixture.avalanche, perDebt: [{ id: 1, months: null, totalInterest: 0 }] },
    }
    expect(debtStrategyResponseSchema.safeParse(withNeverPaysOff).success).toBe(true)
  })
  it.each([
    ['non-finite balance', { ...debtStrategyFixture, debts: [{ ...debtStrategyFixture.debts[0], balance: Infinity }] }],
    ['unsafe debt id', { ...debtStrategyFixture, debts: [{ ...debtStrategyFixture.debts[0], id: 0 }] }],
    ['fractional strategy months', { ...debtStrategyFixture, avalanche: { ...debtStrategyFixture.avalanche, months: 1.5 } }],
    ['extra unknown field', { ...debtStrategyFixture, unexpected: true }],
  ])('rejects %s', (_label, response) => {
    expect(debtStrategyResponseSchema.safeParse(response).success).toBe(false)
  })
})
