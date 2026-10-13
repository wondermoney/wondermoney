# Sankey Chart

A custom, accessible Sankey diagram for cash-flow reports.

## Layout

- Three columns by default: `income` → `expense` → `account`.
- Falls back to two columns (`income` → `expense`) when no `account` nodes are present.
- Nodes are sized by total flow; link thickness encodes value (non-color cue).

## Colors

- Each source node owns a 3-stop left-to-right gradient.
- Default palette uses chart tokens: `chart-1` for income, `chart-2` for expenses, `chart-3` for accounts.
- Pass `color` on individual nodes to override.

## Interactions

- Hover a link to highlight it and dim others.
- Hover a node to highlight all connected links.
- Keyboard focus follows source-column order; focus uses the theme `ring` token.
- Tooltips show the full label and formatted currency value.

## Mobile

Below the `sm` breakpoint (640px), the SVG is replaced by a short notice and a table of the same links. A full Sankey with three columns and many labels becomes unreadable on narrow screens, so the table preserves the data while keeping text legible and touch targets large.

## Translations

All user-facing copy is read from the `reports.reports.sankey` namespace. The required keys are:

- `ariaLabel` — receives `{total}` formatted currency.
- `linkTooltip` — receives `{source}`, `{target}`, `{value}`.
- `nodeTooltip` — receives `{label}`, `{value}`.
- `mobileNotice`
- `mobileTableSource`
- `mobileTableTarget`
- `mobileTableValue`

## Usage

```tsx
import { SankeyChart } from "@/components/reports/sankey";

<SankeyChart
  data={{
    nodes: [
      { id: "salary", label: "Salary", kind: "income" },
      { id: "rent", label: "Rent", kind: "expense" },
      { id: "main", label: "Main Account", kind: "account" },
    ],
    links: [
      { source: "salary", target: "rent", value: 800 },
      { source: "salary", target: "main", value: 2200 },
    ],
  }}
  locale="en"
  currencyKey="EUR"
  height={360}
/>
```

## Notes

- Empty, loading, and error states are handled by the parent report component.
- No mount animation; hover transitions are 120ms and respect `prefers-reduced-motion`.
