import { useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'

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
function HelpControl({ helpText }: { helpText: string }) {
  const palette = usePalette()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Pressable
        accessibilityLabel={helpText}
        accessibilityRole="button"
        hitSlop={12}
        onPress={() => setOpen(true)}
        style={[styles.helpControl, { borderColor: palette.input }]}
      >
        <Text variant="label" style={styles.helpGlyph} tone="muted">
          ?
        </Text>
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
  /** Explanation, shown on demand behind a `?`. */
  helpText?: string
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
 * A screen is titled `Accounts` and nothing else.
 *
 * One treatment — 20/600 — matching the web half exactly, so every screen
 * title has the same size.
 */
export function PageHeader({ title, provenance, instruction, helpText, action, testID }: PageHeaderProps) {
  return (
    <View style={styles.header} testID={testID}>
      <View style={styles.titleRow}>
        <View style={styles.titleGroup}>
          <Text accessibilityRole="header" variant="title" style={styles.title}>
            {title}
          </Text>
          {helpText ? <HelpControl helpText={helpText} /> : null}
        </View>
        {action}
      </View>
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
  testID,
}: {
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
      <View style={styles.titleRow}>
        <View style={styles.titleGroup}>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.title} variant="title">
            {title}
          </Text>
          {badge}
        </View>
        {action}
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
  instruction: { marginTop: themeTokens.spacing[1] },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: themeTokens.spacing[3],
  },
  titleGroup: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], flexShrink: 1 },
  title: { flexShrink: 1 },
  helpControl: {
    width: 22,
    height: 22,
    borderRadius: themeTokens.radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpGlyph: { fontWeight: '600', lineHeight: 14 },
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
