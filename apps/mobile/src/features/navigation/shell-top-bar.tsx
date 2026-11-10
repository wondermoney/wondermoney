import Constants from 'expo-constants'
import * as Linking from 'expo-linking'
import { type Href, usePathname, useRouter } from 'expo-router'

import { useOptionalProductRuntime } from '@/components/providers/product-runtime-provider'
import { useOptionalSessionPreferences } from '@/components/providers/session-preferences-provider'
import { isWithin, showsTopBar, type ShellSection, type ShellSectionPage } from '@/components/shell/navigation'
import { TopBar, type PersonMenuProps } from '@/components/shell/top-bar'
import { externalDestinations, isApprovedExternalDestination } from '@/features/more/link-policy'
import { useProfile } from '@/features/self/use-self-resource'

const APPROVED_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/**
 * The top bar, wired to the router, the session and the profile. Mounted once
 * in `(app)/_layout.tsx` above the stack, so every product page — tab screens,
 * section pages and detail pages — shares one bar, as on web. Flow routes
 * (create/edit/import…) hide it; see `showsTopBar`.
 */
export function ShellTopBar() {
  const pathname = usePathname()
  const runtime = useOptionalProductRuntime()
  if (!showsTopBar(pathname)) return null
  // A runtime (and with it the profile query) exists once signed in. Without
  // one — tests, a transition — the bar still renders, without the person.
  return runtime?.runtime ? <ConnectedTopBar pathname={pathname} /> : <ShellTopBarView pathname={pathname} person={null} />
}

function ConnectedTopBar({ pathname }: { pathname: string }) {
  const { signOut } = useOptionalProductRuntime() ?? {}
  const profile = useProfile().data?.profile
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ')
  return (
    <ShellTopBarView
      pathname={pathname}
      person={{ name, email: profile?.emailAddress ?? null, onSignOut: () => signOut?.() }}
    />
  )
}

function ShellTopBarView({
  pathname,
  person,
}: {
  pathname: string
  person: Pick<PersonMenuProps, 'name' | 'email' | 'onSignOut'> | null
}) {
  const router = useRouter()
  const preferences = useOptionalSessionPreferences()
  const version = Constants.expoConfig?.version
  const go = (href: string) => router.push(href as Href)

  const navigateSection = (page: ShellSectionPage, section: ShellSection) => {
    const href = page.href as Href
    if (page.tabRoot) {
      // Back to a tab screen: pop to it rather than stacking a copy on top.
      router.dismissTo(href)
      return
    }
    // Moving between two sibling pages replaces, so Back leaves the section
    // instead of walking through every tab pressed; from anywhere else it pushes.
    const onSiblingPage = section.pages.some((sibling) => !sibling.tabRoot && pathname === sibling.href)
    if (onSiblingPage) router.replace(href)
    else router.push(href)
  }

  return (
    <TopBar
      onNavigateSection={navigateSection}
      onPressLogo={() => {
        if (!isWithin(pathname, '/')) router.navigate('/' as Href)
      }}
      pathname={pathname}
      person={{
        name: person?.name ?? null,
        email: person?.email ?? null,
        version: version && APPROVED_VERSION.test(version) ? version : null,
        theme: preferences?.resolvedTheme ?? null,
        onToggleTheme: preferences
          ? () => preferences.setThemePreference(preferences.resolvedTheme === 'dark' ? 'light' : 'dark')
          : undefined,
        onOpenSettings: () => go('/settings/profile'),
        onOpenAppearance: () => go('/settings/preferences'),
        onOpenHelp: () => {
          if (isApprovedExternalDestination(externalDestinations.help)) void Linking.openURL(externalDestinations.help)
        },
        onSignOut: person?.onSignOut ?? (() => undefined),
      }}
    />
  )
}
