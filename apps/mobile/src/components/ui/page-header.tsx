import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, StyleSheet, View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/**
 * The on-demand explanation that replaced the always-on subtitle.
 *
 * The web half left the supporting sentence in place, reasoning that "Accounts
 * overview" may be the first time a Portuguese or Spanish customer meets the
 * concept. That argument is about a desktop layout with room to spare — on a
 * 375px column the sentence cost a third of the first screenful, on 30 screens,
 * and the tab bar has already named the destination. The explanation stays
 * available; it stops being mandatory furniture.
 */
function HelpControl({ helpText, showLabel }: { helpText: string; showLabel: boolean }) {
  const palette = usePalette()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)

  // Web's help hint: a 14pt circle-help glyph and "Help" in muted 12px
  // (`components/ui/help-hint.tsx`). The explanation opens on demand.
  return (
    <>
      <Pressable
        accessibilityLabel={helpText}
        accessibilityRole="button"
        hitSlop={12}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.helpControl,
          focused && { borderWidth: 2, borderColor: palette.ring },
          pressed && { opacity: 0.72 },
        ]}
      >
        <Icon color={palette.mutedForeground} name="circle-help" size={14} />
        {showLabel ? (
          <Text tone="muted" variant="label">
            {t('navigation.help', { defaultValue: 'Help' })}
          </Text>
        ) : null}
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <Pressable onPress={() => setOpen(false)} style={[styles.backdrop, { backgroundColor: palette.scrim }]}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: palette.popover, borderColor: palette.border },
              themeTokens.shadow.overlay,
            ]}
          >
            <Text variant="body">{helpText}</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

export type PageHeaderProps = {
  title: string
  /**
   * As-of time, result count, sync state. Not a description — this is the
   * provenance slot, and it is the only muted line the header may carry.
   */
  provenance?: string
  /** Explanation, shown on demand behind web's "(?) Help" hint. */
  helpText?: string
  /** Show the word "Help" beside the glyph (default). `false` is web's icon-only hint (Portfolios). */
  helpLabel?: boolean
  /**
   * Web's page description, muted 14px under the title — only where web shows
   * one (Goals: "Set aside budgeted money for future plans."). Not a subtitle
   * by another name: if web's page has none, pass none.
   */
  description?: string
  /** Status chip(s) inline with the title. */
  badge?: React.ReactNode
  /**
   * The page's controls, stacked full-width under the title as web does at
   * phone width (`flex-col gap-2`): a `SelectTrigger`, then `Button block`s.
   */
  actions?: React.ReactNode
  /**
   * One line telling the person what this form does. **Flow family only** —
   * create, edit and import screens.
   *
   * This is not the subtitle by another name, and the line between them is
   * whether the copy changes what the user *does*. On a list, "Balances and
   * payment context for each loan" is furniture: it says the same thing every
   * visit and the list below already shows it. On a form, "Upload a broker
   * statement (CSV)" tells you which file to pick. The first is banned; the
   * second is part of stating the decision the screen is asking for.
   *
   * If you are reaching for this on a Ledger or Overview screen, you want
   * `provenance` or `helpText`.
   */
  instruction?: string
  /** The one primary action for the screen, rendered inline with the title. */
  action?: React.ReactNode
  testID?: string
  /**
   * @deprecated The header is declarative — a supporting sentence under the
   * title is not part of the system. Accepted so the pre-port call sites keep
   * compiling; **ignored**. Move the text to `helpText`, or delete it.
   */
  subtitle?: string
  /** @deprecated read from the colour scheme now; accepted and ignored. */
  palette?: Palette
}

/**
 * The page title block — web's page `<h1>` (`text-2xl font-semibold
 * tracking-tight`, 24/600) with its help hint, optional description and
 * provenance, and the page's controls stacked beneath.
 */
