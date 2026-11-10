/**
 * The product sections that have sibling pages, as web's
 * `components/layout/navigation.ts` lists them, mapped onto the mobile routes.
 * Inside one of these, the top bar shows its pages as an underlined tab row.
 *
 * `tabRoot` marks a page that lives in the `(tabs)` group, so going back to it
 * is a dismiss rather than a push.
 */
export type ShellSectionPage = {
  id: string
  labelKey: string
  href: string
  tabRoot?: boolean
}

export type ShellSection = {
  id: string
  labelKey: string
  href: string
  pages: ShellSectionPage[]
}

export const SHELL_SECTIONS: ShellSection[] = [
  {
    id: 'accounts',
    labelKey: 'navigation.accounts',
    href: '/accounts',
    pages: [
      { id: 'accounts.overview', labelKey: 'navigation.overview', href: '/accounts', tabRoot: true },
      { id: 'accounts.transactions', labelKey: 'navigation.transactions', href: '/accounts/transactions' },
      { id: 'accounts.recurring', labelKey: 'navigation.billsSubscriptions', href: '/accounts/recurring' },
    ],
  },
  {
    id: 'portfolio',
    labelKey: 'navigation.portfolio',
    href: '/portfolio',
    pages: [
      { id: 'portfolio.overview', labelKey: 'navigation.overview', href: '/portfolio', tabRoot: true },
      { id: 'portfolio.transactions', labelKey: 'navigation.transactions', href: '/portfolio/activity' },
    ],
  },
  {
    id: 'financial-markets',
    labelKey: 'navigation.financialMarkets',
    href: '/markets',
    pages: [
      { id: 'financial-markets.explorer', labelKey: 'navigation.explorer', href: '/markets' },
      { id: 'financial-markets.watchlist', labelKey: 'navigation.watchlist', href: '/markets/watchlist' },
    ],
  },
]

/** A destination is current on its own path and everything under it; Home only on `/`. */
export function isWithin(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** The section whose tab row belongs on this path, if any. */
export function currentSection(pathname: string, sections = SHELL_SECTIONS): ShellSection | undefined {
  return sections.find((section) => isWithin(pathname, section.href))
}

/** The one current page in a section: the longest matching href wins. */
export function currentPage(section: ShellSection, pathname: string): ShellSectionPage | undefined {
  return [...section.pages]
    .filter((page) => isWithin(pathname, page.href))
    .sort((a, b) => b.href.length - a.href.length)[0]
}

/**
 * Flow routes — create, edit, import, scan, connect — are single-decision
 * screens with their own back control and no product chrome, like web's
 * `(no-layout)` routes. Everything else under `(app)` gets the top bar.
 */
const FLOW_SEGMENT = /\/(create|edit|import|scan|connect|add|transaction-create)(\/|$)/
/**
 * Flows whose last segment is a noun rather than a verb: a budget's linked
 * accounts, a portfolio's settings and an asset's Update value. Anchored to their parent so the
 * Accounts tab and the Settings pages keep the top bar.
 */
const FLOW_ROUTES = [/^\/budgets\/[^/]+\/accounts\/?$/, /^\/portfolio\/[^/]+\/settings\/?$/, /^\/assets\/[^/]+\/value\/?$/]

export function showsTopBar(pathname: string): boolean {
  if (pathname.startsWith('/onboarding')) return false
  if (FLOW_ROUTES.some((route) => route.test(pathname))) return false
  return !FLOW_SEGMENT.test(pathname)
}
