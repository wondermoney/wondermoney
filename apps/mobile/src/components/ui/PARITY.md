# WM mobile system

Two layers. **Calm structure** (below, first) is the direction the app is moving to: the same
anatomy on every screen, actions in fixed places, rows as the unit, four text levels with real
contrast, and space instead of lines. Home, Transactions and Add transaction are its pilots;
other screens keep the web-parity rules further down until they move over.

## Calm structure

### The anatomy

- **Tab and section screens**: the shell top bar and section tabs (already mounted), then the
  page title row (`PageHeader`: title, help glyph, at most one overflow `IconButton`), the
  figure block (`HeadlineFigure`), at most one control, then the list.
- **Flow screens** (create, edit): a `FormBar` instead of a back link and a bottom submit.
- **Adding** on a list screen is a `FloatingActionButton`. Secondary actions (import, scan) sit
  behind the title row's overflow glyph, which opens an `OptionSheet` in `menu` mode. No icon
  buttons on the title row besides that one.
- **Sections** are separated by 32–40pt of space and a 20/600 heading (`Section variant="open"`),
  not by rules or cards. A checklist may stay one quiet bordered block.

### Text levels

| Level | Role | Use |
|---|---|---|
| Headline figure | `display` / `figure` Mono, cents at 55% | `HeadlineFigure` (on by default), `Amount split` |
| Section heading | `heading` 20/28 600, foreground | `Section variant="open"`, `ListGroupHeading variant="heading"` |
| Row title | `bodyStrong` 16/500 | `ListRow density="comfortable"`, form row labels use `body` |
| Meta | `meta` 14, muted | row meta, status lines, notes under rows |

Colour only where it means something: violet for actions and selection, green and red for
change, amber for attention. Everything else is neutral ink.

### `FormBar` (`form-bar`)
`FormBar({ title?, onClose, closeLabel, closeDisabled?, onSave?, saveLabel?, saveDisabled?,
saving?, testID? })`. ✕ left (close the flow), ✓ right in violet. `saveDisabled` until the form is
valid; `saving` shows a spinner and announces busy. Put it first inside the screen's
`SafeAreaView`, outside the `ScrollView`. Without `onSave` it shows close only (loading, error).
```tsx
<SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
  <FormBar title={t('x.title')} closeLabel={t('common.close')} onClose={() => router.back()}
    onSave={save} saveLabel={t('x.save')} saveDisabled={!valid} saving={mutation.isPending} />
  <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }}>…</ScrollView>
</SafeAreaView>
```

### `IconButton` (`icon-button`)
`IconButton({ icon, accessibilityLabel, onPress, tone?: default | primary, disabled?, loading? })`:
a bare 44pt glyph control (FormBar's ✕ and ✓, the title row's overflow).
```tsx
<PageHeader title={t('transactions.title')} helpText={t('transactions.help')} helpLabel={false}
  action={<IconButton icon="more-vertical" accessibilityLabel={t('transactions.importOrScan')} onPress={openMenu} />} />
```
`more-vertical` is Material's ⋮ on Android and the horizontal ellipsis on iOS (each platform's
own overflow glyph).

### `FloatingActionButton` (`floating-action-button`)
`FloatingActionButton({ accessibilityLabel, onPress, icon? = plus, disabled?, aboveTabBar? })`:
56pt, violet, 16pt from the bottom-right, plus the bottom safe-area inset (pass `aboveTabBar`
inside the tab group, where the bar already sits on the inset). Render it as a sibling of the
`SafeAreaView` inside a `flex: 1` View, and pad the list by `FLOATING_ACTION_SIZE + 32`. Hide it
while a selection bar is up.
```tsx
<View style={{ flex: 1 }}>
  <SafeAreaView style={{ flex: 1 }}><FlatList contentContainerStyle={{ paddingBottom: FLOATING_ACTION_SIZE + 32 }} … /></SafeAreaView>
  <FloatingActionButton accessibilityLabel={t('transactionCreate.action')} onPress={onCreate} testID="transactions-create" />
</View>
```

