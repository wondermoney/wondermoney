/**
 * The merchant avatar's fallback: an initial on a colour picked from the merchant's name.
 *
 * Web, mobile and the API run this same algorithm (issue #45), so a merchant has one colour
 * everywhere. Change it on every client at once, or not at all:
 *
 * - the name is normalised as the API's `normalizeMerchantName` does, so "Café Nero" and
 *   "  cafe   NERO " are one merchant and one colour;
 * - the colour is FNV-1a (32-bit) over the UTF-16 code units of that name, modulo the palette;
 * - the palette order is fixed: blue, teal, amber, fuchsia, sky, orange, stone, slate. It holds
 *   no green, red or brand violet, which DESIGN.md keeps for financial meaning and the accent.
 */

/** Accents stripped, whitespace collapsed and trimmed, lower case. */
export function normalizeMerchantName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** FNV-1a, 32-bit, over UTF-16 code units. Unsigned. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * One avatar colour: a fill token and the text token that sits on it, both defined for the
 * light and the dark theme in `theme/globals.css` (`--merchant-<hue>` and
 * `--merchant-<hue>-foreground`). `theme/contrast.test.ts` holds every pair to 4.5:1 in both.
 */
export interface MerchantAvatarColor {
  hue: string;
  /** The CSS custom property prefix, without the leading dashes. */
  token: string;
  /** Spelled out in full so Tailwind finds the classes in source. */
  className: string;
}

export const MERCHANT_AVATAR_PALETTE: readonly MerchantAvatarColor[] = [
  {
    hue: "blue",
    token: "merchant-blue",
    className: "bg-merchant-blue text-merchant-blue-foreground",
  },
  {
    hue: "teal",
    token: "merchant-teal",
    className: "bg-merchant-teal text-merchant-teal-foreground",
  },
  {
    hue: "amber",
    token: "merchant-amber",
    className: "bg-merchant-amber text-merchant-amber-foreground",
  },
  {
    hue: "fuchsia",
    token: "merchant-fuchsia",
    className: "bg-merchant-fuchsia text-merchant-fuchsia-foreground",
  },
  {
    hue: "sky",
    token: "merchant-sky",
    className: "bg-merchant-sky text-merchant-sky-foreground",
  },
  {
    hue: "orange",
    token: "merchant-orange",
    className: "bg-merchant-orange text-merchant-orange-foreground",
  },
  {
    hue: "stone",
    token: "merchant-stone",
    className: "bg-merchant-stone text-merchant-stone-foreground",
  },
  {
    hue: "slate",
    token: "merchant-slate",
    className: "bg-merchant-slate text-merchant-slate-foreground",
  },
];

/** The palette slot for a merchant name. */
export function merchantColorIndex(name: string): number {
  return fnv1a32(normalizeMerchantName(name)) % MERCHANT_AVATAR_PALETTE.length;
}

export function merchantAvatarColor(name: string): MerchantAvatarColor {
  return MERCHANT_AVATAR_PALETTE[merchantColorIndex(name)];
}

/** The first letter or digit, upper-cased; "?" when the name has neither. */
export function merchantInitial(name: string): string {
  const match = name.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toLocaleUpperCase() : "?";
}
