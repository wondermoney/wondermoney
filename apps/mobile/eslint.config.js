// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

/**
 * The parts of `DESIGN.md` a type-checker cannot see.
 *
 * Every rule here exists because the codebase broke it at scale before the design-system
 * port (23 ad-hoc font sizes, 40 balances coloured by sign, 30 page subtitles, 10 uppercase
 * micro-labels). Each is cheap to reintroduce one file at a time and expensive to find by eye.
 *
 * `except` lists the files a rule deliberately does not apply to, each with its reason.
 * ESLint applies only the last matching `no-restricted-syntax` setting to a file, so the
 * blocks below are generated: one for all production source, then one per excepted file
 * carrying every rule that still applies to it.
 */
const DESIGN_RULES = [
  {
    // A screen needing a size the scale lacks is telling you a role is missing.
    selector: "Property[key.name='fontSize'][value.type='Literal']",
    message: "Declare type through the scale (themeTokens.type), never an ad-hoc fontSize.",
    except: [
      'src/theme/tokens.ts', // the scale itself
    ],
  },
  {
    selector: "Property[key.name='textTransform'][value.value='uppercase']",
    message: "No uppercase micro-labels: use sentence case and the `label` type role.",
  },
  {
    // The `financial.positive` / `financial.negative` aliases are gone; their return would
    // mean balances are being coloured by sign again.
    selector:
      "MemberExpression[property.name=/^(positive|negative)$/]:matches([object.name='financial'], [object.property.name='financial'])",
    message: "Do not colour an amount by its sign (financial.positive/negative are retired).",
  },
  {
    // Object descriptors go on ObjectHeader, form instructions on `instruction`, facts about
    // the data on `provenance`.
    selector: "JSXAttribute[name.name='subtitle']",
    message: "No page subtitles: use ObjectHeader, `instruction` or `provenance` instead.",
    except: ['src/components/ui/page-header.tsx'],
  },
  {
    selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/], Literal[value=/\\brgba?\\(/], TemplateElement[value.raw=/\\brgba?\\(/]",
    message: "Read colour from the palette (themeTokens.colors), never from a literal.",
    // Accepted debt / not-debt, each recorded in DESIGN_HISTORY.md's Accepted debt table.
    except: [
      'src/theme/tokens.ts',
      'src/features/auth/social-sign-in-buttons.tsx', // Google brand marks
      'src/features/categories/category-manage-screen.tsx', // persisted data default
      'src/features/categories/category-manage-route.tsx', // same
      'src/features/reports/spending-by-category-report-view-model.ts', // "Other" bucket
    ],
  },
  {
    // These aliased the real tokens so the port could land incrementally.
    selector:
      "MemberExpression[object.name='palette'][property.name=/^(surface|surfaceMuted|surfaceElevated|textMuted|separator|interaction|interactionMuted|budget|text)$/]",
    message: "This palette alias is retired; use the current semantic token from themeTokens.colors.",
  },
  {
    // 44 files once had their own structurally identical copy. Import `Palette` from
    // '@/theme/tokens' instead.
    selector: "TSTypeAliasDeclaration[id.name='Palette']:not(ExportNamedDeclaration > TSTypeAliasDeclaration)",
    message: "Do not re-declare the Palette type; import it from '@/theme/tokens'.",
  },
  {
    // Bare numbers walk straight past every token-based sweep, which is how four screens
    // kept the old spacing through the density pass.
    selector:
      "Property[key.name=/^(padding|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|gap|rowGap|columnGap)$/][value.type='Literal'][value.value>=12][value.value<100]",
    message: "Space from the scale (themeTokens.space), never from a raw pixel value.",
    except: ['src/theme/tokens.ts'],
  },
  {
    // Nesting silently disables virtualization: an empty search once rendered ~1000
    // institutions into a ScrollView, and React Native's warning rendered over the app.
    selector:
      "JSXElement[openingElement.name.name='ScrollView'] JSXOpeningElement[name.name=/^(FlatList|SectionList|VirtualizedList)$/]",
    message: "Do not nest a virtualized list inside a ScrollView; it disables virtualization.",
  },
  {
    // `--primary` and `--chart-1` are both violet 290, so an accent-coloured series is
    // indistinguishable from slot 1.
    selector:
      "JSXOpeningElement:matches([name.name=/^(Line|Scatter|Area|Bar)$/], [name.object.name='BarGroup'][name.property.name='Bar']) > JSXAttribute[name.name='color'] > JSXExpressionContainer > MemberExpression[object.name='palette'][property.name='primary']",
    message: "A chart series takes a chart slot colour, not the accent (palette.primary).",
  },
  {
    // Depth is border-first; shadow.overlay is for sheets, dialogs and popovers only.
    selector:
      "MemberExpression[object.object.name='themeTokens'][object.property.name='shadow'][property.name!='overlay']",
    message: "Cards are border-defined; only themeTokens.shadow.overlay (for overlays) is allowed.",
  },
];

const PRODUCTION_FILES = ['src/**/*.ts', 'src/**/*.tsx'];
const NON_PRODUCTION = ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**', '**/*test-fixtures*', '**/*test-fixtures*/**'];

const restricted = (rules) => ({
  'no-restricted-syntax': ['error', ...rules.map(({ selector, message }) => ({ selector, message }))],
});

const exceptedFiles = [...new Set(DESIGN_RULES.flatMap((rule) => rule.except ?? []))];

const designSystemConfig = [
  { files: PRODUCTION_FILES, ignores: NON_PRODUCTION, rules: restricted(DESIGN_RULES) },
  ...exceptedFiles.map((file) => ({
    files: [file],
    rules: restricted(DESIGN_RULES.filter((rule) => !(rule.except ?? []).includes(file))),
  })),
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  ...designSystemConfig,
]);