### `FormGroup`, `FormRow`, `FormSelectRow`, `FormTextRow`, `FormSwitchRow`, `FormRowNote` (`form-row`)
A field is a 56pt row: label left (body, foreground), value right (body; muted placeholder when
empty: "Choose", "None", "Today"). `FormGroup` is the one subtle rounded container with
hairlines between rows. The accessible name is "label, value"; pass `accessibilityLabel` when it
should differ from the visible label ("Category (optional)"). `error` puts a destructive line
under the row (role alert); `hint` a muted one. The label never truncates: it keeps its natural
width (wrapping past two thirds of the row) and the value or input beside it shrinks instead.
- `FormRow({ label, value?, placeholder?, onPress, … })` opens your own sheet or picker.
- `FormSelectRow({ options, value, onChange, placeholder, sheetTitle?, … })` opens an `OptionSheet`.
- `FormTextRow({ label, value, onChangeText, multiline?, … TextInputProps })`: typed, value
  right-aligned; `multiline` (a note) puts the label above a growing field.
- `FormSwitchRow({ label, value, onValueChange, hint?, disabled?, accessibilityLabel?,
  accessibilityHint?, testID? })`: a yes/no field, label (and `hint` as a muted line under it)
  left, the native switch right. The switch is the accessible element (role `switch`, name
  `accessibilityLabel ?? label`, `checked`/`disabled` state, `testID`); a tap anywhere on the row
  toggles it, and the row draws the focus ring while the switch has focus. Tests drive it with
  `fireEvent(getByRole('switch', { name }), 'valueChange', next)` or a press on the label.
- `DateField appearance="row"` is the date as a row; `formatValue` shows "Today".
```tsx
<FormGroup>
  <FormSelectRow label={t('x.account')} options={accounts} value={accountId} onChange={setAccountId} placeholder={t('x.choose')} />
  <FormTextRow label={t('x.description')} value={description} onChangeText={setDescription} placeholder={t('x.optional')} />
  <DateField appearance="row" label={t('x.date')} value={date} onChange={setDate} formatValue={(d) => isToday(d) ? t('x.today') : null} />
  <FormSwitchRow label={t('x.private')} hint={t('x.privateHelper')} value={isPrivate} onValueChange={setIsPrivate} disabled={locked} />
</FormGroup>
```

### Quiet destructive action (`Button variant="destructive-quiet"`)
A flow's "Delete X" sits at the bottom of the screen, below the last group, never in the
`FormBar`. It is destructive ink with no box (body-strong label, a trash glyph, 44pt tall,
hugging the start edge); `loading` swaps the glyph for a spinner and announces busy. Put the
muted consequence line under it, and confirm before deleting.
```tsx
<View style={{ marginTop: themeTokens.spacing[6], gap: themeTokens.spacing[1] }}>
  <Button variant="destructive-quiet" icon="trash" label={pending ? t('x.deleting') : t('x.delete')}
    loading={pending} disabled={locked} onPress={confirmDelete} />
  <Text tone="muted" variant="meta">{t('x.dangerHelper')}</Text>
</View>
```

### `AmountEntry` (`amount-entry`)
`AmountEntry({ value, onChangeText, currency, locale, accessibilityLabel, caption?, error?,
editable?, autoFocus? })`: the flow's amount, big and centred in Geist Mono at `display`, the
currency symbol muted on the locale's side. Tapping the block opens a decimal keypad. Strings in
and out; the caller accepts `,` as the decimal point.
```tsx
<AmountEntry accessibilityLabel={t('x.amount')} value={amount} onChangeText={setAmount}
  currency={currency?.code ?? null} locale={locale} error={amountError} />
```

