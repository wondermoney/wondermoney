import { useEffect, useState } from 'react'

/**
 * RAD-238 (slice 1) — this codebase has no shared `src/lib/hooks` directory
 * yet, so this stays colocated with the one feature that needs it (ticker
 * search) rather than inventing a new top-level location for a single use.
 */
export function useDebouncedValue<Value>(value: Value, delayMs: number): Value {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debouncedValue
}
