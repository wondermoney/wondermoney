/// <reference types="jest" />

declare global {
  /** Set by `jest.environment.js`: sets the test worker's real `TZ`, returning the one it replaced. */
  var __setTimeZone: ((zone: string | undefined) => string | undefined) | undefined
}

/**
 * Runs the enclosing `describe` block's tests with the device in `zone` (an IANA name), then
 * restores it. `Date` and `Intl` follow it at once, through the test environment's hook.
 */
export function inTimeZone(zone: string) {
  let previous: string | undefined
  beforeEach(() => {
    if (!globalThis.__setTimeZone) throw new Error('inTimeZone needs the test environment in jest.environment.js.')
    previous = globalThis.__setTimeZone(zone)
  })
  afterEach(() => {
    globalThis.__setTimeZone?.(previous)
  })
}
