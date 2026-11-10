import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Image, Modal, Pressable, ScrollView, StyleSheet, useColorScheme, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Avatar } from '@/components/ui/avatar'
import { Icon, type IconName } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { currentPage, currentSection, type ShellSection, type ShellSectionPage } from './navigation'

export type PersonMenuProps = {
  /** The person's display name; falls back to the email handle, as web does. */
  name?: string | null
  email?: string | null
  /** App version, shown muted at the foot ("v1.4.0"). Omitted when unknown. */
  version?: string | null
  /** The resolved theme; with `onToggleTheme` it shows web's "Dark mode" / "Light mode" row. */
  theme?: 'light' | 'dark' | null
  onToggleTheme?: () => void
  onOpenSettings: () => void
  onOpenAppearance: () => void
  /** Opens the help centre; the row is hidden when absent. */
  onOpenHelp?: () => void
  onSignOut: () => void | Promise<void>
}

export type TopBarProps = {
  person: PersonMenuProps
  /** Current path; drives the section tab row. */
  pathname: string
  /** Called when a section tab is pressed (not the current one). */
  onNavigateSection: (page: ShellSectionPage, section: ShellSection) => void
  /** The wordmark goes home, as web's `<Logo>` link does. */
  onPressLogo: () => void
  testID?: string
}

/**
 * The app bar on every product page — web's `TopBar.tsx` under `lg`: the Wonder
 * wordmark left, the person's avatar + chevron right (opens `PersonMenu`), a
 * hairline under it, and the current section's pages as underlined tabs
 * (`SectionTabs`) when the section has siblings. Owns the top safe area.
 */
export function TopBar({ person, pathname, onNavigateSection, onPressLogo, testID = 'app-top-bar' }: TopBarProps) {
  const palette = usePalette()
  const { t } = useTranslation()
  const dark = useColorScheme() === 'dark'

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.bar, { backgroundColor: palette.background, borderBottomColor: palette.border }]}
      testID={testID}
    >
      <View style={styles.row}>
        <Pressable
          accessibilityLabel={t('navigation.home')}
          accessibilityRole="link"
          hitSlop={4}
          onPress={onPressLogo}
          style={({ pressed }) => [styles.logoTarget, pressed && styles.pressed]}
          testID="app-top-bar-logo"
        >
          {/* One wordmark per theme, each matching that theme's primary — the
              light violet drops under 3:1 on the dark canvas (web Logo.tsx). */}
          <Image
            accessible={false}
            resizeMode="contain"
            source={
              dark
                ? require('@/assets/images/wondermoney-logo-dark.png')
                : require('@/assets/images/wondermoney-logo.png')
            }
            style={styles.logo}
          />
        </Pressable>
        <PersonMenu {...person} />
      </View>
      <SectionTabs onNavigate={onNavigateSection} pathname={pathname} />
    </SafeAreaView>
  )
}

/**
 * The current section's pages as a tab row — web `TopBar.tsx` `SectionTabs`:
 * 44pt tall, 24pt apart, 14/500 labels, current page in foreground with a 2pt
 * violet underline, others muted. Scrolls sideways when the labels overflow.
 * Renders nothing outside a section with sibling pages.
 *
 * Items are links (`accessibilityRole="link"`, `selected` on the current one),
 * as on web — the bottom bar keeps the `tab` role.
 */
