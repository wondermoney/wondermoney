import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Avatar } from '@/components/ui/avatar'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { FeedbackDialog } from './feedback-dialog'
import type { AppDisplayInfo, FeedbackCategory } from './link-policy'

type MoreAction = 'privacy' | 'terms' | 'support' | 'help' | 'whatsNew'

export type MoreScreenProps = {
  appInfo: AppDisplayInfo | null
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
  onOpenProfile: () => void
  onOpenBudgets: () => void
  onOpenLoans: () => void
  onOpenBankConnections: () => void
  onOpenGoals: () => void
  onOpenMarkets: () => void
  onOpenReports: () => void
  onOpenPreferences: () => void
  onOpenCategories: () => void
  onOpenHousehold: () => void
  onOpenNotifications: () => void
  onOpenSecurity: () => void
  onLogout: () => void | Promise<void>
  onSubmitFeedback?: (input: { category: FeedbackCategory; message: string }) => Promise<void>
}


export function MoreScreen({
  appInfo,
  email,
  onOpenHelp,
  onOpenWhatsNew,
  onOpenPrivacy,
  onOpenTerms,
  onOpenSupport,
  onOpenProfile,
  onOpenBudgets,
  onOpenLoans,
  onOpenBankConnections,
  onOpenGoals,
  onOpenMarkets,
  onOpenReports,
  onOpenPreferences,
  onOpenCategories,
  onOpenHousehold,
  onOpenNotifications,
  onOpenSecurity,
  onLogout,
  onSubmitFeedback,
}: MoreScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [failedAction, setFailedAction] = useState<MoreAction | null>(null)
  const [openingAction, setOpeningAction] = useState<MoreAction | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackPending, setFeedbackPending] = useState(false)
  const [feedbackFailed, setFeedbackFailed] = useState(false)
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

  const allRows: { action: MoreAction; label: string; announcement: string }[] = [
    {
      action: 'help',
      label: t('more.help'),
      announcement: t('more.opensOutside'),
    },
    {
      action: 'whatsNew',
      label: t('more.whatsNew'),
      announcement: t('more.opensOutside'),
    },
    {
      action: 'privacy',
      label: t('more.privacy'),
      announcement: t('more.opensOutside'),
    },
    {
      action: 'terms',
      label: t('more.terms'),
      announcement: t('more.opensOutside'),
    },
    {
      action: 'support',
      label: t('more.support'),
      announcement: t('more.opensMail'),
    },
  ]
  const rows = allRows.filter((row) => actions[row.action] !== undefined)

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          {email ? (
            <View style={styles.accountHeader}>
              <Avatar palette={palette} source={email} />
              <Text allowFontScaling numberOfLines={1} style={[styles.accountEmail, { color: palette.foreground }]}>
                {email}
              </Text>
            </View>
          ) : null}

          <View style={styles.heading}>
            <Text
              accessibilityRole="header"
              allowFontScaling
              style={[styles.title, { color: palette.foreground }]}
            >
              {t('more.title')}
            </Text>
          </View>

          <View style={[styles.list, { borderTopColor: palette.border, borderBottomColor: palette.border }]}>
            <InternalRow
              label={t('more.budgets')}
              announcement={t('more.opensInside')}
              onPress={onOpenBudgets}
              palette={palette}
            />
            <InternalRow
              label={t('more.loans')}
              announcement={t('more.opensInside')}
              onPress={onOpenLoans}
              separated
              palette={palette}
            />
            <InternalRow
              label={t('more.profile')}
              announcement={t('more.opensInside')}
              onPress={onOpenProfile}
              separated
              palette={palette}
            />
            <InternalRow
              label={t('more.bankConnections')}
              announcement={t('more.opensInside')}
              onPress={onOpenBankConnections}
              separated
              palette={palette}
            />
            <InternalRow
              label={t('more.goals')}
              announcement={t('more.opensInside')}
              onPress={onOpenGoals}
              separated
              palette={palette}
            />
            <InternalRow
              label={t('more.markets')}
              announcement={t('more.opensInside')}
              onPress={onOpenMarkets}
              separated
              palette={palette}
            />
            <InternalRow
              label={t('more.reports')}
              announcement={t('more.opensInside')}
              onPress={onOpenReports}
              separated
              palette={palette}
            />
          </View>

          <View style={styles.section}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('more.settings')}</Text>
            <View style={[styles.list, { borderTopColor: palette.border, borderBottomColor: palette.border }]}>
              <InternalRow label={t('more.appearanceLanguage')} announcement={t('more.opensInside')} onPress={onOpenPreferences} palette={palette} />
              <InternalRow label={t('more.categories')} announcement={t('more.opensInside')} onPress={onOpenCategories} separated palette={palette} />
              <InternalRow label={t('more.household')} announcement={t('more.opensInside')} onPress={onOpenHousehold} separated palette={palette} />
              <InternalRow label={t('more.notifications')} announcement={t('more.opensInside')} onPress={onOpenNotifications} separated palette={palette} />
              <InternalRow label={t('more.security')} announcement={t('more.opensInside')} onPress={onOpenSecurity} separated palette={palette} />
            </View>
          </View>

          <View style={[styles.list, { borderTopColor: palette.border, borderBottomColor: palette.border }]}>
            {onSubmitFeedback ? (
              <InternalRow
                label={t('more.feedback.entryPoint')}
                announcement={t('more.opensInside')}
                onPress={() => setFeedbackOpen(true)}
                palette={palette}
              />
            ) : null}
            {rows.map((row, index) => (
              <MoreLinkRow
                key={row.action}
                label={row.label}
                announcement={row.announcement}
                busy={openingAction === row.action}
                onPress={() => void open(row.action)}
                separated={Boolean(onSubmitFeedback) || index > 0}
                palette={palette}
              />
            ))}
          </View>

          {failedAction ? (
            <View
              style={[styles.error, { borderColor: palette.border, backgroundColor: palette.muted }]}
            >
              <Text
                accessible
                accessibilityRole="alert"
                accessibilityLabel={t('more.openError', { item: t(`more.${failedAction}`) })}
                allowFontScaling
                style={[styles.errorText, { color: palette.foreground }]}
              >
                {t('more.openError', { item: t(`more.${failedAction}`) })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('more.retryItem', { item: t(`more.${failedAction}`) })}
                onPress={() => void open(failedAction)}
                style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
              >
                <Text allowFontScaling style={[styles.retryText, { color: palette.primary }]}>
                  {t('more.retryItem', { item: t(`more.${failedAction}`) })}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.list, { borderTopColor: palette.border, borderBottomColor: palette.border }]}>
            <InternalRow
              label={t('common.signOut')}
              announcement={t('more.opensInside')}
              onPress={() => void onLogout()}
              palette={palette}
            />
          </View>

          {appInfo ? (
            <View style={styles.info}>
              <Text accessibilityRole="header" allowFontScaling style={[styles.infoTitle, { color: palette.foreground }]}>
                {t('more.appInformation')}
              </Text>
              <Text allowFontScaling style={[styles.infoText, { color: palette.mutedForeground }]}>
                {t('more.version', { version: appInfo.version })}
              </Text>
              <Text allowFontScaling style={[styles.infoText, { color: palette.mutedForeground }]}>
                {t('more.environment', {
                  environment: t(`more.environments.${appInfo.environment}`),
                })}
              </Text>
            </View>
          ) : null}
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

