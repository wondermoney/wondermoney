/**
 * Guards the hardcoded-palette sweep (RAD-559).
 *
 * The "87 -> 1 -> 0" figure quoted across the Hallmark revamp was a manual
 * count. A manual count protects nothing: the sweep is at zero today and the
 * only palette assertion anywhere else in `scripts/` is one line in
 * `chart-system-regression-checks.ts` asserting `text-gray-800` is gone from
 * `components/ui/chart.tsx`. One class, one file. This walks `app/`,
 * `components/` and `lib/` and fails on any Tailwind palette class that is not
 * on the allowlist below.
 *
 * Two things make a guard like this useless, and both are handled explicitly:
 *
 * 1. A bare-class regex misses the variant-prefixed forms. `dark:bg-gray-800`
 *    and `group-hover:[&_svg]:text-red-500` are exactly what drifts back in.
 *    The pattern is anchored on a non-word/non-dash boundary instead of `^`,
 *    so any variant stack in front of the utility is matched.
 *
 * 2. A guard that cries wolf gets disabled. Comments are masked before
 *    matching (three of this repo's `-\d00` occurrences are *prose about*
 *    removed classes, in `badge.tsx`, `TailwindIndicator.tsx` and
 *    `SidebarTrialUpgrade.tsx`), and the pattern requires a real palette
 *    family name so `z-50`, `duration-300`, `delay-150`, `border-2`,
 *    `bg-[#fff]` and `--color-red-500` cannot match.
 *
 * The scanner is validated against inline fixtures in `assertScannerFixtures`
 * before it is pointed at the tree, so a regression in the masker or the
 * pattern fails loudly rather than quietly reporting "0 hits".
 *
 * STATUS: live and green (RAD-563). It needs no wiring of its own: there is no
 * per-domain `test:*` script convention any more — `scripts/regression-checks.test.ts`
 * enumerates every `*-regression-checks.*` from disk and runs it as a Vitest
 * test, and CI runs the whole suite. An earlier revision of this file asserted
 * that `package.json` exposed `"test:palette-sweep"`; that assertion outlived
 * the convention it guarded and has been removed.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// What counts as a palette class
// ---------------------------------------------------------------------------

/** Every Tailwind default colour ramp. `--primary` and friends are the answer. */
const PALETTE_FAMILIES = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const;

/**
 * Utilities that take a colour. The six named in RAD-559 (`bg`, `text`,
 * `border`, `ring`, `fill`, `stroke`) plus the other colour-taking utilities,
 * because `from-blue-500` in a gradient is the same drift by another name.
 * The extra prefixes find nothing today — they are here so they never can.
 *
 * `border`/`divide` accept a side suffix (`border-t-red-500`), and `ring`
 * accepts `ring-offset-red-500`.
 */
const COLOUR_PREFIX = String.raw`(?:bg|text|border(?:-[trblxyse])?|divide(?:-[xy])?|ring(?:-offset)?|outline|fill|stroke|shadow|from|via|to|accent|caret|decoration|placeholder)`;

/**
 * Anchored on `(?<![\w-])` rather than `^` or `\b`:
 *
 * - `\b` would match the `text-red-500` inside `--text-red-500`, because `-`
 *   is a non-word character. The lookbehind rejects that, and rejects any
 *   other custom property or identifier that merely ends in a palette name.
 * - It still admits every variant prefix, since those all end in `:` or `]`:
 *   `dark:`, `hover:`, `focus-visible:`, `sm:`, `[&>svg]:`, and any stack.
 *
 * The trailing `(?![\w-])` keeps `bg-red-500` from matching inside a longer
 * identifier while still admitting the opacity suffix `bg-red-500/80`, since
 * `/` is neither a word character nor a dash.
 */
const PALETTE_CLASS = new RegExp(
  String.raw`(?<![\w-])${COLOUR_PREFIX}-(?:${PALETTE_FAMILIES.join("|")})-\d{2,3}(?![\w-])`,
  "g",
);

/**
 * Only source that Tailwind actually compiles. Prose is excluded on purpose:
 * `AGENTS.md` and `components/reports/sankey/README.md` describe palette
 * classes, and `DESIGN.md`/`DESIGN_HISTORY.md` are full of them. Documenting a banned class is not
 * shipping one. `.json` fixtures and the stray
 * `app/[locale]/(full-layout)/portfolio/client-comp.tsx.backup` are excluded
 * for the same reason — nothing imports them, so nothing renders them.
 */
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"];

