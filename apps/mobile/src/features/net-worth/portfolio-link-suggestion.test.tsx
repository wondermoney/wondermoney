import { act, renderHook, waitFor } from '@testing-library/react-native'
import * as SecureStore from 'expo-secure-store'

import { showsPortfolioLinkSuggestion } from './portfolio-link-suggestion'
import {
  PORTFOLIO_LINK_SUGGESTION_DISMISSAL_KEY,
  PORTFOLIO_LINK_SUGGESTION_DISMISSAL_MS,
  usePortfolioLinkSuggestionDismissal,
} from './use-portfolio-link-suggestion-dismissal'

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }))
const getItem = SecureStore.getItemAsync as jest.Mock
const setItem = SecureStore.setItemAsync as jest.Mock

describe('"Is this the same money?" rule', () => {
  it('shows only when the API suggests it and the dismissal has been read and is not set', () => {
    expect(showsPortfolioLinkSuggestion({ suggested: true, dismissalLoaded: true, dismissed: false })).toBe(true)
    // false is the API's answer for a pair either member linked and for an account the viewer cannot see.
    expect(showsPortfolioLinkSuggestion({ suggested: false, dismissalLoaded: true, dismissed: false })).toBe(false)
    expect(showsPortfolioLinkSuggestion({ suggested: undefined, dismissalLoaded: true, dismissed: false })).toBe(false)
    expect(showsPortfolioLinkSuggestion({ suggested: true, dismissalLoaded: false, dismissed: false })).toBe(false)
    expect(showsPortfolioLinkSuggestion({ suggested: true, dismissalLoaded: true, dismissed: true })).toBe(false)
  })
})

describe('usePortfolioLinkSuggestionDismissal', () => {
  beforeEach(() => { getItem.mockReset(); setItem.mockReset(); setItem.mockResolvedValue(undefined) })

  it('remembers a dismissal on this device for a year, as web does in the browser', async () => {
    getItem.mockResolvedValue(null)
    const now = Date.now()
    const hook = await renderHook(() => usePortfolioLinkSuggestionDismissal())
    await waitFor(() => expect(hook.result.current.loaded).toBe(true))
    expect(hook.result.current.dismissed).toBe(false)
    expect(getItem).toHaveBeenCalledWith(PORTFOLIO_LINK_SUGGESTION_DISMISSAL_KEY)
    await act(async () => { hook.result.current.dismiss() })
    expect(hook.result.current.dismissed).toBe(true)
    const [key, until] = setItem.mock.calls[0]
    expect(key).toBe(PORTFOLIO_LINK_SUGGESTION_DISMISSAL_KEY)
    expect(Number(until) - now).toBeGreaterThanOrEqual(PORTFOLIO_LINK_SUGGESTION_DISMISSAL_MS)
    expect(PORTFOLIO_LINK_SUGGESTION_DISMISSAL_MS).toBe(365 * 24 * 60 * 60 * 1000)
  })

  it('stays dismissed until the stored time, and returns after it', async () => {
    getItem.mockResolvedValue(String(Date.now() + 60_000))
    const dismissed = await renderHook(() => usePortfolioLinkSuggestionDismissal())
    await waitFor(() => expect(dismissed.result.current.loaded).toBe(true))
    expect(dismissed.result.current.dismissed).toBe(true)

    getItem.mockResolvedValue(String(Date.now() - 60_000))
    const expired = await renderHook(() => usePortfolioLinkSuggestionDismissal())
    await waitFor(() => expect(expired.result.current.loaded).toBe(true))
    expect(expired.result.current.dismissed).toBe(false)
  })

  it('still dismisses for the session when the device storage fails', async () => {
    getItem.mockRejectedValue(new Error('locked'))
    setItem.mockRejectedValue(new Error('locked'))
    const hook = await renderHook(() => usePortfolioLinkSuggestionDismissal())
    await waitFor(() => expect(hook.result.current.loaded).toBe(true))
    await act(async () => { hook.result.current.dismiss() })
    expect(hook.result.current.dismissed).toBe(true)
  })
})
