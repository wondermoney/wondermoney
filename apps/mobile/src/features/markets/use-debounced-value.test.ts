import { act, renderHook } from '@testing-library/react-native'

import { useDebouncedValue } from './use-debounced-value'

describe('useDebouncedValue', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns the initial value immediately', async () => {
    const value = 'a'
    const hook = await renderHook(() => useDebouncedValue(value, 300))
    expect(hook.result.current).toBe('a')
  })

  it('holds the previous value until the delay elapses, then updates', async () => {
    let value = 'a'
    const hook = await renderHook(() => useDebouncedValue(value, 300))
    value = 'ab'
    await hook.rerender({})
    expect(hook.result.current).toBe('a')

    await act(async () => { await jest.advanceTimersByTimeAsync(299) })
    expect(hook.result.current).toBe('a')

    await act(async () => { await jest.advanceTimersByTimeAsync(1) })
    expect(hook.result.current).toBe('ab')
  })

  it('resets the timer on every change, only committing the latest value', async () => {
    let value = 'a'
    const hook = await renderHook(() => useDebouncedValue(value, 300))
    value = 'ab'
    await hook.rerender({})
    await act(async () => { await jest.advanceTimersByTimeAsync(200) })
    value = 'abc'
    await hook.rerender({})
    await act(async () => { await jest.advanceTimersByTimeAsync(200) })
    expect(hook.result.current).toBe('a')

    await act(async () => { await jest.advanceTimersByTimeAsync(100) })
    expect(hook.result.current).toBe('abc')
  })

  it('clears the pending timer on unmount without throwing', async () => {
    let value = 'a'
    const hook = await renderHook(() => useDebouncedValue(value, 300))
    value = 'ab'
    await hook.rerender({})
    await hook.unmount()
    await act(async () => { await jest.advanceTimersByTimeAsync(300) })
  })
})