### `HeadlineFigure` small cents and status line
Cents are set at 55% on the figure's baseline by default (`splitCents={false}` turns it off;
`Amount split` does the same on any amount). `status` adds the status line after the label: a
dot in its tone and the words in muted ink; the deltas under the figure are the context lines.
```tsx
<HeadlineFigure label={t('home.netWorth.title')} labelIsHeader status={{ label: t('home.balancesUpdated', { time }) }}
  value={total} currency="EUR" locale={locale} deltaSize="amountBase"
  deltas={[{ value: 14438.66, label: t('home.netWorth.since', { month }) }]} />
```

### `Section variant="open"` (`section`)
No rule, a 20/600 heading, 16pt to the content. The screen spaces sections 32–40pt apart. This
is a variant rather than a change to `ruled`, because 20 other screens still use `ruled` and
move over one at a time. `ListGroupHeading variant="heading"` is the same level for a ledger's
months (pass `first` on the opening one). `ListRow density="comfortable"` is the 16/500 row.
```tsx
<Section title={t('home.month.title')} aside={daysLeft} variant="open">…</Section>
```

### `EntityMark` (`entity-mark`)
Every row that names a thing leads with one mark, so a list scans by shape before words.
`EntityMark({ image?, icon?, initials?, glyph?, size?: md 36 | sm 24, testID? })`, a rounded
square (radius md). The first source that can draw wins: `image` (a logo, on a forced white
backing with a hairline so it reads in dark mode; it falls through when missing, not http(s),
or `onError`), `icon` (a category's icon on its own `bgColor`/`textColor`; ink is picked for
contrast when only the background is set), `initials` (first two letters, mono, muted surface),
`glyph` (an `Icon`, muted surface). Decorative: hidden from screen readers, so the row's label
names the thing. It is the only category mark in the app (budgets, categories, the ledger).
Sources: `assetMark(symbol, logoUrl)` (web `FinancialAssetLogo`: coins for `CURRENCY_*`),
`accountMark({ logoUrl, institutionName, type })` (logo, letters, then a type glyph: card,
house, piggy bank, chart, bank), `portfolioMark(broker?)` (briefcase without a broker), and
`transactionMark(...)` in `features/transactions` (category, transfer arrows, the institution on
the opening row, a muted tag when uncategorised). Use `md` in `ListRow leading`, `sm` in sheets
(`SheetOption.leading`), form values (`FormSelectRow` shows the chosen option's `leading`) and
dense summaries; `ObjectHeader leading` puts it before a detail title.
```tsx
<ListRow leading={<EntityMark {...accountMark({ logoUrl, institutionName, type })} />} title={name} … />
<ListRow leading={<EntityMark {...assetMark(holding.symbol, holding.logoUrl)} />} title={holding.symbol} … />
```

### `MerchantAvatar` (`features/merchants/merchant-avatar`)
Web's `MerchantAvatar`: the lead mark of a transaction row that has a merchant, in the same
36pt column as `EntityMark` but a circle. `MerchantAvatar({ name, resolvedLogoUrl?, size?: md | sm })`
draws the API's `resolvedLogoUrl` on the white logo backing, and otherwise (or after `onError`,
until the URL changes) the name's first letter on one of eight fills hashed from the normalized
name (`merchant-avatar-model`, the same FNV-1a and palette order as web: blue, teal, amber,
fuchsia, sky, orange, stone, slate, never red, green or brand violet; colours in
`merchantAvatarSources`/`merchantAvatarColors` in `theme/tokens.ts`). A logo on the API's own
origin (the logo proxy) carries the bearer token; any other URL loads without credentials
(`lib/api/api-image-source`). Decorative, like `EntityMark`. `transactionMerchantAvatar(...)` in
`features/transactions` picks it: not for transfers or the opening row, which keep their mark.

