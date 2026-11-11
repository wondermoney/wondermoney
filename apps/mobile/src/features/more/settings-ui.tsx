import { useRouter, type Href } from 'expo-router'
import { useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type RefreshControlProps,
  type TextInputProps,
} from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { FLOATING_ACTION_SIZE } from '@/components/ui/floating-action-button'
import { FORM_ROW_HEIGHT } from '@/components/ui/form-row'
import { Icon, type IconName } from '@/components/ui/icon'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { SelectTrigger } from '@/components/ui/select-trigger'
import { OptionSheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

/**
 * Web's Settings page at phone width (`app/[locale]/(full-layout)/settings/page.tsx`):
 * a "Settings" title, one full-width select naming the current section, then that
 * section. Mobile keeps one route per section; the select switches between them.
 */
export type SettingsSectionId =
  | 'profile'
  | 'security'
  | 'household'
  | 'connections'
  | 'categories'
  | 'rules'
  | 'appearance'
  | 'notifications'

export const SETTINGS_HREF: Record<SettingsSectionId, string> = {
  profile: '/settings/profile',
  security: '/settings/security',
  household: '/settings/household',
  connections: '/more/banking',
  categories: '/settings/categories',
  rules: '/settings/rules',
  appearance: '/settings/preferences',
  notifications: '/settings/notifications',
}

/** Web's `TAB_GROUPS`, minus the sections this app has no screen for (Privacy, Bank Provider, Assistant). */
const SETTINGS_GROUPS: readonly { key: 'account' | 'money' | 'preferences'; sections: readonly SettingsSectionId[] }[] = [
  { key: 'account', sections: ['profile', 'security', 'household'] },
  { key: 'money', sections: ['connections', 'categories', 'rules'] },
  { key: 'preferences', sections: ['appearance', 'notifications'] },
]

export type SettingsPageProps = {
  section: SettingsSectionId
  children?: ReactNode
  /** Accessible name of the back link ("Back to More"). */
  backLabel?: string
  onBack?: () => void
  backDisabled?: boolean
  refreshControl?: ReactElement<RefreshControlProps>
  /**
   * A `FloatingActionButton` for a settings list that adds things (Categories). It is
   * drawn over the page, bottom-right, and the content is padded so the last row clears it.
   */
  floatingAction?: ReactNode
  testID?: string
}

export function SettingsPage({ section, children, backLabel, onBack, backDisabled, refreshControl, floatingAction, testID }: SettingsPageProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const router = useRouter()
  const [picking, setPicking] = useState(false)

  const groups = SETTINGS_GROUPS.map((group) => ({
    label: t(`settings.groups.${group.key}`),
    options: group.sections.map((id) => ({ value: id, label: t(`settings.sections.${id}`) })),
  }))

  return (
    <View style={[styles.safe, { backgroundColor: palette.background }]}>
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} testID={testID}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <ScrollView
          contentContainerStyle={[styles.content, floatingAction ? styles.contentUnderButton : null]}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          <View style={styles.page}>
            <View style={styles.head}>
              <BackControl disabled={backDisabled} fallback="/more" label={backLabel} onPress={onBack} />
              <PageHeader
                title={t('settings.title')}
                actions={(
                  <SelectTrigger
                    accessibilityLabel={t('settings.title')}
                    block
                    onPress={() => setPicking(true)}
                    testID="settings-section-select"
                    value={t(`settings.sections.${section}`)}
                  />
                )}
              />
            </View>
            <View style={styles.body}>{children}</View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <OptionSheet
        groups={groups}
        onClose={() => setPicking(false)}
        onSelect={(next) => {
          setPicking(false)
          if (next !== section) router.replace(SETTINGS_HREF[next] as Href)
        }}
        title={t('settings.title')}
        value={section}
        visible={picking}
      />
    </SafeAreaView>
    {floatingAction}
    </View>
  )
}

/**
 * One settings section: a 20/600 heading and its muted lead line, then the rows.
 * Sections are separated by 40pt of space, not rules (the calm structure's
 * `Section variant="open"`).
 */
export function SettingsSection({ title, description, children, first = false, testID }: {
  title: string
  description?: string
  children?: ReactNode
  /** The first block has no space above it. */
  first?: boolean
  testID?: string
}) {
  return (
    <View style={[styles.section, !first && styles.sectionSpaced]} testID={testID}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" variant="heading">{title}</Text>
        {description ? <Text tone="muted" variant="meta">{description}</Text> : null}
      </View>
      {children}
    </View>
  )
}

/** A web `h4` inside a section ("Members", "Invite a partner"). */
export function SettingsSubheading({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.subhead}>
      <Text accessibilityRole="header" variant="bodyStrong">{title}</Text>
      {description ? <Text tone="muted" variant="meta">{description}</Text> : null}
    </View>
  )
}

/**
 * A run of settings rows in one subtle rounded container with hairlines between
 * them: the settings list's group (the same box as `FormGroup`).
 */