export function SectionTabs({
  pathname,
  onNavigate,
}: {
  pathname: string
  onNavigate: (page: ShellSectionPage, section: ShellSection) => void
}) {
  const palette = usePalette()
  const { t } = useTranslation()
  const section = currentSection(pathname)
  if (!section) return null
  const current = currentPage(section, pathname)

  return (
    <View
      accessibilityLabel={t(section.labelKey)}
      style={[styles.tabsBorder, { borderTopColor: palette.border }]}
      testID="section-tabs"
    >
      <ScrollView contentContainerStyle={styles.tabs} horizontal showsHorizontalScrollIndicator={false}>
        {section.pages.map((page) => {
          const active = current?.id === page.id
          return (
            <Pressable
              accessibilityRole="link"
              accessibilityState={{ selected: active }}
              key={page.id}
              onPress={() => {
                if (!active) onNavigate(page, section)
              }}
              style={({ pressed }) => [styles.tab, pressed && !active && styles.pressed]}
              testID={`section-tab-${page.id}`}
            >
              <Text style={{ color: active ? palette.foreground : palette.mutedForeground }} variant="metaStrong">
                {t(page.labelKey)}
              </Text>
              {active ? <View style={[styles.underline, { backgroundColor: palette.primary }]} /> : null}
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

/**
 * The person's menu — web `AccountMenu placement="bar"`: a 32pt initials
 * avatar and a chevron; it opens a 240pt popover under the bar with the name
 * and email, Settings, Appearance, Help, the theme switch, Sign out and the
 * version.
 */
export function PersonMenu({
  name,
  email,
  version,
  theme,
  onToggleTheme,
  onOpenSettings,
  onOpenAppearance,
  onOpenHelp,
  onSignOut,
}: PersonMenuProps) {
  const palette = usePalette()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const handle = email?.split('@')[0]
  const displayName = name?.trim() || handle || ''

  const run = (action: () => void | Promise<void>) => () => {
    setOpen(false)
    void action()
  }

  return (
    <>
      <Pressable
        accessibilityLabel={t('navigation.openUserMenu')}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={2}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && { backgroundColor: palette.accent }]}
        testID="person-menu-trigger"
      >
        <Avatar palette={palette} size={themeTokens.size.avatar} source={displayName || '?'} tone="neutral" />
        <Icon color={palette.mutedForeground} name="chevron-down" />
      </Pressable>
      <Modal animationType="none" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <Pressable accessibilityLabel={t('common.cancel')} onPress={() => setOpen(false)} style={styles.backdrop}>
          <View
            accessibilityViewIsModal
            onStartShouldSetResponder={() => true}
            style={[
              styles.menu,
              { top: insets.top + themeTokens.size.topBar - themeTokens.spacing[1], right: themeTokens.layout.screenPadding + insets.right },
              { backgroundColor: palette.popover, borderColor: palette.border },
              themeTokens.shadow.overlay,
            ]}
            testID="person-menu"
          >
            {displayName || email ? (
              <View style={styles.identity}>
                {displayName ? (
                  <Text numberOfLines={1} variant="metaStrong">
                    {displayName}
                  </Text>
                ) : null}
                {email ? (
                  <Text numberOfLines={1} tone="muted" variant="label">
                    {email}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <MenuRow icon="settings" label={t('navigation.settings')} onPress={run(onOpenSettings)} />
            <MenuRow icon="palette" label={t('more.appearanceLanguage')} onPress={run(onOpenAppearance)} />
            {onOpenHelp ? <MenuRow icon="circle-help" label={t('navigation.help')} onPress={run(onOpenHelp)} /> : null}
            {onToggleTheme ? (
              <MenuRow
                icon={theme === 'dark' ? 'sun' : 'moon'}
                label={theme === 'dark' ? t('navigation.lightMode') : t('navigation.darkMode')}
                onPress={() => onToggleTheme()}
              />
            ) : null}
            <View style={[styles.separator, { backgroundColor: palette.border }]} />
            <MenuRow icon="log-out" label={t('common.signOut')} onPress={run(onSignOut)} />
            {version ? (
              <Text align="right" style={styles.version} tone="muted" variant="label">
                {t('navigation.version', { version })}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

/** One row of the person menu: web `menuRowClass` — 16pt icon, 14px label, `px-3`, 44pt tall. */
function MenuRow({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const palette = usePalette()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: palette.accent }]}
    >
      <Icon color={palette.foreground} name={icon} />
      <Text variant="meta">{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: 1 },
  row: {
    height: themeTokens.size.topBar,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: themeTokens.layout.screenPadding,
  },
  // Web `h-10 w-28`: 112 × 40, contain.
  logoTarget: { height: themeTokens.touchTarget.minimum, justifyContent: 'center' },
  logo: { width: 112, height: 40 },
  trigger: {
    height: themeTokens.size.control,
    minWidth: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[2],
    paddingHorizontal: themeTokens.spacing[2],
    marginRight: -themeTokens.spacing[2],
    borderRadius: themeTokens.radius.md,
  },
  tabsBorder: { borderTopWidth: 1 },
  tabs: { paddingHorizontal: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] },
  tab: { height: themeTokens.size.sectionTab, justifyContent: 'center' },
  underline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 },
  pressed: { opacity: 0.72 },
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    width: 240,
    padding: themeTokens.spacing[2],
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
  },
  identity: { paddingHorizontal: themeTokens.spacing[3], paddingTop: themeTokens.spacing[1], paddingBottom: themeTokens.spacing[2], gap: 2 },
  menuRow: {
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    paddingHorizontal: themeTokens.spacing[3],
    borderRadius: themeTokens.radius.md,
  },
  separator: { height: 1, marginVertical: themeTokens.spacing[2] },
  version: { paddingHorizontal: themeTokens.spacing[3], paddingTop: themeTokens.spacing[1] },
})