### `SegmentedControl fill`
Stretches the track and shares it equally: the flow's Expense | Income | Transfer, the chart's
range switch. Every label stays on one line and shrinks its font to fit rather than break a word; keep
segments to two or three short words and put any further choices behind a `FormSelectRow`
(a portfolio trade: Buy | Sell, then a Type row for deposit, withdrawal and the rest).

### `StatColumns` / `StatCell` (`stat`)
The secondary stats under a page's one `HeadlineFigure`: one row of 2–3 equal columns, or a
2×2 grid for four, each a muted label over an `amountBase` value. A value never wraps: it stays
on one line and shrinks to fit its column (`Amount fit`, down to 60%). Never stack summary
figures full-width at a large size.
```tsx
<HeadlineFigure label={t('goals.status.funded')} status={{ label: t('goals.ofAmount', { amount }) }} value={funded} currency={currency} locale={locale} />
<StatColumns>
  <StatCell label={t('goals.target')} value={target} currency={currency} locale={locale} />
  <StatCell label={t('goals.tabActive')} locale={locale}>{String(activeCount)}</StatCell>
</StatColumns>
```

## Web parity

The mobile app matches the web app at 390px. Web source is the spec
(`apps/web/components/layout/*`, `apps/web/components/ui/*`, the page components). Build every
screen from the pieces below. Read the web page's Tailwind classes and map them with the tables
here. Don't hand-roll a size, colour or spacing.

### Shell (already mounted; screens do nothing)

- **Top bar** (`features/navigation/shell-top-bar.tsx` → `components/shell/top-bar.tsx`). It is
  mounted once in `src/app/(app)/_layout.tsx` above the Stack and shows on every `(app)` route
  except flows (`/create`, `/edit`, `/import`, `/scan`, `/connect`, `/add`, `/transaction-create`;
  see `showsTopBar` in `components/shell/navigation.ts`). It has the Wonder wordmark (which goes
  Home), the person menu (Settings → `/settings/profile`, as web's `/settings`; Appearance & Language → `/settings/preferences`,
  Help, Dark/Light mode, Sign out, version) and a hairline, and it **owns the top safe area**.
- **Section tabs** sit under the bar inside Accounts (Overview `/accounts`, Transactions
  `/accounts/transactions`, Bills & subscriptions `/accounts/recurring`), Portfolio (Overview
  `/portfolio`, Transactions `/portfolio/activity`) and Financial Markets (Explorer `/markets`,
  Watchlist `/markets/watchlist`). Detail pages under a section show the tabs too, with Overview
  current, as web does. Items have role `link`.
- **Bottom bar** (`features/navigation/product-navigation.tsx`). Plain, with a hairline top
  border, 64pt high, outline icons and 12px labels. The current item is foreground at weight 500,
  the others muted. testIDs `product-bottom-bar` / `product-rail` are unchanged.

What a screen should do: wrap itself in `SafeAreaView` from `@/components/ui/screen-safe-area`
(never straight from `react-native-safe-area-context`), then a `ScrollView` with
`padding: themeTokens.layout.screenPadding` (16). While the top bar shows, that SafeAreaView drops
its top edge (`UnderTopBarProvider` in `(app)/_layout.tsx`), so the title sits 16pt under the
shell, as web's does; a native SafeAreaView there added the whole top inset again (a 60pt gap). On
a flow route the bar is hidden and the same SafeAreaView pads the notch. Don't render your own
logo, avatar or section switcher, and don't add top padding of your own.

### Type scale (`variant` on `<Text>`, `textStyles.*`, `size` on `<Amount>`)

