import type { RulePresetLocale } from "@/lib/api/rule/useRulePresets";

/** The region of a BCP 47 tag (`pt-BR` → `BR`), when it names one. */
function regionOf(tag: string): string | undefined {
  try {
    const region = new Intl.Locale(tag).region;
    return region && /^[A-Z]{2}$/.test(region) ? region : undefined;
  } catch {
    return undefined;
  }
}

function languageOf(tag: string): string | undefined {
  try {
    return new Intl.Locale(tag).language;
  } catch {
    return undefined;
  }
}

/**
 * What to tell the API about the person when asking which rule preset to
 * offer: the app's language, and the browser's region. A browser language in
 * the app's language decides the region first (`pt-BR` for a Portuguese
 * reader), then any browser language with a region.
 */
export function presetLocale(
  appLocale: string,
  browserLanguages: readonly string[] = [],
): RulePresetLocale {
  const language = languageOf(appLocale) ?? appLocale;
  const sameLanguage = browserLanguages.find(
    (tag) => languageOf(tag) === language && regionOf(tag),
  );
  const region =
    regionOf(appLocale) ??
    (sameLanguage ? regionOf(sameLanguage) : undefined) ??
    browserLanguages.map(regionOf).find(Boolean);
  return region ? { language, region } : { language };
}

/** The browser's preferred languages, or none outside a browser. */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length
    ? navigator.languages
    : navigator.language
      ? [navigator.language]
      : [];
}
