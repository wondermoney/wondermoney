import type { ReactNode } from "react";

type SidebarNavGroupProps = {
  /** Stable id for the group, used to tie the list to its visible label. */
  id: string;
  /** Already-translated label. Kept out of the component so it stays pure. */
  label: string;
  children: ReactNode;
};

/**
 * A labelled block of navigation links in the desktop rail.
 *
 * The label is not a heading. The shell renders before page content, so on
 * every authenticated route an `<h2>` here would be the first heading in the
 * document and a screen reader's heading list would open inside the navigation
 * instead of on the page title. A nav group is a landmark's internal structure,
 * not a section of the document, so it takes no heading level: the
 * label is plain text and names its own list through `aria-labelledby`, which
 * is what makes the group announce as "Day-to-day, list, 3 items".
 *
 * Presentational on purpose — it renders no headings
 * (`heading-outline.test.tsx` renders it and checks).
 */
export function SidebarNavGroup({ id, label, children }: SidebarNavGroupProps) {
  const labelId = `sidebar-nav-group-${id}`;

  return (
    <div className="mt-5">
      <div
        id={labelId}
        className="text-muted-foreground px-2 pb-1 text-xs font-medium"
      >
        {label}
      </div>
      <ul role="list" aria-labelledby={labelId} className="space-y-1">
        {children}
      </ul>
    </div>
  );
}