| Role | Size/weight | Web class |
|---|---|---|
| `display` | Mono 48/60 500 | `font-mono text-5xl font-medium` (page lead figure) |
| `figure` | Mono 36/44 500 | `text-4xl` (ObjectHeader value) |
| `stat` | Mono 24/32 500 | StatCard value `text-2xl font-medium` |
| `title` | 24/32 600 | page `<h1>` `text-2xl font-semibold` |
| `heading` | 20/28 600 | calm-structure section head (no web equivalent yet) |
| `section` | 18/28 600 | RuledSection head `text-lg font-semibold` |
| `subheading` | 16/24 500 | `text-base font-medium` ("Total balance") |
| `body` / `bodyStrong` | 16/24 400/500 | `text-base` |
| `meta` / `metaStrong` | 14/20 400/500 | `text-sm` / `text-sm font-medium` |
| `label` | 12/16 400 | `text-xs` (sentence case, never tracked) |
| `action` | 14/20 500 | button label |
| `amountLarge` | Mono 18/28 500 | `font-mono text-lg` (home You own/You owe and a budget's "left", budget lead Spent/Planned, portfolio metrics; web's weight there runs 400–600, mobile uses 500) |
| `amountBase` | Mono 16/24 400 | `font-mono text-base` (home's change lines) |
| `amount` / `amountSmall` | Mono 14/20 500, 12/16 400 | `font-mono text-sm` / `text-xs` |

Tones: `default` `muted` `primary` `destructive` `warning` `info` `success` (these use the `-text`
tokens). Spacing comes from `themeTokens.spacing` (4/8/12/16/24/32/48). Sizes come from
`themeTokens.size` (`control` 40, `controlSmall` 36, `icon` 20, `iconSmall` 16).
`touchTarget.minimum` is **44**: controls draw at 40 and reach 44 through `hitSlop`.

### Components

All paths are under `@/components/ui/` unless noted.

#### `PageHeader` (`page-header`): web page `<h1>` + help hint + actions
Props: `title`, `helpText?` (opens "(?) Help"), `helpLabel?` (default true; `false` gives web's
icon-only hint), `description?` (only where web has one), `badge?`, `provenance?`,
`actions?` (stacked full width, gap 8), `action?` (inline), `instruction?` (flows only).
```tsx
<PageHeader title={t('accounts.overviewTitle')} helpText={t('accounts.help')}
  actions={<><SelectTrigger accessibilityLabel={t('x.period')} value={periodLabel} onPress={openPicker} />
    <Button label={t('x.addTransaction')} icon="plus" block onPress={add} />
    <Button label={t('x.addAccount')} icon="plus" variant="outline" block onPress={addAccount} /></>} />
```

#### `ObjectHeader` (`page-header`): detail title (name, descriptor, badge, figure)
Put `<BackControl>` above it. Pass `figure={<HeadlineFigure size="md" …/>}`. The title row never wraps:
`action` stays at its end, vertically centred on the title, and the title wraps (up to three
lines) in the space left.

#### `BackControl` / `BackLink` (`back-control`): web "← Accounts"
`BackControl({ fallback, onPress?, label?, destination?, disabled? })`. It shows the name of the
section `fallback` points to (`/accounts` → "Accounts", `/accounts/transactions` →
"Transactions", `/more` → "More"; anything else → "Back"). Pass `destination` to override the
name. The accessible name stays `label ?? "Back"`.
`BackLink({ label, onPress, accessibilityLabel?, disabled? })` is the bare look.

#### `HeadlineFigure` (`headline-figure`): lead figure (home Net worth, accounts Total balance)
Props: `label?`, `labelTone?` (`lead` 16/500 | `muted` 14), `labelAside?`, `status?`,
`labelIsHeader?`, `splitCents?` (default true), `value`, `currency`,
`locale`, `size?` (`lg` 48 | `md` 36), `deltas?: {value,label,trend?}[]`,
`secondary?: {value,currency}`, `deltaSize?` (`amount` 14 | `amountBase` 16), `accessibilityLabel?`
(makes the figure and its changes one accessible element with that reading; the label row stays
its own), `footer?`.
```tsx
<HeadlineFigure label={t('home.netWorth')} labelAside={updatedLabel} value={total} currency="EUR" locale={locale}
  deltas={[{ value: -539.02, label: t('home.sinceEndOf', { month }) }]} />
```

#### `Stat`, `StatList`, `StatValue` (`stat`): web StatCard / StatCardGrid
`Stat` props: `label`, `icon?` (IconName), `value?`, `currency?`, `locale`, `signed?`,
`valueNode?` (use `<StatValue>` for counts and percentages), `comparison?: {value,label}`,
`deltaPercent?` (0.12 = 12%), `trend?` (`up` | `down`: the trend icon alone, no percentage),
`positiveDirection?` (`up` | `down`), `aside?`, `helper?`. `StatValue` takes `size?` (`stat` 24 |
`amountLarge` 18).
`StatList` props: `columns?` (1 ruled stack | 2 grid). Don't wrap these in a `Card`.
```tsx
<StatList>
  <Stat icon="arrow-down-left" label={t('x.inflow')} value={in_} currency="EUR" locale={locale}
    comparison={{ value: prevIn, label: t('x.vsLastPeriod') }} deltaPercent={2.67} />
  <Stat icon="arrow-up-right" label={t('x.outflow')} value={out} currency="EUR" locale={locale} deltaPercent={3.97} positiveDirection="down" />
</StatList>
```
`StatCard` (`card`) is deprecated; use `Stat`.

#### `Button` (`button`): web button
Props: `label`, `onPress`, `variant?` (`primary` | `outline` (violet border and text) |
`secondary` | `ghost` | `link` | `destructive` | `destructive-quiet` (a flow's bottom "Delete X",
see Calm structure)), `size?` (`default` 40 | `sm` 36 | `icon` 40×40,
label for screen readers only), `icon?` and `trailingIcon?` (IconName), `block?`/`fullWidth?`,
`count?` + `countTone?` (`primary` | `secondary`: web's "Filters ②" pill, hidden at 0; put the
count in `accessibilityLabel` too), `loading?`, `disabled?`, `accessibilityLabel?`, `testID?`. Use
one `primary` per section.

#### `SelectTrigger` (`select-trigger`): web `SelectTrigger` ("Year to Date ▾")
Props: `value?`, `placeholder?`, `onPress` (you open the picker), `accessibilityLabel`,
`block?` (default hugs, min 180), `icon?` (a muted leading glyph, e.g. `calendar`), `invalid?`,
`disabled?`.

#### `SegmentedControl` (`segmented-control`): web Tabs (Month | Year, Active | Archived)
Props: `options: {value,label}[]`, `value`, `onChange`, `accessibilityLabel`, `scrollable?`. The
track is muted and the selected segment is the canvas colour plus `shadow-xs`. No violet.

#### `Section`, `SectionHeading`, `Divider` (`section`)
- `Section({ title?, aside?, action?, variant? })`: `variant="ruled"` is web's RuledSection (2pt
  foreground rule, 18/600 head, 24 to content). The default `plain` has no rule. `open` is the
  calm-structure section (see above).
