import type { Locale } from "date-fns";
import { enUS, es, pt } from "date-fns/locale";

/**
 * date-fns locale for the app's current `next-intl` locale.
 *
 * `formatDistanceToNow` and friends default to `enUS` when given no locale, so
 * every relative time in the app ("2 hours ago", "in 3 days") rendered in
 * English regardless of who was reading it — the numbers were localised and
 * the words around them were not.
 *
 * `pt` is European Portuguese here, matching `normalizeFinancialLocale`'s
 * pt → pt-PT mapping. `ptBR` is deliberately not used.
 */
export const getDateFnsLocale = (locale?: string): Locale => {
  switch (locale) {
    case "pt":
    case "pt-PT":
      return pt;
    case "es":
    case "es-ES":
      return es;
    default:
      return enUS;
  }
};
