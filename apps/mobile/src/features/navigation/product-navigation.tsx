import { Tabs } from 'expo-router'
import type { ComponentProps } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Icon, type IconName } from '@/components/ui/icon'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type ProductNavigationProps = {
  labels: { home: string; accounts: string; budgets: string; portfolio: string; more: string; mainNavigation?: string }
  availableWidth?: number
}

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0]

const WIDE_BREAKPOINT = 768
const RAIL_WIDTH = 220

/**
 * Tab icons: web BottomNav's lucide glyphs (Home, Landmark, PieChart,
 * Briefcase, LayoutGrid) as outline system symbols. Current is shown by
 * weight and ink, never by a filled glyph — web does it with `strokeWidth`.
 */
const TAB_ICONS: Record<string, IconName> = {
  index: 'home',
  accounts: 'landmark',
  budgets: 'pie-chart',
  portfolio: 'briefcase',
  more: 'layout-grid',
}

function DomainGlyph({ name, active, color }: { name: string; active: boolean; color: string }) {
  return <Icon color={color} name={TAB_ICONS[name] ?? 'layout-grid'} size={themeTokens.size.icon} weight={active ? 'semibold' : 'light'} />
}

function ProductTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  wide,
  palette,
  mainNavigationLabel,
}: TabBarProps & { wide: boolean; palette: Palette; mainNavigationLabel?: string }) {
  const targets = state.routes.map((route, index) => {
    const selected = state.index === index
    const label = descriptors[route.key].options.title ?? route.name
    const onPress = () => {
      const event = emitter.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      })
      if (!selected && !event.defaultPrevented) navigateToTab(route.key)
    }

    return (
      <Pressable
        key={route.key}
        accessibilityLabel={String(label)}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.target,
          wide ? styles.railTarget : styles.bottomTarget,
          // Web: the bottom bar marks current with ink and weight only; the
          // sidebar (the rail's counterpart) gives it violet on a 10% wash.
          wide && selected && { backgroundColor: palette.primarySoft },
          pressed && styles.pressed,
        ]}
      >
        <DomainGlyph
          name={route.name}
          active={selected}
          color={wide ? (selected ? palette.primary : palette.mutedForeground) : selected ? palette.foreground : palette.mutedForeground}
        />
        <Text
          allowFontScaling
          style={[
            styles.label,
            wide ? styles.railLabel : styles.bottomLabel,
            {
              color: wide ? (selected ? palette.primary : palette.foreground) : selected ? palette.foreground : palette.mutedForeground,
              fontWeight: selected ? '500' : '400',
            },
          ]}
        >
          {String(label)}
        </Text>
      </Pressable>
    )
  })

  return (
    <SafeAreaView
      edges={wide ? ['bottom', 'left'] : ['bottom', 'left', 'right']}
      style={[
        wide ? styles.railSafeArea : styles.bottomSafeArea,
        { backgroundColor: palette.background, borderColor: palette.border },
      ]}
    >
      {wide ? (
        <ScrollView
          testID="product-rail"
          accessibilityLabel={mainNavigationLabel}
          accessibilityRole="tablist"
          contentContainerStyle={styles.rail}
        >
          {targets}
        </ScrollView>
      ) : (
        <View testID="product-bottom-bar" accessibilityLabel={mainNavigationLabel} accessibilityRole="tablist" style={styles.bottomBar}>
          {targets}
        </View>
      )}
    </SafeAreaView>
  )
}

export function ProductNavigation({ labels, availableWidth }: ProductNavigationProps) {
  const window = useWindowDimensions()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const wide = (availableWidth ?? window.width) >= WIDE_BREAKPOINT

  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <ProductTabBar {...props} wide={wide} palette={palette} mainNavigationLabel={labels.mainNavigation} />}
      screenOptions={{
        animation: 'none',
        headerShown: false,
        sceneStyle: { backgroundColor: palette.background },
        tabBarPosition: wide ? 'left' : 'bottom',
      }}
    >
      <Tabs.Screen name="index" options={{ title: labels.home }} />
      <Tabs.Screen name="accounts" options={{ title: labels.accounts }} />
      <Tabs.Screen name="budgets" options={{ title: labels.budgets }} />
      <Tabs.Screen name="portfolio" options={{ title: labels.portfolio }} />
      <Tabs.Screen name="more" options={{ title: labels.more }} />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  railSafeArea: {
    width: RAIL_WIDTH,
    borderRightWidth: 1,
  },
  bottomSafeArea: {
    borderTopWidth: 1,
  },
  rail: {
    flexGrow: 1,
    paddingHorizontal: themeTokens.spacing[3],
    paddingVertical: themeTokens.spacing[4],
    gap: themeTokens.spacing[1],
  },
  // Web BottomNav: a plain `h-16` bar, five equal cells, hairline on top.
  bottomBar: {
    flexDirection: 'row',
    height: themeTokens.size.bottomBar,
    alignItems: 'center',
  },
  target: {
    position: 'relative',
    minHeight: themeTokens.touchTarget.minimum,
    minWidth: themeTokens.touchTarget.minimum,
    borderRadius: themeTokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  railTarget: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: themeTokens.spacing[4],
    paddingVertical: themeTokens.spacing[3],
    gap: themeTokens.spacing[3],
  },
  bottomTarget: {
    flex: 1,
    minHeight: themeTokens.size.bottomBar,
    paddingHorizontal: themeTokens.spacing[1],
    paddingVertical: themeTokens.spacing[2],
    gap: 2,
    borderRadius: 0,
  },
  pressed: { opacity: 0.72 },
  label: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
  },
  railLabel: { ...textStyles.meta, flexShrink: 1 },
  bottomLabel: { ...textStyles.label, textAlign: 'center' },
})
