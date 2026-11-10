import type { BankAlertDto } from '../bank-alerts-contract'
import {
  MAX_REMEMBERED_DISMISSALS,
  nextDismissedIds,
  orderBankAlerts,
  parseDismissedIds,
  selectBankAlertBanner,
} from '../bank-alerts-view-model'

const alert = (overrides: Partial<BankAlertDto> & Pick<BankAlertDto, 'id' | 'kind'>): BankAlertDto => ({
  institutionName: 'Bank',
  bankId: 'BANK',
  expiresAt: null,
  daysUntilExpiry: null,
  failingSince: null,
  ...overrides,
})

const revoked = alert({ id: 'revoked', kind: 'consent_revoked' })
const endsTomorrow = alert({ id: 'tomorrow', kind: 'consent_expiring', daysUntilExpiry: 1 })
const endsInWeek = alert({ id: 'week', kind: 'consent_expiring', daysUntilExpiry: 7 })
const endsInThree = alert({ id: 'three', kind: 'consent_expiring', daysUntilExpiry: 3 })
const failingOld = alert({ id: 'failing-old', kind: 'sync_failing', failingSince: '2026-11-01T00:00:00.000Z' })
const failingNew = alert({ id: 'failing-new', kind: 'sync_failing', failingSince: '2026-11-06T00:00:00.000Z' })

describe('orderBankAlerts', () => {
  it('puts ended access first, then consent ending within a day, failing syncs, and later consent ends', () => {
    const ordered = orderBankAlerts([endsInWeek, failingNew, endsInThree, endsTomorrow, failingOld, revoked])
    expect(ordered.map((item) => item.id)).toEqual(['revoked', 'tomorrow', 'failing-old', 'failing-new', 'three', 'week'])
  })

  it('keeps a stable order for alerts without dates', () => {
    const a = alert({ id: 'a', kind: 'sync_failing', failingSince: 'not a date' })
    const b = alert({ id: 'b', kind: 'sync_failing' })
    expect(orderBankAlerts([b, a, failingOld]).map((item) => item.id)).toEqual(['failing-old', 'a', 'b'])
  })
})

describe('selectBankAlertBanner', () => {
  it('shows nothing without alerts', () => {
    expect(selectBankAlertBanner([], new Set())).toBeNull()
  })

  it('leads with the most urgent alert and counts the rest', () => {
    expect(selectBankAlertBanner([endsInWeek, failingOld, revoked], new Set())).toEqual({
      primary: revoked,
      moreCount: 2,
      ids: ['revoked', 'failing-old', 'week'],
    })
  })

  it('leaves out dismissed alerts and hides once all are dismissed', () => {
    const banner = selectBankAlertBanner([endsInWeek, revoked], new Set(['revoked']))
    expect(banner).toEqual({ primary: endsInWeek, moreCount: 0, ids: ['week'] })
    expect(selectBankAlertBanner([endsInWeek, revoked], new Set(['revoked', 'week']))).toBeNull()
  })

  it('shows a new alert episode even when an earlier one was dismissed', () => {
    const nextEpisode = { ...revoked, id: 'revoked-2' }
    expect(selectBankAlertBanner([nextEpisode], new Set(['revoked']))?.primary).toBe(nextEpisode)
  })
})

describe('nextDismissedIds', () => {
  it('remembers the new ids plus earlier ones that still match a current alert', () => {
    expect(nextDismissedIds(new Set(['old-gone', 'kept']), ['new'], ['kept', 'new'])).toEqual(['new', 'kept'])
  })

  it('does not repeat an id and stays bounded', () => {
    expect(nextDismissedIds(new Set(['a']), ['a'], ['a'])).toEqual(['a'])
    const many = Array.from({ length: MAX_REMEMBERED_DISMISSALS + 10 }, (_, index) => `id-${index}`)
    expect(nextDismissedIds(new Set(), many, many)).toHaveLength(MAX_REMEMBERED_DISMISSALS)
  })
})

describe('parseDismissedIds', () => {
  it('reads a stored list and ignores anything unreadable', () => {
    expect(parseDismissedIds('["a","b"]')).toEqual(['a', 'b'])
    expect(parseDismissedIds('["a",3,null,""]')).toEqual(['a'])
    expect(parseDismissedIds('{"a":1}')).toEqual([])
    expect(parseDismissedIds('not json')).toEqual([])
    expect(parseDismissedIds(null)).toEqual([])
  })
})
