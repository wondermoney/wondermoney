import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import type { IconName } from '@/components/ui/icon'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { FeedbackDialog } from './feedback-dialog'
import { SettingsGroup, SettingsNavRow } from './settings-ui'
import type { AppDisplayInfo, FeedbackCategory } from './link-policy'
import { formatBuild, formatVersionInfo } from './version-info'

type MoreAction = 'privacy' | 'terms' | 'support' | 'help' | 'whatsNew'

export type MoreScreenProps = {
  appInfo: AppDisplayInfo | null
  /** The connected server's build (`GET /v1/instance`); null while it loads or on an older server. */
  serverInfo?: { commit: string | null; version: string | null } | null
  email?: string | null
  onOpenHelp: () => Promise<void>
  /**
   * The hosted instance's changelog, legal pages and support inbox. A self-hosted server has
   * its own (or none), so the route leaves these out and their rows are not shown.
   */
  onOpenWhatsNew?: () => Promise<void>
  onOpenPrivacy?: () => Promise<void>
  onOpenTerms?: () => Promise<void>
  onOpenSupport?: () => Promise<void>
  onOpenAccountsOverview: () => void
  onOpenTransactions: () => void
  onOpenRecurring: () => void
  /** Settings opens on Profile, like web's `/settings`; its section select reaches the rest. */
  onOpenSettings: () => void
  onOpenMarkets: () => void
  onOpenLoans: () => void
  onOpenAssets: () => void
  onOpenGoals: () => void
  onOpenReports: () => void
  /**
   * Changes the assistant or an MCP client proposed, waiting for the person. Left out when AI
   * is hidden or the server has no proposals, and the row is not shown.
   */
  pendingChanges?: { count: number; onOpen: () => void }
  onLogout: () => void | Promise<void>
  onSubmitFeedback?: (input: { category: FeedbackCategory; message: string }) => Promise<void>
}

/**
 * Web's mobile "More" sheet (`components/layout/BottomNavMoreSheet.tsx`) as a settings
 * list: the person, the Accounts pages, the other destinations (Financial Markets, Loans, Assets,
 * Goals, Reports), then Settings / Help / Feedback / What's new. Each group is one subtle
 * rounded container of 56pt rows (glyph, label, chevron), with space between groups. The
 * hosted instance's legal pages and support inbox are mobile-only and sit last, above
 * sign out and the version.
 */
