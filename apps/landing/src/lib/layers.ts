/**
 * The z-index of every layer that floats over the page, in one place. Top first:
 *
 *   consent card > open drawer and dialogs > sticky mobile CTA > header and its menus
 *   > announcement banner > page
 *
 * The consent card stays above everything so a visitor can always answer it. The open mobile
 * drawer covers the banner, the header and the sticky CTA, so its close button and rows are
 * what a tap hits. The header's dropdowns stack inside the header (sticky, so it starts its own
 * stacking context): they sit above the page and below the drawer and the consent card.
 * `DESIGN.md` ("Nav") has the same order.
 */
export const LAYER = {
  banner: "z-10",
  header: "z-20",
  stickyCta: "z-30",
  drawer: "z-40",
  consent: "z-50",
} as const;
