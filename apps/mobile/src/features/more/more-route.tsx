import * as Linking from 'expo-linking'
import { type Href, useRouter } from 'expo-router'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useServerSwitch } from '@/components/providers/server-switch-provider'
import { usePendingProposalCount } from '@/features/assistant-proposals/use-assistant-proposals'
import { useProfile } from '@/features/self/use-self-resource'
import { useServerBuildInfo } from '@/lib/server/use-instance'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { getRuntimeAppDisplayInfo } from './app-display-info'
import {
  buildFeedbackMailDestination,
  buildSupportMailDestination,
  externalDestinations,
  type FeedbackCategory,
  isApprovedExternalDestination,
} from './link-policy'
import { MoreScreen } from './more-screen'

const openApprovedExternal = async (destination: string) => {
  if (!isApprovedExternalDestination(destination)) throw new Error('Unapproved destination')
  await Linking.openURL(destination)
}

export function MoreRoute() {
  const appInfo = getRuntimeAppDisplayInfo()
  const router = useRouter()
  const { signOut } = useProductRuntime()
  const profile = useProfile()
  const serverInfo = useServerBuildInfo()
  const pendingChanges = usePendingProposalCount()
  // The changelog, legal pages and support inbox are wonder.money's; a self-hosted server's
  // users don't see them.
  const onHostedServer = useServerSwitch()?.usesDefaultServer ?? true
  return (
    <MoreScreen
      appInfo={appInfo}
      serverInfo={serverInfo}
      email={profile.data?.profile.emailAddress}
      onLogout={signOut}
      onOpenAccountsOverview={() => router.push('/accounts' as unknown as Href)}
      onOpenTransactions={() => router.push('/accounts/transactions' as unknown as Href)}
      onOpenRecurring={() => router.push('/accounts/recurring' as unknown as Href)}
      onOpenSettings={() => router.push('/settings/profile' as unknown as Href)}
      onOpenMarkets={() => router.push('/markets' as unknown as Href)}
      onOpenLoans={() => router.push('/loans' as unknown as Href)}
      onOpenAssets={() => router.push('/assets' as unknown as Href)}
      onOpenGoals={() => router.push('/goals' as unknown as Href)}
      onOpenReports={() => router.push('/reports' as unknown as Href)}
      pendingChanges={pendingChanges.available
        ? { count: pendingChanges.count, onOpen: () => router.push('/more/pending-changes' as unknown as Href) }
        : undefined}
      onOpenHelp={() => openApprovedExternal(externalDestinations.help)}
      {...(onHostedServer ? hostedOnlyActions(appInfo) : {})}
    />
  )
}

function hostedOnlyActions(appInfo: ReturnType<typeof getRuntimeAppDisplayInfo>) {
  return {
    onOpenWhatsNew: () => openApprovedExternal(externalDestinations.whatsNew),
    onOpenPrivacy: () => openApprovedExternal(externalDestinations.privacy),
    onOpenTerms: () => openApprovedExternal(externalDestinations.terms),
    onOpenSupport: async () => {
      if (!appInfo) throw new Error('App information unavailable')
      const destination = buildSupportMailDestination(appInfo)
      if (!destination) throw new Error('Support destination unavailable')
      await Linking.openURL(destination)
    },
    onSubmitFeedback: async (input: { category: FeedbackCategory; message: string }) => {
      if (!appInfo) throw new Error('App information unavailable')
      const destination = buildFeedbackMailDestination(appInfo, input)
      if (!destination) throw new Error('Feedback destination unavailable')
      await Linking.openURL(destination)
      // The category only. `input.message` is the user's own words
      // and stays in the mail channel it was written for; see link-policy.ts.
      captureAnalyticsEvent('feedback_submitted', { category: input.category })
    },
  }
}
