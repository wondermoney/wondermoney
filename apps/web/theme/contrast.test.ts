/**
 * Every semantic fill is paired with a `-foreground` meant to sit on top of it.
 * A pair that is not legible looks like a colour choice, not a bug — the dark
 * destructive pair shipped at 2.63:1, unreadable on every destructive button.
 * This measures every pair, the status text tokens, the focus ring and the
 * chart series on both theme halves.
 */
import assert from "node:assert/strict";

import { test } from "vitest";

import globals from "./globals.css?raw";

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

function hueOf(value: string): number {
  const m = value.match(/oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s*\)/);
  assert.ok(m, `not an oklch() value: ${value}`);
  return parseFloat(m[1]);
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
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
    const decl = line.trim().match(/^(--[\w-]+|color-scheme)\s*:\s*([^;]+);\s*$/);
    if (decl) tokens.set(decl[1], decl[2].trim());
  }
  return tokens;
}

const AA_NORMAL_TEXT = 4.5;
const HALVES = [
  [":root", "light"],
  [':root[data-theme="dark"]', "dark"],
] as const;

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
 * Hover is a fill faded toward the canvas at /90. Fading raises lightness, so
 * it costs the label contrast; the hover state has to clear the floor too.
 */
const HOVER_ALPHA = 0.9;

test("the contrast maths agrees with values measured in a real browser", () => {
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
      `${label} computed ${actual.toFixed(2)}, browser measured ${expected}`,
    );
  }
});

for (const [selector, label] of HALVES) {
  test(`text on every filled surface is legible at rest and on hover (${label})`, () => {
    const tokens = tokensIn(globals, selector);
    const canvas = parseOklch(tokens.get("--background")!);

    for (const role of FILL_PAIRS) {
      const fillRaw = tokens.get(`--${role}`);
      const textRaw = tokens.get(`--${role}-foreground`);
      if (!fillRaw || !textRaw) continue;

      const fill = parseOklch(fillRaw);
      const text = parseOklch(textRaw);

      const atRest = contrast(text, fill);
      assert.ok(
        atRest >= AA_NORMAL_TEXT,
        `--${role}-foreground on --${role} (${label}) is ${atRest.toFixed(2)}:1`,
      );
      const atHover = contrast(text, over(fill, canvas, HOVER_ALPHA));
      assert.ok(
        atHover >= AA_NORMAL_TEXT,
        `--${role}-foreground on --${role}/90 (${label}, hover) is ${atHover.toFixed(2)}:1`,
      );
    }
  });

  test(`status text and the focus ring are legible on the canvas (${label})`, () => {
    const tokens = tokensIn(globals, selector);
    const canvas = parseOklch(tokens.get("--background")!);

    for (const role of ["destructive", "warning", "info", "success"] as const) {
      const raw = tokens.get(`--${role}-text`);
      assert.ok(raw, `--${role}-text should exist in \`${selector}\``);
      const measured = contrast(parseOklch(raw), canvas);
      assert.ok(measured >= AA_NORMAL_TEXT, `--${role}-text on the ${label} canvas is ${measured.toFixed(2)}:1`);
    }

    // A focus indicator needs 3:1 against what it is drawn on (WCAG 2.4.11).
    const ring = contrast(parseOklch(tokens.get("--ring")!), canvas);
    assert.ok(ring >= 3, `--ring on the ${label} canvas is ${ring.toFixed(2)}:1`);
  });
}

test("a chart series keeps its hue when the theme changes", () => {
  const light = tokensIn(globals, ":root");
  const dark = tokensIn(globals, ':root[data-theme="dark"]');

  for (let i = 1; i <= 5; i++) {
    const name = `--chart-${i}`;
    const lightValue = light.get(name);
    const darkValue = dark.get(name);
    assert.ok(lightValue && darkValue, `${name} should exist in both halves`);
    const drift = Math.abs(hueOf(lightValue) - hueOf(darkValue));
    assert.ok(drift <= 2, `${name} is hue ${hueOf(lightValue)} in light and ${hueOf(darkValue)} in dark`);
  }
});

test("the modal scrim is the same in both themes", () => {
  // A scrim darkens what is behind it; inverting it paints a white wash over dark UI.
  assert.equal(tokensIn(globals, ":root").get("--overlay"), tokensIn(globals, ':root[data-theme="dark"]').get("--overlay"));
});
