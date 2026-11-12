import { useTimedDismissal } from './use-timed-dismissal'

/**
 * "Dismiss" on the "Is this the same money?" suggestion: hidden on this device for a year, as web
 * hides it in the browser (`net-worth-portfolio-link-suggestion`, a year). Web keeps no server-side
 * record of it, so neither does the app.
 */
export const PORTFOLIO_LINK_SUGGESTION_DISMISSAL_KEY = 'wondermoney.net-worth.portfolio-link-suggestion.dismissed-until'
export const PORTFOLIO_LINK_SUGGESTION_DISMISSAL_MS = 365 * 24 * 60 * 60 * 1000

export function usePortfolioLinkSuggestionDismissal() {
  return useTimedDismissal(PORTFOLIO_LINK_SUGGESTION_DISMISSAL_KEY, PORTFOLIO_LINK_SUGGESTION_DISMISSAL_MS)
}