export function PageHeader({
  title,
  provenance,
  instruction,
  helpText,
  helpLabel = true,
  description,
  badge,
  action,
  actions,
  testID,
}: PageHeaderProps) {
  return (
    <View style={[styles.header, actions ? styles.withActions : null]} testID={testID}>
      <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={styles.titleGroup}>
          <Text accessibilityRole="header" variant="title" style={styles.title}>
            {title}
          </Text>
          {badge}
          {helpText ? <HelpControl helpText={helpText} showLabel={helpLabel} /> : null}
        </View>
        {action}
      </View>
      {description ? (
        <Text tone="muted" variant="meta">
          {description}
        </Text>
      ) : null}
      {provenance ? (
        <Text tone="muted" variant="label">
          {provenance}
        </Text>
      ) : null}
      {instruction ? (
        <Text style={styles.instruction} tone="muted" variant="body">
          {instruction}
        </Text>
      ) : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  )
}

/**
 * The header for a screen that is *about one object* — a holding, an asset, a
 * portfolio, a loan, a goal.
 *
 * The distinction from `PageHeader` is worth stating plainly, because it is the
 * line that decides whether a muted line under a title is allowed:
 *
 * - A **page subtitle** explains the screen — "Your connected accounts". It is
 *   furniture, it says the same thing on every visit, and it is banned.
 * - An **object descriptor** is data — "Apple Inc. · Stock". It changes per
 *   object, it is the answer to "which one am I looking at", and it stays.
 *
 * The object's own identity leads: the symbol or name is the title, the
 * descriptor sits beneath it in muted ink, and any status is a badge inline
 * with the title rather than a colour somewhere else on the screen.
 */
export function ObjectHeader({
  eyebrow,
  title,
  descriptor,
  badge,
  figure,
  action,
  leading,
  testID,
}: {
  /** The object's mark (`EntityMark`) before the title: an account's institution, a ticker's logo. */
  leading?: React.ReactNode
  /** What kind of object this is. Muted, sentence case. */
  eyebrow?: string
  title: string
  /** The object's own descriptor — data, not an explanation of the screen. */
  descriptor?: string
  /** Status, inline with the title. */
  badge?: React.ReactNode
  /** The headline figure, if the object has one. */
  figure?: React.ReactNode
  action?: React.ReactNode
  testID?: string
}) {
  return (
    <View style={styles.header} testID={testID}>
      {eyebrow ? (
        <Text tone="muted" variant="label">
          {eyebrow}
        </Text>
      ) : null}
      <View style={styles.objectTitleRow}>
        <View style={styles.objectTitleGroup}>
          {leading}
          <Text accessibilityRole="header" numberOfLines={3} style={styles.title} variant="title">
            {title}
          </Text>
          {badge}
        </View>
        {action ? <View style={styles.objectAction}>{action}</View> : null}
      </View>
      {descriptor ? (
        <Text numberOfLines={2} tone="muted" variant="meta">
          {descriptor}
        </Text>
      ) : null}
      {figure}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { gap: themeTokens.spacing[1] },
  withActions: { gap: themeTokens.spacing[4] },
  actions: { gap: themeTokens.spacing[2] },
  instruction: { marginTop: themeTokens.spacing[1] },
  // Wraps so the action drops under the title instead of being pushed past the
  // right edge when a long title (or pt/es copy, or 200% type) fills the row.
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: themeTokens.spacing[3],
    rowGap: themeTokens.spacing[2],
  },
  titleGroup: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], flexShrink: 1, maxWidth: '100%' },
  // An object's title row never wraps: the action stays at the end, centred on
  // the title, and the title wraps (up to three lines) in the space left.
  objectTitleRow: { flexDirection: 'row', alignItems: 'center', columnGap: themeTokens.spacing[3] },
  objectTitleGroup: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  objectAction: { flexShrink: 0 },
  title: { flexShrink: 1 },
  helpControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[1],
    minHeight: 24,
    paddingHorizontal: 2,
    borderRadius: themeTokens.radius.sm,
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: themeTokens.spacing[6],
  },
  sheet: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.xl,
    padding: themeTokens.spacing[5],
    maxWidth: 340,
  },
})