function InternalRow({ label, announcement, onPress, separated = false, palette }: {
  label: string
  announcement: string
  onPress: () => void
  separated?: boolean
  palette: Palette
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${announcement}`}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        separated && { borderTopWidth: 1, borderTopColor: palette.border },
        focused && { borderWidth: 2, borderColor: palette.foreground },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.rowText}>
        <Text allowFontScaling style={[styles.rowLabel, { color: palette.foreground }]}>{label}</Text>
      </View>
      <Text accessible={false} style={[styles.internalMark, { color: palette.mutedForeground }]}>›</Text>
    </Pressable>
  )
}

function MoreLinkRow({
  label,
  announcement,
  busy,
  onPress,
  separated,
  palette,
}: {
  label: string
  announcement: string
  busy: boolean
  onPress: () => void
  separated: boolean
  palette: Palette
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${announcement}`}
      accessibilityState={{ busy }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        separated && { borderTopWidth: 1, borderTopColor: palette.border },
        focused && { borderWidth: 2, borderColor: palette.foreground },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.rowText}>
        <Text allowFontScaling style={[styles.rowLabel, { color: palette.foreground }]}>
          {label}
        </Text>
        <Text allowFontScaling style={[styles.rowHelper, { color: palette.mutedForeground }]}>
          {announcement}
        </Text>
      </View>
      <Text accessible={false} style={[styles.externalMark, { color: palette.primary }]}>
        ↗
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    gap: themeTokens.layout.blockGap,
  },
  accountHeader: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] },
  accountEmail: { ...textStyles.bodyStrong, flex: 1 },
  heading: { gap: themeTokens.spacing[2] },
  title: { ...textStyles.title },
  helper: { ...textStyles.body },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
  },
  row: {
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: themeTokens.spacing[4],
    paddingVertical: themeTokens.spacing[2],
  },
  rowText: { flex: 1, gap: themeTokens.spacing[1] },
  rowLabel: { ...textStyles.bodyStrong },
  rowHelper: { ...textStyles.meta },
  externalMark: { ...textStyles.title, fontWeight: '400' as const },
  internalMark: { ...textStyles.title, fontWeight: '400' as const },
  pressed: { opacity: 0.72 },
  error: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
  },
  errorText: { ...textStyles.body },
  retry: {
    minHeight: themeTokens.touchTarget.minimum,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  retryText: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
    fontSize: themeTokens.typography.roles.interface.fontSize,
    lineHeight: themeTokens.typography.roles.interface.lineHeight,
    fontWeight: '600',
  },
  info: { gap: themeTokens.spacing[2] },
  section: { gap: themeTokens.spacing[3] },
  sectionTitle: { ...textStyles.section },
  infoTitle: { ...textStyles.section },
  infoText: { ...textStyles.amount },
})
