import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

const UI_DIR = "components/ui";

/**
 * Comments in these files quote the very class names and props the checks look
 * for, so every regex below runs against source with comments removed. Without
 * this, documenting an invariant would be enough to satisfy it.
 */
function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function read(file: string) {
  return stripComments(readFileSync(file, "utf8"));
}

function listTsx(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listTsx(path);
    return entry.isFile() && path.endsWith(".tsx") ? [path] : [];
  });
}

/** Every class string literal in a file, whatever expression wraps it. */
function classStrings(source: string): string[] {
  return (source.match(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g) ?? []).map((value) =>
    value.slice(1, -1),
  );
}

/**
 * Opening JSX tags for `name`, e.g. `<PopoverContent ... >`. The lookbehind
 * keeps arrow functions inside props (`=>`) from terminating the match early.
 */
function openingTags(source: string, name: string): string[] {
  const escaped = name.replace(/\./g, "\\.");
  return source.match(new RegExp(`<${escaped}\\b[\\s\\S]*?(?<!=)>`, "g")) ?? [];
}

const SCROLLS = /\boverflow-(?:y-)?(?:auto|scroll)\b/;
const CLIPS = /\boverflow-(?:x-|y-)?(?:auto|scroll|hidden|clip)\b/;
const HEIGHT_BOUND = /\bmax-h-/;

// ---------------------------------------------------------------------------
// 1. Enumerate the dialog surfaces instead of naming one of them.
// ---------------------------------------------------------------------------
//
// This guard used to read `components/ui/dialog.tsx` and nothing else, and
// asserted that DialogContent must never scroll. That was wrong twice over.
// It missed `components/ui/dialog-responsive.tsx`, which is the surface every
// product modal actually goes through and which *does* scroll (RAD-332), and
// it framed "dialog does not scroll" as the invariant when the real invariant
// is "nothing that can open over a dialog lives inside the dialog's scroll
// container". Surfaces are now discovered from disk, so a new dialog primitive
// joins the checks by existing rather than by someone remembering to add it.

const dialogSurfaces = readdirSync(UI_DIR)
  .filter((name) => /^dialog[\w.-]*\.tsx$/.test(name) && !name.includes(".test."))
  .map((name) => join(UI_DIR, name))
  .sort();

if (dialogSurfaces.length === 0) {
  fail(
    `No dialog surfaces matched ${UI_DIR}/dialog*.tsx. This guard enumerates dialog primitives from disk; an empty set means the primitives moved and every clipping/scrolling check below is silently inspecting nothing.`,
  );
}

type DialogSurface = {
  file: string;
  /** Bounds its own DialogContent height *and* lets it scroll (RAD-332). */
  boundedScrollingContent: boolean;
  /** Owns a viewport-sized scrolling wrapper around DialogContent. */
  viewportScrollWrapper: boolean;
  /** Establishes any scroll/clip container at all, so popovers must escape it. */
  clips: boolean;
};

const surfaces: DialogSurface[] = dialogSurfaces.map((file) => {
  const source = read(file);
  const contentTags = [
    ...openingTags(source, "DialogContent"),
    ...openingTags(source, "DialogPrimitive.Content"),
  ];

  return {
    file,
    boundedScrollingContent: contentTags.some((tag) =>
      classStrings(tag).some(
        (value) => HEIGHT_BOUND.test(value) && SCROLLS.test(value),
      ),
    ),
    viewportScrollWrapper: classStrings(source).some(
      (value) =>
        /\bfixed\b/.test(value) &&
        /\binset-0\b/.test(value) &&
        SCROLLS.test(value),
    ),
    clips: classStrings(source).some((value) => CLIPS.test(value)),
  };
});

// ---------------------------------------------------------------------------
// 2. RAD-332: tall dialogs must stay scrollable, or the submit button is lost.
// ---------------------------------------------------------------------------
//
// Fixed by ac499901 adding `max-h-[85dvh] overflow-y-auto` to the DialogContent
// in dialog-responsive.tsx. The viewport wrapper in dialog.tsx (36f070a5) was
// already in place six weeks before RAD-332 was filed, so it demonstrably is
// not a substitute: a surface that composes DialogContent has to bound the
// content's own height. Only the primitive that owns the viewport wrapper is
// allowed to satisfy this the other way.

for (const surface of surfaces) {
  if (surface.boundedScrollingContent || surface.viewportScrollWrapper) continue;
  fail(
    `${surface.file} renders DialogContent without bounding its height and letting it scroll (expected a max-h-* plus overflow-y-auto on the content, or its own fixed inset-0 scrolling wrapper). That re-opens RAD-332: tall dialog forms push their own footer past the bottom of the viewport and the submit button becomes unreachable.`,
  );
}