export function SettingsGroup({ children, testID }: { children: ReactNode; testID?: string }) {
  const palette = usePalette()
  const rows = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean) as ReactNode[]
  return (
    <View style={[styles.group, { borderColor: palette.border }]} testID={testID}>
      {rows.map((row, index) => (
        <View key={index} style={index > 0 ? { borderTopWidth: 1, borderTopColor: palette.border } : null}>
          {row}
        </View>
      ))}
    </View>
  )
}

/**
 * A settings row that goes somewhere: a 56pt row with an optional leading glyph,
 * the label in body, an optional muted value and a trailing chevron (or the
 * external-link glyph when it leaves the app). Put it in a `SettingsGroup`.
 */
export function SettingsNavRow({ label, icon, value, onPress, accessibilityLabel, external = false, busy = false, destructive = false, trailing = true, testID }: {
  label: string
  /** `false` drops the chevron, for a row that acts in place (Sign out). */
  trailing?: boolean
  icon?: IconName
  value?: string
  onPress: () => void
  accessibilityLabel?: string
  external?: boolean
  busy?: boolean
  destructive?: boolean
  testID?: string
}) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navRow,
        focused && [styles.rowFocused, { borderColor: palette.ring }],
        pressed && { backgroundColor: palette.muted },
      ]}
      testID={testID}
    >
      {icon ? <Icon color={destructive ? palette.destructiveText : palette.foreground} name={icon} size={themeTokens.size.icon} /> : null}
      <Text numberOfLines={1} style={styles.navLabel} tone={destructive ? 'destructive' : 'default'} variant="body">{label}</Text>
      {value ? <Text numberOfLines={1} style={styles.navValue} tone="muted" variant="body">{value}</Text> : null}
      {destructive || !trailing ? null : <Icon color={palette.mutedForeground} name={external ? 'external-link' : 'chevron-right'} size={themeTokens.size.iconSmall} />}
    </Pressable>
  )
}

/**
 * A read-only settings row: the label left, the value right (muted when it is
 * the "not provided" stand-in). One accessible element reading "label, value".
 */
export function SettingsValueRow({ label, value, missing }: { label: string; value: string | null; missing?: string }) {
  const shown = value ?? missing ?? ''
  return (
    <View accessible accessibilityLabel={`${label}, ${shown}`} style={styles.navRow}>
      <Text numberOfLines={1} style={styles.valueLabel} variant="body">{label}</Text>
      <Text ellipsizeMode="middle" numberOfLines={1} style={styles.valueText} tone={value ? 'default' : 'muted'} variant="body">{shown}</Text>
    </View>
  )
}

/** Label above the control (web `FormLabel`: `text-sm font-medium`, `gap-2`). */
export function SettingsField({ label, error, children, required = false }: {
  label: string
  error?: string | null
  children: ReactNode
  required?: boolean
}) {
  return (
    <View style={styles.field}>
      <Text variant="metaStrong">{required ? `${label} *` : label}</Text>
      {children}
      {error ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{error}</Text> : null}
    </View>
  )
}

/**
 * Web's `Input`: 40pt, `border-input`, 6pt radius, `px-4`, 14px text, a 2pt
 * ring on focus, `aria-invalid` turns the border destructive. `readOnly` keeps
 * the field look for a value that can't be edited here (Profile's email).
 */
export function SettingsInput({ invalid = false, readOnly = false, style, onFocus, onBlur, ...rest }: TextInputProps & {
  invalid?: boolean
  readOnly?: boolean
}) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <TextInput
      allowFontScaling
      editable={readOnly ? false : rest.editable}
      onBlur={(event) => { setFocused(false); onBlur?.(event) }}
      onFocus={(event) => { setFocused(true); onFocus?.(event) }}
      placeholderTextColor={palette.mutedForeground}
      {...rest}
      {...(readOnly ? { editable: false } : {})}
      style={[
        styles.input,
        {
          color: palette.foreground,
          backgroundColor: palette.card,
          borderColor: focused ? palette.ring : invalid ? palette.destructiveText : palette.input,
          borderWidth: focused ? 2 : 1,
          paddingHorizontal: focused ? themeTokens.spacing[4] - 1 : themeTokens.spacing[4],
        },
        rest.editable === false && !readOnly ? styles.inputDisabled : null,
        style,
      ]}
    />
  )
}

/**
 * Web's `Switch` row (Notifications): text on the left, the switch at the
 * end, hairline between rows. The native switch takes the primary track.
 */
