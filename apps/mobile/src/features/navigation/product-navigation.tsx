import { Tabs } from 'expo-router'
import { SymbolView } from 'expo-symbols'
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

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type ProductNavigationProps = {
  labels: { home: string; accounts: string; budgets: string; portfolio: string; more: string }
  availableWidth?: number
}

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0]

const WIDE_BREAKPOINT = 768
const RAIL_WIDTH = 220

/**
 * Tab icons, matched to the web app's mobile bottom bar.
 *
 * Web draws Home / Landmark / PieChart / Briefcase / LayoutGrid; this drew
 * hand-built shapes — a house, three lines, a target ring, three bars and
 * three dots — so the same destination looked like a different thing on each
 * platform. These are the closest system symbols to web's icons, per platform,
 * which keeps the pairing recognisable without shipping an icon library.
 */
const TAB_SYMBOLS: Record<string, { ios: string; android: string; web: string }> = {
  index: { ios: 'house.fill', android: 'home', web: 'home' },
  accounts: { ios: 'building.columns.fill', android: 'account_balance', web: 'account_balance' },
  budgets: { ios: 'chart.pie.fill', android: 'pie_chart', web: 'pie_chart' },
  portfolio: { ios: 'briefcase.fill', android: 'work', web: 'work' },
  more: { ios: 'square.grid.2x2.fill', android: 'grid_view', web: 'grid_view' },
}

function DomainGlyph({ name, color }: { name: string; active: boolean; color: string }) {
  const symbol = TAB_SYMBOLS[name] ?? TAB_SYMBOLS.more!
  return <SymbolView name={symbol as never} size={22} tintColor={color} />
}

function ProductTabBar({
  state,
  descriptors,
  navigation,
  wide,
  palette,
}: TabBarProps & { wide: boolean; palette: Palette }) {
  const targets = state.routes.map((route, index) => {
    const selected = state.index === index
    const label = descriptors[route.key].options.title ?? route.name
    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      })
      if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params)
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
          selected && { backgroundColor: palette.primarySoft },
          pressed && styles.pressed,
        ]}
      >
        {selected ? (
          <View
            accessible={false}
            style={[
               styles.marker,
              wide ? styles.railMarker : styles.bottomMarker,
              { backgroundColor: palette.primary },
            ]}
          />
        ) : null}
        <DomainGlyph
          name={route.name}
          active={selected}
          color={selected ? palette.primary : palette.mutedForeground}
        />
        <Text
          allowFontScaling
          style={[
            styles.label,
            wide ? styles.railLabel : styles.bottomLabel,
            {
              color: selected ? palette.primary : palette.mutedForeground,
              fontWeight: selected ? '600' : '500',
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
      edges={wide ? ['top', 'bottom', 'left'] : ['bottom', 'left', 'right']}
      style={[
        wide ? styles.railSafeArea : styles.bottomSafeArea,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      {wide ? (
        <ScrollView
          testID="product-rail"
          accessibilityRole="tablist"
          contentContainerStyle={styles.rail}
        >
          {targets}
        </ScrollView>
      ) : (
        <View testID="product-bottom-bar" accessibilityRole="tablist" style={styles.bottomBar}>
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
      tabBar={(props) => <ProductTabBar {...props} wide={wide} palette={palette} />}
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
  bottomBar: {
    flexDirection: 'row',
    paddingHorizontal: themeTokens.spacing[1],
    paddingTop: themeTokens.spacing[1],
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
    minHeight: 64,
    paddingHorizontal: themeTokens.spacing[1],
    paddingVertical: themeTokens.spacing[2],
    gap: themeTokens.spacing[1],
  },
  pressed: { opacity: 0.72 },
  marker: {
    position: 'absolute',
    borderRadius: 0,
  },
  railMarker: {
    left: 0,
    width: 2,
    height: 28,
  },
  bottomMarker: {
    top: 0,
    width: 28,
    height: 2,
  },
  label: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
  },
  railLabel: {
    flexShrink: 1,
    fontSize: themeTokens.typography.roles.interface.fontSize,
    lineHeight: themeTokens.typography.roles.interface.lineHeight,
  },
  bottomLabel: { ...textStyles.label, textAlign: 'center' },
})
