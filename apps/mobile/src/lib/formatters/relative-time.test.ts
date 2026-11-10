import { initMobileI18n } from '@/lib/i18n'

import { formatRelativeTime, relativeTimeParts } from './relative-time'

const now = Date.parse('2026-11-05T12:00:00.000Z')
const ago = (seconds: number) => new Date(now - seconds * 1000)

describe('relative time', () => {
  it('words a distance as date-fns formatDistanceToNow does (web DataProvenance)', async () => {
    const { t } = await initMobileI18n('en')
    const format = (seconds: number) => formatRelativeTime(ago(seconds), t, { now })
    expect(format(10)).toBe('less than a minute ago')
    expect(format(60)).toBe('1 minute ago')
    expect(format(5 * 3600)).toBe('about 5 hours ago')
    expect(format(26 * 3600)).toBe('1 day ago')
    expect(format(3 * 86_400)).toBe('3 days ago')
    expect(format(45 * 86_400)).toBe('about 2 months ago')
    expect(format(400 * 86_400)).toBe('about 1 year ago')
  })

  it('words a calendar time as Intl.RelativeTimeFormat numeric auto does (web recurring)', async () => {
    const { t } = await initMobileI18n('en')
    const format = (seconds: number) => formatRelativeTime(ago(seconds), t, { now, style: 'calendar' })
    expect(format(0)).toBe('now')
    expect(format(5 * 3600)).toBe('5 hours ago')
    expect(format(26 * 3600)).toBe('yesterday')
    expect(format(3 * 86_400)).toBe('3 days ago')
  })

  it('localises, clamps future times to now and ignores invalid ones', async () => {
    const pt = await initMobileI18n('pt-PT')
    expect(formatRelativeTime(ago(26 * 3600), pt.t, { now })).toBe('há 1 dia')
    const es = await initMobileI18n('es')
    expect(formatRelativeTime(ago(5 * 3600), es.t, { now })).toBe('hace alrededor de 5 horas')
    expect(relativeTimeParts(new Date(now + 3_600_000), { now })).toEqual({ key: 'lessThanMinute' })
    expect(formatRelativeTime(null, es.t)).toBeNull()
    expect(formatRelativeTime('not a date', es.t)).toBeNull()
  })
})