- `SectionHeading({ title, action? })` is web SectionHeader, 14/500.
- `Divider({ variant? })`: `hairline` (1pt border) | `rule` (2pt foreground, the ledger filter row).
- `EmptyState` is unchanged.

#### `ListRow`, `List`, `ListGroupHeading` (`list-row`): web mobile transactions list
`ListRow` props: `title` (14/500), `meta?: string[]` (12 muted), `figure?` (right, on the
title line; use `<Amount size="amount">`), `figureMeta?`, `badge?`, `leading?`, `children?`,
`onPress?`, `onMorePress?` + `moreAccessibilityLabel` (the trailing "…"), `separated?`. The leading
element, the row's press target and the "…" are siblings, so VoiceOver reaches a leading control
(a checkbox) and the menu on their own; `testID` and `accessibilityLabel` sit on the press target.
`List({ divided?, ruled? })`. `ListGroupHeading({ title, separated? })` is the month line
("October 2025").
```tsx
<ListGroupHeading title="November 2026" />
<List divided ruled>
  {rows.map((r) => <ListRow key={r.id} title={r.name} meta={[`${r.account} · ${r.date}`]}
    figure={<Amount value={r.amount} currency={r.currency} locale={locale} />}
    onMorePress={() => openActions(r)} moreAccessibilityLabel={t('x.actionsFor', { name: r.name })} />)}
</List>
```

