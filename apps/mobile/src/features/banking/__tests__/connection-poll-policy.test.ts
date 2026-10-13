import { PROCESSING_POLL_INTERVAL_MS, PROCESSING_POLL_TIMEOUT_MS, resolveConnectionsPollIntervalMs } from '../connection-poll-policy'

const processingRow = { status: 'processing' } as const
const connectedRow = { status: 'connected' } as const

describe('resolveConnectionsPollIntervalMs', () => {
  it('does not poll when there is no data yet', () => {
    expect(resolveConnectionsPollIntervalMs(undefined, null, 0)).toBe(false)
  })

  it('does not poll when nothing is processing', () => {
    expect(resolveConnectionsPollIntervalMs([connectedRow], null, 0)).toBe(false)
  })

  it('polls at the fixed interval while a connection is processing and freshly seen', () => {
    expect(resolveConnectionsPollIntervalMs([processingRow], 1_000, 1_500)).toBe(PROCESSING_POLL_INTERVAL_MS)
  })

  it('stops polling once the processing state has outlasted the bounded timeout', () => {
    const processingSince = 0
    const now = PROCESSING_POLL_TIMEOUT_MS + 1
    expect(resolveConnectionsPollIntervalMs([processingRow], processingSince, now)).toBe(false)
  })

  it('keeps polling exactly at the timeout boundary', () => {
    expect(resolveConnectionsPollIntervalMs([processingRow], 0, PROCESSING_POLL_TIMEOUT_MS)).toBe(PROCESSING_POLL_INTERVAL_MS)
  })
})
