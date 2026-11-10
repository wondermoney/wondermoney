import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { inTimeZone } from '@/test/time-zone'

import type { RecurringItemDto } from './recurring-contract'
import { RecurringScreen } from './recurring-screen'
import { mapRecurringItems, mapRecurringSummary } from './recurring-view-model'
import { recurringItemFixture, recurringSummaryFixture } from './test-fixtures'

async function renderScreen(items: RecurringItemDto[]) {
  const i18n = await initMobileI18n('en')
  const state = { status: 'loaded' as const, rows: mapRecurringItems({ items }), summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }
  return render(<I18nextProvider i18n={i18n}><RecurringScreen state={state} onBack={jest.fn()} onRefresh={jest.fn()} /></I18nextProvider>)
}

afterEach(() => jest.restoreAllMocks())

describe.each(['America/New_York', 'Asia/Tokyo'])('recurring dates, for a viewer in %s', (zone) => {
  inTimeZone(zone)

  it('shows a date-only booking\'s last paid and next expected on their own dates', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-20T12:00:00.000Z'))
    const view = await renderScreen([{ ...recurringItemFixture, lastSeenAt: '2026-10-01T00:00:00.000Z', nextExpectedAt: '2026-11-01T00:00:00.000Z' }])

    expect(view.getByText('Oct 1, 2026')).toBeOnTheScreen()
    expect(view.getByText('Nov 1, 2026')).toBeOnTheScreen()
    expect(view.getByText(/^Expected around Nov 1, 2026 ·/)).toBeOnTheScreen()
  })
})

describe('the upcoming timeline, for a viewer in New York', () => {
  inTimeZone('America/New_York')

  it('keeps a date-only payment expected today, and drops yesterday\'s', async () => {
    // 21:00 on 10 November in New York, already 11 November in UTC.
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-11T02:00:00.000Z'))
    const view = await renderScreen([
      { ...recurringItemFixture, displayName: 'Due today', nextExpectedAt: '2026-11-10T00:00:00.000Z' },
      { ...recurringItemFixture, recurringSeriesKey: 8, displayName: 'Due yesterday', nextExpectedAt: '2026-11-09T00:00:00.000Z' },
    ])

    expect(view.getByText(/^Expected around Nov 10, 2026 ·/)).toBeOnTheScreen()
    expect(view.queryByText(/^Expected around Nov 9, 2026/)).not.toBeOnTheScreen()
  })

  it('dates a payment with a real time on its local day', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-20T12:00:00.000Z'))
    const view = await renderScreen([{ ...recurringItemFixture, lastSeenAt: '2026-10-01T02:30:00.000Z', nextExpectedAt: null }])

    expect(view.getByText('Sep 30, 2026')).toBeOnTheScreen()
  })
})