#### `Card` (`card`): web Card
1pt hairline, 8pt radius, no shadow; `density?` (`data` 16 | `standalone` 24). Never nest a
bordered box inside one.

#### `Badge` (`badge`): web Badge
`tone?`: `outline` (plain "Active" chip) | `neutral`/`muted` | `secondary` | `primary` |
`success` | `warning` | `destructive` | `info`. 12/600, 4pt radius.

#### `Amount` (`amount`)
`size?`: `display` | `figure` | `stat` | `amount` | `amountSmall`. `delta` colours the amount
by its sign. `split` sets the cents at 55%. The currency symbol is always muted, and `null`
renders `—`.

#### `DataProvenance` (`data-provenance`): web DataProvenance / AccountsFreshness
"Balances updated 1 day ago" in muted 12px. Props: `updatedAt`, `label?: (time) => string`,
`isStale?` (amber, 500), `errorLabel?` (destructive, replaces the time), `icon?` (refresh glyph,
default on; off for home and transactions, which use web's plain AccountsFreshness), `timeStyle?`.
Nothing renders without a valid time. The words come from `formatRelativeTime` in
`@/lib/formatters/relative-time` (`common.relativeTime.*`): `distance` is date-fns
`formatDistanceToNow` ("about 5 hours ago", "1 day ago"); `calendar` is web recurring's
`Intl.RelativeTimeFormat` numeric auto ("5 hours ago", "yesterday"). Don't use
`Intl.RelativeTimeFormat` directly: Hermes lacks it on some runtimes and it fell back to a date.

#### `Sheet`, `OptionSheet` (`sheet`): web DrawerDialog / Select and DropdownMenu content
`Sheet({ visible, title, closeLabel?, onClose, footer?, children })`: a bottom sheet with title,
close and scrolling content. `OptionSheet({ visible, title, options | groups, value?, mode?,
dismissLabel?, onSelect, onClose })`: `choice` (radio rows, current value violet with a check) or
`menu` (menu items). Choosing closes the sheet, then calls `onSelect`.

#### `Notice` (`notice`): web's quiet Alert
`Notice({ title?, message?, tone?: default | destructive | warning, action? })`: hairline in the
status ink, no tint, one accessible alert. `Banner` stays for the info/success register.

#### `ProgressBar` (`progress-bar`): web GoalProgressBar and the meters
`ProgressBar({ value: 0–100, color? (default chart1), track?: muted | border, height?: 8 | 6 })`.
Decorative; print the figure beside it. `testID` lands on the fill.

#### `DateField` (`date-field`)
14/500 label and a 40pt control, like the other fields (`features/transactions/form-field.tsx`).

#### `Icon` (`icon`): lucide name → SF Symbol / Material
`<Icon name="trending-up" color={palette.successText} size={14} weight="semibold" />`. See
`ICONS` in `icon.tsx` for the names; add new ones there. Icons are decorative (`accessible={false}`).

#### `Avatar` (`avatar`)
`tone="neutral"` is the person-menu look.

### Rules that still bite

- Every colour comes from `usePalette()`, and you check both themes.
- No tracked caps, emoji, gradients or card-in-card.
- Labels use web's exact strings. The shell keys are `navigation.overview`, `.transactions`,
  `.billsSubscriptions`, `.financialMarkets`, `.explorer`, `.watchlist`, `.goals`, `.loans`,
  `.reports`, `.help`, `.settings`.
- Keep every testID and accessibility label that tests use.
