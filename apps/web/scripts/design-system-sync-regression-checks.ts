/**
 * Guards the things about theme/globals.css that go wrong silently.
 *
 * Every semantic fill is paired with a `-foreground` meant to sit on top of
 * it, and nothing checked that the pair was legible. It was not: the dark
 * `--destructive-foreground` was a red on a red fill at 2.63:1, so every
 * destructive button in dark mode was unreadable, and `--info` light sat at
 * 4.22:1. Both shipped for months because a contrast failure looks like a
 * colour choice. This measures every pair on every theme half.
 *
 * The contrast maths is inline on purpose — a guard that needs an install is a
 * guard that gets skipped. It is validated in `assertKnownContrastFixtures`
 * against values measured independently in a real browser.
 *
 * DESIGN.md no longer mirrors these tokens in a machine-checked export block
 * (it moved to Impeccable's design-doc format, which doesn't have one) — this
 * guard used to also assert that mirror stayed in sync. Token values now live
 * only in theme/globals.css and .impeccable/design.json's sidecar metadata.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Rgb = [number, number, number];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function oklchToSrgb(L: number, C: number, Hdeg: number): Rgb {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return linear.map((c) => {
    const v = clamp01(c);
    return clamp01(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  }) as Rgb;
}

function parseOklch(value: string): Rgb {
  const m = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  assert.ok(m, `not an oklch() value: ${value}`);
  return oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at `alpha` over an opaque `bg`, the way `bg-primary/90` does. */
function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb;
}

// ---------------------------------------------------------------------------

const globals = readFileSync("theme/globals.css", "utf8");

/** Declarations inside a top-level block, comments stripped. */
function tokensIn(source: string, selector: string): Map<string, string> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\n\\}`,
  );
  const match = withoutComments.match(pattern);
  assert.ok(match, `could not find a \`${selector}\` block`);

  const tokens = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    // Trailing whitespace is expected: stripping an end-of-line comment leaves
    // some behind, so the value match must not be anchored tight to the `;`.
    const decl = line.trim().match(/^(--[\w-]+|color-scheme)\s*:\s*([^;]+);\s*$/);
    if (decl) tokens.set(decl[1], decl[2].trim());
  }
  return tokens;
}

// --- 1. the stamp -----------------------------------------------------------

assert.match(
  globals,
  /^\/\* Hallmark · scope: app · genre: modern-minimal/,
  "theme/globals.css should open with the Hallmark stamp — it is how a later run knows the system is locked",
);

// --- 2. every fill/-foreground pair must be legible -------------------------

function assertKnownContrastFixtures() {
  // Independently measured in a real browser during the token work. If the
  // maths above ever drifts, these fail before any real token is blamed.
  const fixtures: Array<[string, string, string, number]> = [
    ["--ring light on canvas", "oklch(0.54 0.2 290)", "oklch(0.985 0.006 290)", 5.28],
    ["--ring dark on canvas", "oklch(0.69 0.17 290)", "oklch(0.145 0.012 290)", 6.76],
    ["--success-text light", "oklch(0.53 0.145 150)", "oklch(0.985 0.006 290)", 4.71],
    ["--destructive-text dark", "oklch(0.68 0.19 27.325)", "oklch(0.145 0.012 290)", 6.31],
  ];
  for (const [label, fg, bg, expected] of fixtures) {
    const actual = contrast(parseOklch(fg), parseOklch(bg));
    assert.ok(
      Math.abs(actual - expected) < 0.1,
      `contrast maths drifted: ${label} computed ${actual.toFixed(2)}, browser measured ${expected}`,
    );
  }
}
assertKnownContrastFixtures();

const AA_NORMAL_TEXT = 4.5;

/** Fills whose `-foreground` pair is real text sitting on the fill. */
const FILL_PAIRS = [
  "primary",
  "secondary",
  "accent",
  "destructive",
  "warning",
  "info",
  "success",
  "card",
  "popover",
] as const;

