import { isAppSignupUrl } from "./appLinks";
import { readConsentDecision } from "./consent";
import { REFERRER_CLASS_PARAM, consentedReferrerClass, type ReferrerClass } from "./referrerClass";
import type { CuratedListRouteId, ToolRouteId } from "./routes";

/**
 * Landing attribution: which free tool or curated list a signup came from.
 *
 * A tool or list page marks its `<body>` with its route id (`data-landing-source`, set by
 * `Layout.astro`). With the visitor's analytics consent on this site, every link to the app's
 * signup on that page gets `?landing_source=<route id>` when it is followed, and the app sends
 * it with the signup only when the visitor allows analytics in the app too
 * (`apps/web/lib/analytics/landing-source.ts`). Nothing is stored: the id rides in the link.
 * The same id is added to every analytics event the page sends (`posthog.ts`), so a tool's
 * visits, uses and next-step clicks line up with its signups (`docs/landing-attribution.md`).
 *
 * Every page's signup links also get `?referrer_class=<class>` under the same consent: where the
 * visitor came to the site from, as a coarse class (`referrerClass.ts`).
 */
export type LandingSource = ToolRouteId | CuratedListRouteId;

export const LANDING_SOURCE_PARAM = "landing_source";

/** The route id of the tool or list page being viewed, or undefined on any other page. */
export function getLandingSource(doc: Document = document): string | undefined {
  return doc.body?.dataset.landingSource || undefined;
}

/**
 * `href` with the landing source set, or removed when `source` is undefined. Only links to the
 * app's signup, in any of its languages, change; any other link comes back as it was.
 */
export function withLandingSource(href: string, source: string | undefined): string {
  return withSignupAttribution(href, { landingSource: source });
}

export type SignupAttribution = Readonly<{
  landingSource?: string;
  referrerClass?: ReferrerClass;
}>;

/**
 * `href` with the landing source and the referrer class set, each removed when undefined. Only
 * links to the app's signup change; any other link comes back as it was.
 */
export function withSignupAttribution(href: string, attribution: SignupAttribution): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (!isAppSignupUrl(url)) return href;
  const params: Array<[string, string | undefined]> = [
    [LANDING_SOURCE_PARAM, attribution.landingSource],
    [REFERRER_CLASS_PARAM, attribution.referrerClass],
  ];
  for (const [name, value] of params) {
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
  }
  return url.toString();
}

/**
 * Sets the landing source (on a tool or list page) and the referrer class (on every page) on a
 * signup link as it is followed (click, middle click, or the context menu's "open in new tab"),
 * reading the consent at that moment, so a choice changed after the page loaded is honoured and a
 * withdrawn one takes both back off.
 */
export function installLandingSourceLinks(doc: Document = document): void {
  const source = getLandingSource(doc);

  const decorate = (event: Event) => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
    if (!link) return;
    const consented = readConsentDecision(window.localStorage).purposes.analytics;
    const next = withSignupAttribution(
      link.href,
      consented ? { landingSource: source, referrerClass: consentedReferrerClass(doc, window) } : {},
    );
    if (next !== link.href) link.href = next;
  };

  for (const type of ["click", "auxclick", "contextmenu"]) {
    doc.addEventListener(type, decorate, { capture: true });
  }
}