export function MoreScreen({
  appInfo,
  serverInfo,
  email,
  onOpenHelp,
  onOpenWhatsNew,
  onOpenPrivacy,
  onOpenTerms,
  onOpenSupport,
  onOpenAccountsOverview,
  onOpenTransactions,
  onOpenRecurring,
  onOpenSettings,
  onOpenMarkets,
  onOpenLoans,
  onOpenAssets,
  onOpenGoals,
  onOpenReports,
  pendingChanges,
  onLogout,
  onSubmitFeedback,
}: MoreScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [failedAction, setFailedAction] = useState<MoreAction | null>(null)
  const [openingAction, setOpeningAction] = useState<MoreAction | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackPending, setFeedbackPending] = useState(false)
  const [feedbackFailed, setFeedbackFailed] = useState(false)
  const [versionCopy, setVersionCopy] = useState<'copied' | 'failed' | 'idle'>('idle')
  const serverBuild = serverInfo?.version
    ? { commit: serverInfo.commit, version: serverInfo.version }
    : null

  const copyVersionInfo = async () => {
    try {
      await Clipboard.setStringAsync(
        formatVersionInfo({
          app: appInfo ? { commit: null, version: appInfo.version } : null,
          server: serverBuild,
        }),
      )
      setVersionCopy('copied')
    } catch {
      setVersionCopy('failed')
    }
  }
  const actions: Partial<Record<MoreAction, () => Promise<void>>> = {
    help: onOpenHelp,
    whatsNew: onOpenWhatsNew,
    privacy: onOpenPrivacy,
    terms: onOpenTerms,
    support: onOpenSupport,
  }

  const open = (action: MoreAction) => {
    if (openingAction) return Promise.resolve()
    setOpeningAction(action)
    setFailedAction(null)
    const run = actions[action]
    if (!run) return Promise.resolve()
    return run()
      .catch(() => setFailedAction(action))
      .finally(() => setOpeningAction(null))
  }

  const inside = t('more.opensInside')
  const outside = t('more.opensOutside')
  const external = (action: MoreAction, icon: IconName, announcement = outside) => actions[action] ? (
    <MoreRow
      key={action}
      announcement={announcement}
      busy={openingAction === action}
      external
      icon={icon}
      label={t(`more.${action}`)}
      onPress={() => void open(action)}
    />
  ) : null
  const legal = [
    external('privacy', 'shield'),
    external('terms', 'file-text'),
    external('support', 'mail', t('more.opensMail')),
  ].filter(Boolean)

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <View style={styles.lead}>
            <Text accessibilityRole="header" variant="title">{t('more.title')}</Text>
            {email ? (
              <View style={styles.accountHeader}>
                <Avatar palette={palette} source={email} tone="neutral" />
                <Text numberOfLines={1} style={styles.accountEmail} variant="bodyStrong">{email}</Text>
              </View>
            ) : null}
          </View>

          <Group label={t('navigation.accounts')}>
            <MoreRow announcement={inside} icon="landmark" label={t('navigation.overview')} onPress={onOpenAccountsOverview} />
            <MoreRow announcement={inside} icon="receipt-text" label={t('navigation.transactions')} onPress={onOpenTransactions} />
            <MoreRow announcement={inside} icon="calendar-clock" label={t('navigation.billsSubscriptions')} onPress={onOpenRecurring} />
          </Group>

          <Group>
            <MoreRow announcement={inside} icon="bar-chart" label={t('navigation.financialMarkets')} onPress={onOpenMarkets} />
            <MoreRow announcement={inside} icon="hand-coins" label={t('navigation.loans')} onPress={onOpenLoans} />
            <MoreRow announcement={inside} icon="home" label={t('navigation.assets')} onPress={onOpenAssets} />
            <MoreRow announcement={inside} icon="target" label={t('navigation.goals')} onPress={onOpenGoals} />
            <MoreRow announcement={inside} icon="book-open" label={t('navigation.reports')} onPress={onOpenReports} />
          </Group>

          <Group>
            {pendingChanges ? (
              <MoreRow
                announcement={pendingChanges.count > 0 ? `${t('more.pendingChangesCount', { count: pendingChanges.count })}, ${inside}` : inside}
                count={pendingChanges.count}
                icon="check-circle"
                label={t('more.pendingChanges')}
                onPress={pendingChanges.onOpen}
                testID="more-pending-changes"
              />
            ) : null}
            <MoreRow announcement={inside} icon="settings" label={t('navigation.settings')} onPress={onOpenSettings} />
            {external('help', 'circle-help')}
            {onSubmitFeedback ? (
              <MoreRow announcement={inside} icon="message-square" label={t('more.feedback.entryPoint')} onPress={() => setFeedbackOpen(true)} />
            ) : null}
            {external('whatsNew', 'lightbulb')}
          </Group>

          {legal.length > 0 ? <Group>{legal}</Group> : null}

          {failedAction ? (
            <Notice
              action={(
                <Button
                  label={t('more.retryItem', { item: t(`more.${failedAction}`) })}
                  onPress={() => void open(failedAction)}
                  size="sm"
                  variant="outline"
                />
              )}
              message={t('more.openError', { item: t(`more.${failedAction}`) })}
            />
          ) : null}

          <View style={styles.signOut}>
            <Group>
              <MoreRow announcement={inside} icon="log-out" label={t('common.signOut')} onPress={() => void onLogout()} trailing={false} />
            </Group>
            {appInfo ? (
              <View style={styles.info}>
                <Text tone="muted" variant="meta">{t('more.version', { version: appInfo.version })}</Text>
                <Text tone="muted" variant="meta">
                  {t('more.environment', { environment: t(`more.environments.${appInfo.environment}`) })}
                </Text>
              </View>
            ) : null}
            {serverBuild ? (
              <Text align="center" tone="muted" variant="meta">
                {t('more.serverVersion', { version: formatBuild(serverBuild) })}
              </Text>
            ) : null}
            <Button
              label={t('more.copyVersionInfo')}
              onPress={() => void copyVersionInfo()}
              size="sm"
              variant="link"
            />
            {versionCopy === 'copied' ? (
              <Text align="center" tone="muted" variant="meta">{t('more.versionInfoCopied')}</Text>
            ) : null}
            {versionCopy === 'failed' ? (
              <Text align="center" tone="destructive" variant="meta">{t('more.versionInfoCopyFailed')}</Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
      <FeedbackDialog
        visible={feedbackOpen}
        pending={feedbackPending}
        failed={feedbackFailed}
        onCancel={() => { setFeedbackOpen(false); setFeedbackFailed(false) }}
        onSubmit={async (input) => {
          setFeedbackPending(true)
          setFeedbackFailed(false)
          try {
            await onSubmitFeedback?.(input)
            setFeedbackOpen(false)
          } catch {
            setFeedbackFailed(true)
          } finally {
            setFeedbackPending(false)
          }
        }}
      />
    </SafeAreaView>
  )
}

/**
 * One group of rows in a subtle rounded container. `label` names the group with
 * a 20/600 heading (only Accounts has one: its rows are that section's pages,
 * so they shouldn't read as top level).
 */
function Group({ children, label }: { children: React.ReactNode; label?: string }) {
  const group = <SettingsGroup>{children}</SettingsGroup>
  if (!label) return group
  return <Section title={label} variant="open">{group}</Section>
}

function MoreRow({ label, announcement, icon, onPress, count, testID, external = false, busy = false, trailing = true }: {
  label: string
  count?: number
  testID?: string
  announcement: string
  icon: IconName
  onPress: () => void
  external?: boolean
  busy?: boolean
  trailing?: boolean
}) {
  return (
    <SettingsNavRow
      accessibilityLabel={`${label}, ${announcement}`}
      busy={busy}
      count={count}
      external={external}
      icon={icon}
      label={label}
      onPress={onPress}
      testID={testID}
      trailing={trailing}
    />
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  // Groups are separated by space, not rules.
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[8] },
  lead: { gap: themeTokens.spacing[4] },
  accountHeader: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] },
  accountEmail: { flex: 1 },
  signOut: { gap: themeTokens.spacing[3] },
  info: { flexDirection: 'row', justifyContent: 'center', gap: themeTokens.spacing[2] },
})