export function SettingsSwitchRow({ title, description, children, value, onValueChange, disabled = false, accessibilityLabel, separated = false }: {
  title: string
  description?: string
  children?: ReactNode
  value: boolean
  onValueChange: (next: boolean) => void
  disabled?: boolean
  accessibilityLabel: string
  separated?: boolean
}) {
  const palette = usePalette()
  return (
    <View style={[styles.switchRow, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      <View style={styles.switchText}>
        <Text variant="bodyStrong">{title}</Text>
        {description ? <Text tone="muted" variant="meta">{description}</Text> : null}
        {children}
      </View>
      <SettingsSwitch
        accessibilityLabel={accessibilityLabel}
        checked={value}
        disabled={disabled}
        onToggle={onValueChange}
      />
    </View>
  )
}

/**
 * Web's `Switch` (`components/ui/Switch.tsx`): a 44x24 pill, `bg-primary` when
 * on and `bg-input` when off, a 20pt canvas thumb, a 2pt ring on focus. Drawn
 * rather than native so it matches web and keeps press semantics in tests.
 */
export function SettingsSwitch({ checked, disabled = false, accessibilityLabel, onToggle }: {
  checked: boolean
  disabled?: boolean
  accessibilityLabel: string
  onToggle: (next: boolean) => void
}) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled, busy: disabled }}
      disabled={disabled}
      hitSlop={10}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => onToggle(!checked)}
      style={({ pressed }) => [
        styles.track,
        { backgroundColor: checked ? palette.primary : palette.input },
        focused && { borderColor: palette.ring },
        (pressed || disabled) && { opacity: disabled ? 0.5 : 0.85 },
      ]}
    >
      <View style={[styles.thumb, { backgroundColor: palette.background, alignSelf: checked ? 'flex-end' : 'flex-start' }]} />
    </Pressable>
  )
}

/** A bordered notice on the canvas (stale data, a failed save). Hairline, `-text` ink for status, no tint. */
export function SettingsNotice({ title, message, tone = 'default', action, alert = false }: {
  title?: string
  message: string
  tone?: 'default' | 'destructive'
  action?: ReactNode
  alert?: boolean
}) {
  const palette = usePalette()
  return (
    <View style={[styles.notice, { borderColor: tone === 'destructive' ? palette.destructiveText : palette.border }]}>
      {title ? <Text accessibilityRole={alert ? 'alert' : 'header'} variant="metaStrong">{title}</Text> : null}
      <Text
        accessibilityLabel={alert && !title ? message : undefined}
        accessibilityRole={alert && !title ? 'alert' : undefined}
        accessible
        tone={tone === 'destructive' ? 'destructive' : title ? 'muted' : 'default'}
        variant="meta"
      >
        {message}
      </Text>
      {action}
    </View>
  )
}

/** Loading placeholder for a settings section: three muted bars, announced as progress. */
export function SettingsLoading({ label }: { label: string }) {
  const palette = usePalette()
  return (
    <View accessible accessibilityLabel={label} accessibilityRole="progressbar" style={styles.loading}>
      {[0.5, 1, 1].map((width, index) => (
        <View key={index} style={[styles.skeleton, { width: `${width * 100}%`, backgroundColor: palette.muted }]} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  contentUnderButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  head: { gap: themeTokens.spacing[2] },
  body: { paddingTop: themeTokens.spacing[8] },
  // Space, not rules, between sections: 40pt and a 20/600 heading.
  section: { gap: themeTokens.spacing[4] },
  sectionSpaced: { marginTop: themeTokens.spacing[10] },
  sectionHead: { gap: themeTokens.spacing[1] },
  subhead: { gap: themeTokens.spacing[1] },
  field: { gap: themeTokens.spacing[2] },
  group: { borderWidth: 1, borderRadius: themeTokens.radius.xl, overflow: 'hidden' },
  navRow: {
    minHeight: FORM_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    paddingHorizontal: themeTokens.spacing[4],
    paddingVertical: themeTokens.spacing[2],
  },
  rowFocused: { borderWidth: 2, borderRadius: themeTokens.radius.xl },
  navLabel: { flex: 1, minWidth: 0 },
  valueLabel: { flexShrink: 0, maxWidth: '50%' },
  navValue: { flexShrink: 1, minWidth: 0, maxWidth: '50%', textAlign: 'right' },
  valueText: { flex: 1, minWidth: 0, textAlign: 'right' },
  input: {
    ...textStyles.meta,
    minHeight: themeTokens.size.control,
    borderRadius: themeTokens.radius.md,
    paddingVertical: themeTokens.spacing[2],
  },
  inputDisabled: { opacity: 0.5 },
  switchRow: {
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[4],
    paddingVertical: themeTokens.spacing[4],
  },
  switchText: { flex: 1, gap: themeTokens.spacing[1] },
  track: { width: 44, height: 24, borderRadius: themeTokens.radius.pill, borderWidth: 2, borderColor: 'transparent', justifyContent: 'center' },
  thumb: { width: 20, height: 20, borderRadius: themeTokens.radius.pill },
  notice: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[2],
    alignItems: 'flex-start',
  },
  loading: { gap: themeTokens.spacing[4] },
  skeleton: { height: themeTokens.size.control, borderRadius: themeTokens.radius.md },
})
