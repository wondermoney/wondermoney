/**
 * Category colours come from the API (`category_bg_color` / `category_text_color`)
 * and are not always real colours.
 *
 * "Uncategorized" — the single most common category on a fresh account — comes
 * back as `#000000`. Painted literally that is a black slab: the largest bar on
 * the reports chart, a black chip and a black progress fill on the accounts
 * overview. It is a placeholder the API uses for "no colour of its own", not a
 * design decision, and it tracks neither half of the theme.
 *
 * Treat the placeholder (and a missing value) as "no colour" and fall back onto
 * the system's own categorical ramp by position, so every category has a colour
 * that belongs to the palette and survives both themes.
 */

/** `#000`, `#000000`, `#00000000` and whitespace variants — the API's "unset". */
export const isPlaceholderCategoryColor = (value?: string | null) =>
  !value || /^#0{3,8}$/i.test(value.trim());

/** The five categorical chart slots, in fixed order. Never cycled beyond five. */
export const categoryRampColor = (index: number) =>
  `var(--chart-${(index % 5) + 1})`;

/**
 * The colour to paint a category with: its own, or the ramp slot for its
 * position when the API has none.
 */
export const resolveCategoryColor = (
  value: string | null | undefined,
  index: number,
) => (isPlaceholderCategoryColor(value) ? categoryRampColor(index) : value!);
