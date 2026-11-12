import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { SettingsGroup, SettingsLoading, SettingsNotice } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { ProposalListItem } from './proposals-view-model'
import type { ProposalDecisionFailure } from './use-assistant-proposals'

export type PendingChangesViewState =
  | { status: 'loading' | 'error' | 'invalid-response' | 'access-transition' | 'ai-hidden' }
  | { status: 'loaded' | 'refresh-error'; proposals: readonly ProposalListItem[]; refreshing?: boolean }

export type PendingChangesScreenProps = {
  state: PendingChangesViewState
  /** The proposal whose apply or dismiss is in flight; its buttons show the wait, the others are inert. */
  pendingId?: number | null
  failure?: ProposalDecisionFailure | null
  onRetry: () => void | Promise<void>
  onApply: (proposalId: number) => void
  onDismiss: (proposalId: number) => void
}

/**
 * More › Pending changes (web Settings › Assistant › "Pending changes"): what the assistant or an
 * MCP client proposed to change, each with its before → after rows and Apply / Dismiss. Nothing
 * changes until the person applies a proposal; a proposal expires after seven days.
 */
export function PendingChangesScreen({ state, pendingId = null, failure = null, onRetry, onApply, onDismiss }: PendingChangesScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (state.status === 'access-transition') return null
  const loaded = state.status === 'loaded' || state.status === 'refresh-error'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={loaded ? <RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRetry()} tintColor={palette.primary} /> : undefined}
      >
        <View style={styles.page}>
          <View style={styles.head}>
            <BackControl fallback="/more" label={t('pendingChanges.back')} />
            <PageHeader title={t('pendingChanges.title.page')} description={state.status === 'ai-hidden' ? undefined : t('pendingChanges.description')} />
          </View>

          {state.status === 'ai-hidden' ? <SettingsNotice message={t('pendingChanges.aiHidden')} /> : null}
          {state.status === 'loading' ? <SettingsLoading label={t('pendingChanges.loading')} /> : null}
          {state.status === 'error' || state.status === 'invalid-response' ? (
            <SettingsNotice
              action={<Button label={t('common.retry')} onPress={() => void onRetry()} size="sm" variant="outline" />}
              alert
              message={t(state.status === 'invalid-response' ? 'pendingChanges.invalidMessage' : 'pendingChanges.errorMessage')}
              title={t('pendingChanges.errorTitle')}
            />
          ) : null}

          {failure ? <SettingsNotice alert message={t(`pendingChanges.failure.${failure}`)} /> : null}

          {loaded ? (
            <View style={styles.list}>
              {state.status === 'refresh-error' ? (
                <SettingsNotice
                  action={<Button label={t('common.retry')} onPress={() => void onRetry()} size="sm" variant="outline" />}
                  alert
                  message={t('pendingChanges.stale')}
                />
              ) : null}
              {state.proposals.length === 0
                ? <Text tone="muted" variant="meta">{t('pendingChanges.empty')}</Text>
                : (
                  <SettingsGroup testID="pending-changes-list">
                    {state.proposals.map((proposal) => (
                      <ProposalBlock
                        key={proposal.id}
                        busy={pendingId === proposal.id}
                        inert={pendingId !== null && pendingId !== proposal.id}
                        onApply={() => onApply(proposal.id)}
                        onDismiss={() => onDismiss(proposal.id)}
                        proposal={proposal}
                      />
                    ))}
                  </SettingsGroup>
                )}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ProposalBlock({ proposal, busy, inert, onApply, onDismiss }: {
  proposal: ProposalListItem
  busy: boolean
  inert: boolean
  onApply: () => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <View style={styles.proposal} testID={`pending-change-${proposal.id}`}>
      <View style={styles.proposalHead}>
        <Text variant="bodyStrong">{proposal.title}</Text>
        <Text tone="muted" variant="meta">{[proposal.source, proposal.expires].filter(Boolean).join(' · ')}</Text>
      </View>
      {proposal.rows.map((row) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={t('pendingChanges.rowAccessibility', { after: row.after, before: row.before, label: row.label })}
          style={[styles.diffRow, { borderTopColor: palette.border }]}
        >
          <View style={styles.diffHead}>
            <Text numberOfLines={1} style={styles.diffLabel} variant="meta">{row.label}</Text>
            {row.date ? <Text tone="muted" variant="label">{row.date}</Text> : null}
          </View>
          <View style={styles.diffValues}>
            <Text style={styles.before} tone="muted" variant="meta">{row.before}</Text>
            <Text tone="muted" variant="meta">→</Text>
            <Text style={styles.after} variant="metaStrong">{row.after}</Text>
          </View>
        </View>
      ))}
      {proposal.unavailable ? <Text tone="muted" variant="label">{proposal.unavailable}</Text> : null}
      <View style={styles.actions}>
        <Button
          accessibilityLabel={t('pendingChanges.applyNamed', { title: proposal.title })}
          disabled={inert}
          label={t('pendingChanges.apply')}
          loading={busy}
          onPress={onApply}
          size="sm"
        />
        <Button
          accessibilityLabel={t('pendingChanges.dismissNamed', { title: proposal.title })}
          disabled={inert || busy}
          label={t('pendingChanges.dismiss')}
          onPress={onDismiss}
          size="sm"
          variant="outline"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[6] },
  head: { gap: themeTokens.spacing[2] },
  list: { gap: themeTokens.spacing[4] },
  proposal: { padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  proposalHead: { gap: themeTokens.spacing[1] },
  diffRow: { borderTopWidth: 1, paddingTop: themeTokens.spacing[2], gap: themeTokens.spacing[1] },
  diffHead: { flexDirection: 'row', alignItems: 'baseline', gap: themeTokens.spacing[2] },
  diffLabel: { flex: 1, minWidth: 0 },
  diffValues: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: themeTokens.spacing[2] },
  before: { textDecorationLine: 'line-through' },
  after: { flexShrink: 1 },
  actions: { flexDirection: 'row', gap: themeTokens.spacing[2] },
})
