# UI PRIMITIVES KNOWLEDGE BASE

## OVERVIEW

High-reach shadcn/Radix-style presentation primitives. `Button`, `Typography`, and
`Card` have broad consumers; changes here require visual, accessibility, dark-mode,
and call-site awareness.

## STRUCTURE

```text
Table/       # TanStack table composition
charts/      # Shared chart cards/wrappers
Typography/  # Central CVA type scale
Animations/  # Legacy/shared motion seams
*.tsx        # Radix/shadcn-style primitives
```

## CONVENTIONS

- Keep primitives presentation-only. Feature data fetching, analytics, and domain policy belong outside `components/ui`.
- Compose Radix behavior, CVA variants, and `cn()` class merging. Preserve controlled/uncontrolled and ref behavior at the primitive boundary.
- Use tokens from `theme/globals.css`; support light and dark modes. Do not add raw color values or nonexistent Tailwind config dependencies.
- Use Geist Mono for every financial value/ticker. Green/red communicate gain/loss only and always need a non-color cue.
- Buttons/actions have visible text or an accessible label/tooltip; mobile touch targets are at least 44x44.
- Cards use semantic surfaces and borders without default decorative gradients, colored borders, or shadows.
- Badges communicate real status, never promotion. Empty states use realistic product previews, one sentence, and one CTA.
- New icons use Lucide except justified brand/payment cases.
- Charts use `ChartContainer`/`ChartConfig`, chart tokens, transparent backgrounds, explicit heights, responsive wrappers, and accessible series differentiation.
- Motion is subtle and functional; honor reduced motion. Avoid bounce, pulse, parallax, animated gradients, and staggered entrances.

## ANTI-PATTERNS

- Existing raw-color `Modal`, multiple animation systems, gradient helpers, or unreferenced CSS are legacy evidence, not patterns to copy.
- Never regenerate shadcn primitives blindly: `components.json` has stale Tailwind and `rsc:false` settings.
- Never put business logic into a shared primitive to satisfy one feature.
- Never communicate a financial state by color alone.
- Never add a second competing chart/table/type abstraction without checking current consumers.

## VERIFICATION

```bash
pnpm type-check
pnpm lint
```

Exercise changed states in both themes and mobile/keyboard layouts; run the targeted chart, table, searchable-select, or layout regression script when applicable.