/** RAD-559 names these three roots. `theme/globals.css` defines the tokens and is not a consumer. */
const SCAN_ROOTS = ["app", "components", "lib"];

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

type Hit = {
  file: string;
  line: number;
  /**
   * The class exactly as written, variant stack included, so a report can be
   * grepped for verbatim. `bg-gray-800` would send a reader hunting for a
   * string the file does not contain — it says `dark:bg-gray-800`.
   */
  className: string;
  /** The source line, trimmed. Carried so a report reads without opening the file. */
  context: string;
};

type AllowlistEntry = {
  id: string;
  /** Why this is allowed to exist. An entry without a real reason is rot. */
  reason: string;
  /**
   * `true` when the entry is expected to suppress at least one hit today. If
   * it stops matching, the exception is gone and the entry must be deleted —
   * that is what keeps this list from accreting.
   */
  mustMatch: boolean;
  applies: (hit: Hit) => boolean;
};

/**
 * Three entries, fixed by the product owner. Adding a fourth is a decision
 * someone has to make in a diff, in public, with a reason written down.
 */
const ALLOWLIST: AllowlistEntry[] = [
  {
    id: "first-run-illustrative-colours",
    reason: [
      "First-run onboarding sample data — the mock dashboard only.",
      "",
      "FirstRunProductWindow.tsx is a decorative, aria-hidden, non-interactive",
      "mock dashboard whose donut slices, sparkline and fake '-1.2%' row are",
      "invented data. Themed tokens would make fabricated numbers look like real",
      "product state, which is worse than a raw ramp.",
      "",
      "Scope deliberately NARROWED to this one file (owner decision, RAD-559).",
      "The original `FirstRun*` scope also caught FirstRunIconTile.tsx,",
      "FirstRunSyncStep.tsx and FirstRunCompleteStep.tsx — but those are not",
      "sample data. Their sync-status tones (emerald/amber/rose) and completion",
      "checkmark are real chrome that maps onto --success / --warning /",
      "--destructive, and exempting them here would have hidden ~25 semantic",
      "colours behind a 'sample data' justification that is not true of them.",
      "They were fixed under their own ticket (RAD-563) rather than exempted:",
      "the sync banner and the completion checkmark now use the semantic text",
      "tokens, and the tile tones use the categorical chart ramp.",
    ].join("\n"),
    mustMatch: true,
    applies: (hit) =>
      hit.file === "components/onboarding/first-run/FirstRunProductWindow.tsx",
  },
  {
    id: "google-brand-mark",
    reason: [
      "The Google brand mark in the OAuth buttons (components/auth/LoginForm.tsx",
      "and components/auth/SignupFormView.tsx). Google's brand guidelines forbid",
      "recolouring the mark, so it must not follow the theme.",
      "",
      "Inert today: the mark is drawn with literal hex fills (fill=\"#4285F4\" and",
      "friends), which are not Tailwind palette classes and so are not matched by",
      "this scanner at all. The entry stands so that swapping those hexes for",
      "`fill-blue-500` and friends stays allowed rather than looking like drift.",
    ].join("\n"),
    mustMatch: false,
    applies: (hit) =>
      hit.file === "components/auth/LoginForm.tsx" ||
      hit.file === "components/auth/SignupFormView.tsx",
  },
  {
    id: "public-svg-illustrations",
    reason: [
      "Illustration fills in public/*.svg (the undraw_* set, gocardless, tink).",
      "These are assets, not component styling — they have no access to the theme",
      "tokens and are not compiled by Tailwind.",
      "",
      "Inert today: public/ is outside the three roots RAD-559 names, so nothing",
      "under it is scanned. The entry records the decision so a later widening of",
      "SCAN_ROOTS does not read these as 14 new regressions.",
    ].join("\n"),
    mustMatch: false,
    applies: (hit) => hit.file.startsWith("public/") && hit.file.endsWith(".svg"),
  },
];

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Blanks out comment bodies, preserving every byte offset and newline so line
 * numbers stay true.
 *
 * String literals are tracked only so that a `/*` or `//` *inside* one is not
 * mistaken for a comment. This matters: `app/robots.ts` contains `"/*\/auth/"`
 * and `components/ui/FileUploader.tsx` contains `"image/*"`, and a naive
 * `/\/\*[\s\S]*?\*\//` strip would swallow everything from there to the next
 * `*\/` — silently blinding the guard to real code.
 *
 * Two deliberate concessions, both of which fail toward *reporting* a hit
 * rather than missing one:
 *
 * - `//` preceded by `:` is a URL scheme, not a comment.
 * - `'` and `"` state resets at end of line, so an apostrophe in JSX prose
 *   ("Don't") can confuse at most one line. Being wrongly inside a string
 *   never masks anything — it only means a comment on that one line might be
 *   scanned, which surfaces a false positive instead of hiding a real one.
 */
