import { CTA_URL } from "@/hooks/useCtaUrl";
import { readConsentDecision } from "./consent";
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
 */
export type LandingSource = ToolRouteId | CuratedListRouteId;

export const LANDING_SOURCE_PARAM = "landing_source";

const SIGNUP_URL = new URL(CTA_URL);

/** The route id of the tool or list page being viewed, or undefined on any other page. */
export function getLandingSource(doc: Document = document): string | undefined {
  return doc.body?.dataset.landingSource || undefined;
}

/**
 * `href` with the landing source set, or removed when `source` is undefined. Only links to the
 * app's signup change; any other link comes back as it was.
 */
export function withLandingSource(href: string, source: string | undefined): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (url.origin !== SIGNUP_URL.origin || url.pathname !== SIGNUP_URL.pathname) return href;
  if (source) url.searchParams.set(LANDING_SOURCE_PARAM, source);
  else url.searchParams.delete(LANDING_SOURCE_PARAM);
  return url.toString();
}

/**
 * Sets the landing source on a signup link as it is followed (click, middle click, or the
 * context menu's "open in new tab"), reading the consent at that moment, so a choice changed
 * after the page loaded is honoured and a withdrawn one takes the id back off.
 */
export function installLandingSourceLinks(doc: Document = document): void {
  const source = getLandingSource(doc);
  if (!source) return;

  const decorate = (event: Event) => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
    if (!link) return;
    const consented = readConsentDecision(window.localStorage).purposes.analytics;
    const next = withLandingSource(link.href, consented ? source : undefined);
    if (next !== link.href) link.href = next;
  };

  for (const type of ["click", "auxclick", "contextmenu"]) {
    doc.addEventListener(type, decorate, { capture: true });
  }
}
