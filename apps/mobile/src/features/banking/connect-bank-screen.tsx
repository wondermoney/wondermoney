import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { BankInstitutionRow } from './institutions-view-model'
import { filterBankInstitutions } from './institutions-view-model'
import type { StartBankConnectionFailure } from './use-start-bank-connection'


export type ConnectBankScreenState =
  | { status: 'access-transition' }
  | { status: 'loading' }
  | { status: 'invalid-response' }
  | { status: 'error' }
  | { status: 'loaded'; rows: readonly BankInstitutionRow[] }

export type ConnectBankScreenProps = {
  state: ConnectBankScreenState
  pendingBankId: string | null
  startFailure: StartBankConnectionFailure | null
  onBack: () => void
  onRetry: () => void | Promise<void>
  onSelectBank: (row: BankInstitutionRow) => void
}

export function ConnectBankScreen({ state, pendingBankId, startFailure, onBack, onRetry, onSelectBank }: ConnectBankScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [query, setQuery] = useState('')
  const starting = pendingBankId !== null

  if (state.status === 'access-transition') return null

  const filtered = state.status === 'loaded' ? filterBankInstitutions(state.rows, query) : []

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.page}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('banking.connect.back')}
            onPress={() => void onBack()}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Text allowFontScaling style={[styles.backLabel, { color: palette.foreground }]}>
              {t('banking.connect.back')}
            </Text>
          </Pressable>

          <View style={styles.heading}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
              {t('banking.connect.heading')}
            </Text>
            <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
              {t('banking.connect.helper')}
            </Text>
          </View>

          {startFailure ? (
            <View style={[styles.notice, { borderColor: palette.border, backgroundColor: palette.muted }]}>
              <Text accessibilityRole="alert" allowFontScaling style={[styles.noticeBody, { color: palette.foreground }]}>
                {t(`banking.connect.startError.${startFailure}`)}
              </Text>
            </View>
          ) : null}

          {state.status === 'loaded' ? (
            <TextInput
              accessibilityLabel={t('banking.connect.searchLabel')}
              placeholder={t('banking.connect.searchLabel')}
              placeholderTextColor={palette.mutedForeground}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.search, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]}
            />
          ) : null}

          {state.status === 'loading' ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={t('banking.connect.loading')}
              style={styles.loading}
            >
              <View style={[styles.skeleton, { width: 260, height: 20, backgroundColor: palette.muted }]} />
              <View style={[styles.skeleton, { width: 320, height: 20, backgroundColor: palette.muted }]} />
            </View>
          ) : null}

          {state.status === 'error' || state.status === 'invalid-response' ? (
            <View style={[styles.notice, { borderColor: palette.border, backgroundColor: palette.muted }]}>
              <Text accessibilityRole="alert" allowFontScaling style={[styles.noticeTitle, { color: palette.foreground }]}>
                {t(state.status === 'invalid-response' ? 'banking.connect.invalidResponse.title' : 'banking.connect.error.title')}
              </Text>
              <Text allowFontScaling style={[styles.noticeBody, { color: palette.mutedForeground }]}>
                {t(state.status === 'invalid-response' ? 'banking.connect.invalidResponse.message' : 'banking.connect.error.message')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                onPress={() => void onRetry()}
                style={({ pressed }) => [
                  styles.retry,
                  { borderColor: palette.primary, backgroundColor: palette.primary },
                  pressed && styles.pressed,
                ]}
              >
                <Text allowFontScaling style={[styles.retryLabel, { color: palette.background }]}>
                  {t('common.retry')}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {state.status === 'loaded' ? (
            filtered.length === 0 ? (
              <Text allowFontScaling style={[styles.empty, { color: palette.mutedForeground }]}>
                {t(state.rows.length === 0 ? 'banking.connect.empty' : 'banking.connect.noMatches')}
              </Text>
            ) : (
              <View style={styles.list}>
                {filtered.map((row, index) => (
                  <BankRow
                    key={row.id}
                    row={row}
                    palette={palette}
                    separated={index > 0}
                    starting={starting}
                    isPending={pendingBankId === row.id}
                    onPress={() => onSelectBank(row)}
                  />
                ))}
              </View>
            )
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function BankRow({ row, palette, separated, starting, isPending, onPress }: {
  row: BankInstitutionRow
  palette: Palette
  separated: boolean
  starting: boolean
  isPending: boolean
  onPress: () => void
}) {
  const { t } = useTranslation()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('banking.connect.selectLabel', { name: row.name })}
      accessibilityState={{ disabled: starting, busy: isPending }}
      disabled={starting}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: palette.border },
        separated && { borderTopWidth: 1, borderTopColor: palette.border },
        starting && styles.rowDisabled,
        pressed && !starting && styles.pressed,
      ]}
    >
      <Text allowFontScaling style={[styles.institution, { color: palette.foreground }]}>
        {row.name}
      </Text>
      {isPending ? (
        <Text allowFontScaling style={[styles.meta, { color: palette.mutedForeground }]}>
          {t('banking.connect.starting', { name: row.name })}
        </Text>
      ) : null}
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
  back: {
    minHeight: themeTokens.touchTarget.minimum,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: themeTokens.spacing[3],
  },
  backLabel: { ...textStyles.bodyStrong },
  heading: { gap: themeTokens.spacing[2] },
  title: { ...textStyles.title },
  helper: { ...textStyles.body },
  search: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  loading: { gap: themeTokens.spacing[3] },
  skeleton: { borderRadius: themeTokens.radius.sm },
  notice: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.lg,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
  },
  noticeTitle: { ...textStyles.action },
  noticeBody: { ...textStyles.body },
  retry: {
    minHeight: themeTokens.touchTarget.minimum,
    alignSelf: 'flex-start',
    paddingHorizontal: themeTokens.spacing[4],
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
  },
  retryLabel: { ...textStyles.action },
  empty: { ...textStyles.body },
  list: {
    width: '100%',
    gap: 0,
  },
  row: {
    width: '100%',
    minHeight: themeTokens.touchTarget.minimum,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[1],
    justifyContent: 'center',
  },
  rowDisabled: { opacity: 0.5 },
  institution: { ...textStyles.section },
  meta: { ...textStyles.meta },
  pressed: { opacity: 0.72 },
})
