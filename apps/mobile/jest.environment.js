'use strict'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TestEnvironment: ReactNativeEnvironment } = require('jest-expo/src/preset/nativeEnvironment')

/**
 * jest-expo's environment plus one hook, `__setTimeZone(zone)`, which sets the worker's own `TZ` and returns
 * the one it replaced (`undefined` unsets it).
 * A test's `process.env` is a copy Jest makes, so setting `TZ` there does not reach `Date` or
 * `Intl`; the real `process` here does, at once. `src/test/time-zone.ts` wraps it.
 */
class TimeZoneEnvironment extends ReactNativeEnvironment {
  constructor(config, context) {
    super(config, context)
    this.global.__setTimeZone = (zone) => {
      const previous = process.env.TZ
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
      return previous
    }
  }
}

module.exports = TimeZoneEnvironment
module.exports.TestEnvironment = TimeZoneEnvironment