function maskComments(source: string): string {
  const out = source.split("");
  type Mode = "code" | "line" | "block" | "single" | "double" | "template";
  let mode: Mode = "code";
  let i = 0;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (mode === "code") {
      if (c === "/" && next === "/" && source[i - 1] !== ":") {
        mode = "line";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        mode = "block";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "template";
      i += 1;
      continue;
    }

    if (mode === "line") {
      if (c === "\n") mode = "code";
      else out[i] = " ";
      i += 1;
      continue;
    }

    if (mode === "block") {
      if (c === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        mode = "code";
        i += 2;
        continue;
      }
      if (c !== "\n") out[i] = " ";
      i += 1;
      continue;
    }

    // Inside a string literal. Contents are kept verbatim: `"text-red-500"` in
    // a class map is a real class.
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (
      (mode === "single" && c === "'") ||
      (mode === "double" && c === '"') ||
      (mode === "template" && c === "`") ||
      ((mode === "single" || mode === "double") && c === "\n")
    ) {
      mode = "code";
    }
    i += 1;
  }

  return out.join("");
}

/** Ends a class token: whitespace, a quote, or JS/JSX punctuation around it. */
const TOKEN_BOUNDARY = /[\s"'`(),;{}]/;

/** Widens a bare match to the whole class token, so variant stacks survive. */
function classTokenAround(source: string, start: number, end: number): string {
  let from = start;
  while (from > 0 && !TOKEN_BOUNDARY.test(source[from - 1])) from -= 1;
  let to = end;
  while (to < source.length && !TOKEN_BOUNDARY.test(source[to])) to += 1;
  return source.slice(from, to);
}

function findPaletteClasses(file: string, source: string): Hit[] {
  const masked = maskComments(source);
  const lines = source.split("\n");
  const hits: Hit[] = [];

  PALETTE_CLASS.lastIndex = 0;
  for (const match of masked.matchAll(PALETTE_CLASS)) {
    const line = masked.slice(0, match.index).split("\n").length;
    hits.push({
      file,
      line,
      className: classTokenAround(masked, match.index, match.index + match[0].length),
      context: (lines[line - 1] ?? "").trim(),
    });
  }

  return hits;
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      files.push(...walkFiles(path));
      continue;
    }
    if (entry.isFile() && SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(path);
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Self-test: the scanner is checked before it is trusted
// ---------------------------------------------------------------------------

function assertScannerFixtures() {
  const found = (source: string) =>
    findPaletteClasses("fixture.tsx", source).map((hit) => hit.className);

  // Variant stacks. A bare-class regex would miss every one of these, and the
  // report has to quote them as written or nobody can grep for them.
  assert.deepEqual(found(`<i className="dark:bg-gray-800" />`), ["dark:bg-gray-800"]);
  assert.deepEqual(found(`<i className="hover:text-red-500 focus-visible:ring-blue-500" />`), [
    "hover:text-red-500",
    "focus-visible:ring-blue-500",
  ]);
  assert.deepEqual(found(`<i className="sm:dark:bg-slate-900 [&>svg]:stroke-emerald-400" />`), [
    "sm:dark:bg-slate-900",
    "[&>svg]:stroke-emerald-400",
  ]);
  assert.deepEqual(found(`<i className="group-hover:[&_svg]:text-rose-500" />`), [
    "group-hover:[&_svg]:text-rose-500",
  ]);

  // Opacity suffixes and side suffixes.
  assert.deepEqual(found(`<i className="bg-red-500/80 border-t-amber-600" />`), [
    "bg-red-500/80",
    "border-t-amber-600",
  ]);

  // Comments are prose, not shipped classes. All three of these exist verbatim
  // in the repo today and are the entire reason masking is not optional.
  assert.deepEqual(found(`// Was \`bg-green-500/80 text-green-100\` — the one pair`), []);
  assert.deepEqual(found(`/**\n * \`bg-gray-800 text-white\`, which only read as\n */`), []);
  assert.deepEqual(found(`const a = 1; // text-amber-600 dark:text-amber-500`), []);

  // ...but masking must not eat code. `/*` inside a string literal is data.
  assert.deepEqual(found(`const rules = ["/*/auth/", "image/*"];\nconst c = "bg-gray-100";`), [
    "bg-gray-100",
  ]);
  // A URL scheme is not a line comment.
  assert.deepEqual(found(`const u = https://x.dev; const c = "text-gray-500";`), ["text-gray-500"]);

  // Numeric utilities that merely look like palette classes.
  assert.deepEqual(found(`<i className="z-50 duration-300 delay-150 font-medium border-2" />`), []);
  assert.deepEqual(found(`<i className="translate-y-100 opacity-50 grid-cols-12" />`), []);

  // Arbitrary values and custom properties are not palette classes.
  assert.deepEqual(found(`<i className="bg-[#fff] text-[color:var(--x)]" />`), []);
  assert.deepEqual(found(`:root { --color-red-500: #ef4444; --text-blue-600: #2563eb; }`), []);

  // Semantic tokens, which is the whole point, must never register.
  assert.deepEqual(
    found(`<i className="bg-card text-muted-foreground border-border ring-ring" />`),
    [],
  );

  // A class in a string-valued config map is a real class.
  assert.deepEqual(found(`const tone = { warn: "text-amber-500 dark:text-amber-400" };`), [
    "text-amber-500",
    "dark:text-amber-400",
  ]);

  // Line numbers must survive masking, or every report points at the wrong line.
  const multiline = `/* a\n * b\n */\nconst c = "bg-gray-100";`;
  assert.deepEqual(findPaletteClasses("fixture.tsx", multiline)[0].line, 4);
}

assertScannerFixtures();

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const failures: string[] = [];
const suppressed = new Map<string, Hit[]>(ALLOWLIST.map((entry) => [entry.id, []]));
const unallowed: Hit[] = [];

for (const root of SCAN_ROOTS) {
  for (const file of walkFiles(root)) {
    for (const hit of findPaletteClasses(file, readFileSync(file, "utf8"))) {
      const entry = ALLOWLIST.find((candidate) => candidate.applies(hit));
      if (entry) suppressed.get(entry.id)!.push(hit);
      else unallowed.push(hit);
    }
  }
}

for (const hit of unallowed) {
  failures.push(`${hit.file}:${hit.line} uses \`${hit.className}\` — ${hit.context}`);
}

// An allowlist entry that no longer suppresses anything is an exception that
// has been fixed. Delete it, or the list only ever grows.
for (const entry of ALLOWLIST) {
  if (entry.mustMatch && suppressed.get(entry.id)!.length === 0) {
    failures.push(
      `allowlist entry \`${entry.id}\` no longer matches anything — the exception is gone, so remove the entry`,
    );
  }
}

if (failures.length > 0) {
  console.error("Palette sweep regression checks failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    [
      "",
      "Use the semantic tokens in theme/globals.css (see DESIGN.md's Colors section). If a raw",
      "ramp is genuinely required, it needs a new, justified ALLOWLIST entry in this",
      "file — which is a decision someone signs off on, not a line you slip in.",
    ].join("\n"),
  );
  process.exit(1);
}

const total = [...suppressed.values()].reduce((sum, hits) => sum + hits.length, 0);
const inert = ALLOWLIST.filter((entry) => suppressed.get(entry.id)!.length === 0).map(
  (entry) => entry.id,
);
console.log(
  `Palette sweep regression checks passed (0 unallowlisted palette classes; ${total} allowlisted${
    inert.length > 0 ? `; inert entries: ${inert.join(", ")}` : ""
  })`,
);
