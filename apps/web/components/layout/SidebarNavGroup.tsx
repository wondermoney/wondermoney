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
 * The label used to be an `<h2>`. The shell renders before page content, so on
 * every authenticated route that `<h2>` was the first heading in the document
 * and a screen reader's heading list opened inside the navigation instead of
 * on the page title (RAD-557). A nav group is a landmark's internal structure,
 * not a section of the document, so it no longer takes a heading level: the
 * label is plain text and names its own list through `aria-labelledby`, which
 * is what makes the group announce as "Day-to-day, list, 3 items".
 *
 * Presentational on purpose — it renders no headings, and
 * `scripts/sidebar-heading-outline-regression-checks.tsx` asserts that against
 * the real markup.
 */
export function SidebarNavGroup({ id, label, children }: SidebarNavGroupProps) {
  const labelId = `sidebar-nav-group-${id}`;

  return (
    <div className="mt-5">
      <div
        id={labelId}
        className="text-muted-foreground px-2 pb-1 text-[0.6875rem] font-semibold tracking-wider uppercase"
      >
        {label}
      </div>
      <ul role="list" aria-labelledby={labelId} className="space-y-1">
        {children}
      </ul>
    </div>
  );
}