/**
 * States built by fading a fill toward the canvas. Fading *raises* lightness,
 * so it costs the label contrast — `active:bg-primary/80` measured 4.31:1 and
 * is why press is carried by scale, not colour. Hover at /90 is checked here so
 * that stays true.
 */
const HOVER_ALPHA = 0.9;

for (const half of [":root", ".dark"] as const) {
  const tokens = tokensIn(globals, half);
  const canvas = parseOklch(tokens.get("--background")!);
  const label = half === ":root" ? "light" : "dark";

  for (const role of FILL_PAIRS) {
    const fillRaw = tokens.get(`--${role}`);
    const textRaw = tokens.get(`--${role}-foreground`);
    if (!fillRaw || !textRaw) continue;

    const fill = parseOklch(fillRaw);
    const text = parseOklch(textRaw);

    const atRest = contrast(text, fill);
    assert.ok(
      atRest >= AA_NORMAL_TEXT,
      `--${role}-foreground on --${role} (${label}) is ${atRest.toFixed(2)}:1, under the ${AA_NORMAL_TEXT}:1 floor. A fill and its -foreground are a pair; fix the pair, not the call site.`,
    );

    const atHover = contrast(text, over(fill, canvas, HOVER_ALPHA));
    assert.ok(
      atHover >= AA_NORMAL_TEXT,
      `--${role}-foreground on --${role}/90 (${label}, the hover state) is ${atHover.toFixed(2)}:1, under the ${AA_NORMAL_TEXT}:1 floor. Fading a fill toward the canvas raises its lightness — build hover from a different token, not from opacity.`,
    );
  }

  // The `-text` tokens are the ones allowed as body text on the canvas.
  for (const role of ["destructive", "warning", "info", "success"] as const) {
    const raw = tokens.get(`--${role}-text`);
    assert.ok(raw, `--${role}-text should exist in \`${half}\``);
    const measured = contrast(parseOklch(raw!), canvas);
    assert.ok(
      measured >= AA_NORMAL_TEXT,
      `--${role}-text on the ${label} canvas is ${measured.toFixed(2)}:1, under ${AA_NORMAL_TEXT}:1`,
    );
  }

  // A focus indicator needs 3:1 against what it is drawn on (WCAG 2.4.11).
  const ring = contrast(parseOklch(tokens.get("--ring")!), canvas);
  assert.ok(
    ring >= 3,
    `--ring on the ${label} canvas is ${ring.toFixed(2)}:1, under the 3:1 floor for a focus indicator`,
  );
}

// --- 3. chart series must keep their hue across both halves -----------------

/**
 * The two halves used to carry unrelated shadcn default ramps, so the *same*
 * series changed hue with the theme — `--chart-1` was orange in light and blue
 * in dark, `--chart-3` the reverse. A legend meant something different
 * depending on which theme you were in. Lightness and chroma may differ per
 * half (they have to, the canvases differ); hue may not.
 */
function hueOf(value: string): number {
  const m = value.match(/oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s*\)/);
  assert.ok(m, `not an oklch() value: ${value}`);
  return parseFloat(m[1]);
}

const lightTokens = tokensIn(globals, ":root");
const darkTokens = tokensIn(globals, ".dark");

for (let i = 1; i <= 5; i++) {
  const name = `--chart-${i}`;
  const light = lightTokens.get(name);
  const dark = darkTokens.get(name);
  assert.ok(light && dark, `${name} should exist in both halves`);

  const drift = Math.abs(hueOf(light!) - hueOf(dark!));
  assert.ok(
    drift <= 2,
    `${name} is hue ${hueOf(light!)} in light and ${hueOf(dark!)} in dark. A chart series must keep its hue across halves — only lightness and chroma may move. Re-run the dataviz palette validator if you need to re-step it.`,
  );
}

// --- 4. the one token that must not invert ---------------------------------

assert.equal(
  tokensIn(globals, ":root").get("--overlay"),
  tokensIn(globals, ".dark").get("--overlay"),
  "--overlay must be identical in both halves: a scrim darkens whatever is behind it, so inverting it paints a near-white wash over dark UI",
);

console.log("Design-system sync + contrast regression checks passed");