// ---------------------------------------------------------------------------
// 3. RAD-329 + the clipping exposure: searchable popovers must be portalled.
// ---------------------------------------------------------------------------
//
// Two independent reasons, and they point the same way:
//
//  - RAD-329, reproduced twice on production: while CategoryComboBoxForm's
//    popover was non-portalled, picking a category tore down the whole Add
//    Transaction modal and discarded every field the user had typed. Fixed by
//    46cc8997, which portalled it.
//  - The dialog surfaces listed by `clippingSurfaces` below are scroll/clip
//    containers. A non-portalled popover renders inside that container and is
//    constrained by it; a portalled one is a body-level sibling and is not.
//
// Portalling is safe here because the two things `portalled={false}` was
// protecting are covered another way, both verified against the installed
// Radix packages:
//  - Clickability: the dialog is modal and sets `body { pointer-events: none }`,
//    but PopoverContent forces `pointer-events-auto` on itself (asserted below).
//  - Typing and dismissal: Popover is non-modal here (asserted below), and
//    react-focus-scope's `focusScopesStack.add()` pauses the dialog's focus
//    trap while the popover's own FocusScope is mounted, so CommandInput keeps
//    focus. react-dismissable-layer decides "outside" from the *React* tree
//    (`onPointerDownCapture` / `onFocusCapture`), and a portal is still a React
//    child of the dialog, so clicking a portalled option is not an outside
//    press and does not dismiss the dialog.
//
// What portalling does need is a stacking context above the dialog, since a
// body-level sibling of a z-50 DialogContent/DialogOverlay would otherwise
// render behind it. Hence the z-110 requirement.

const clippingSurfaces = surfaces
  .filter((surface) => surface.clips)
  .map((surface) => surface.file);

const searchableSelectFiles = [
  "components/ui/combobox.tsx",
  "components/ui/combobox-creatable.tsx",
  "components/ui/combobox-virtualized.tsx",
  "components/CategoryComboBoxForm.tsx",
];

const POPOVER_STACK_CLASS = "z-110";

for (const file of searchableSelectFiles) {
  const source = read(file);

  if (/<Popover\b[^>]*\bmodal(?:\s|>|=)/.test(source)) {
    fail(
      `${file} should not render searchable combobox popovers as modal popovers inside dialogs; nested modal focus scopes block CommandInput typing`,
    );
  }

  const contentTags = openingTags(source, "PopoverContent");

  if (contentTags.length === 0) {
    fail(
      `${file} is listed as a searchable select but renders no PopoverContent; the portalling and stacking checks below are inspecting nothing.`,
    );
  }

  for (const tag of contentTags) {
    if (!classStrings(tag).some((value) => value.split(/\s+/).includes(POPOVER_STACK_CLASS))) {
      fail(
        `${file} has a searchable combobox PopoverContent without ${POPOVER_STACK_CLASS}. Portalled popover content is a body-level sibling of DialogOverlay/DialogContent, which both sit at z-50, so at the default z-50 the option list renders behind the dialog it belongs to.`,
      );
    }
  }
}

// The portalling rule is repo-wide on purpose. Scoping it to the four files
// above is how `dialog-responsive.tsx` slipped past the old version of this
// guard: any popover opened from inside a dialog is exposed, not just the ones
// someone remembered to list.
const nonPortalledCallSites = [...listTsx("components"), ...listTsx("app")]
  .filter((file) => /portalled=\{false\}/.test(read(file)))
  .sort();

if (nonPortalledCallSites.length > 0) {
  fail(
    `portalled={false} must not be used on PopoverContent (found in ${nonPortalledCallSites.join(", ")}). These dialog surfaces are scroll/clip containers: ${clippingSurfaces.join(", ") || "none"}. A non-portalled popover renders inside that container, and it also re-opens RAD-329 (selecting a category tears down the Add Transaction modal and discards the form).`,
  );
}

// ---------------------------------------------------------------------------
// 4. The primitives that make portalling survivable inside a modal dialog.
// ---------------------------------------------------------------------------

const popoverSource = read(`${UI_DIR}/popover.tsx`);

if (!/pointer-events-auto/.test(popoverSource)) {
  fail(
    "PopoverContent should force pointer-events-auto so portalled searchable popovers remain clickable inside modal dialogs that lock body pointer events",
  );
}

if (!/\bportalled\s*=\s*true\b/.test(popoverSource)) {
  fail(
    "PopoverContent must default to portalled=true; flipping the default silently un-portals every searchable select and re-opens RAD-329 as well as the dialog clipping exposure",
  );
}

// ---------------------------------------------------------------------------
// 5. Popover content can still render inside a parent <form>'s React tree, so
//    its buttons must not be implicit submit buttons.
// ---------------------------------------------------------------------------

const creatableSource = read(`${UI_DIR}/combobox-creatable.tsx`);
if (
  !/<Button\b[\s\S]*?type="button"[\s\S]*?renderCreateLabel\(trimmedQuery\)/.test(
    creatableSource,
  )
) {
  fail(
    'ComboboxCreatable create action should be type="button" and render explicit create copy because popover content sits in the parent form\'s React tree',
  );
}

const categoryComboBoxSource = read("components/CategoryComboBoxForm.tsx");
if (
  !/<Button\b[\s\S]*?type="button"[\s\S]*?t\("add-new-category"\)/.test(
    categoryComboBoxSource,
  )
) {
  fail(
    'CategoryComboBoxForm add-new-category action should be type="button" because popover content sits in the parent form\'s React tree',
  );
}

if (failures.length > 0) {
  console.error("Searchable select regression checks failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Searchable select regression checks passed (${surfaces.length} dialog surface(s): ${dialogSurfaces.join(", ")})`,
);
