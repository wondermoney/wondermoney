/**
 * The radio tiles in the goal forms. Selection is read from `aria-checked`, so
 * the tile's look and its announced state cannot drift apart. Unselected tiles
 * carry the input stroke like every other control in the form; the priority
 * tile is a one-line control at the form's 40px height.
 */
const GOAL_TILE_BASE =
  "border-input focus-visible:ring-ring hover:bg-muted/50 aria-checked:border-primary aria-checked:ring-primary aria-checked:bg-primary/5 rounded-md border text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden aria-checked:ring-1 aria-checked:hover:bg-primary/5";

export const GOAL_OPTION_TILE_CLASS = `${GOAL_TILE_BASE} px-4 py-3`;

export const GOAL_PRIORITY_TILE_CLASS = `${GOAL_TILE_BASE} text-foreground flex h-10 items-center px-4 text-sm font-medium`;
