/**
 * Where a visitor came to the website from, as one coarse class: an AI assistant, a search
 * engine, a social network, no referrer at all (`direct`), or anything else (`other`).
 *
 * With the visitor's analytics consent, PostHog's own events carry the referring page and the
 * campaign (`utm_*`) parameters as they always have (`posthog.ts`). What this module adds is the
 * class: the only thing the site's own code keeps in the browser (`sessionStorage`), and the only
 * thing put on the signup links (`landingSource.ts`) and so passed to the app, which sends it
 * with the signup only with its own opt-in too (`docs/landing-attribution.md`). The list is the analytics catalogue's
 * `ANALYTICS_REFERRER_CLASSES` (`packages/shared/lib/analytics/catalogue.ts`); keep the two in step.
 */
export const REFERRER_CLASSES = ["ai_assistant", "search", "social", "direct", "other"] as const;

export type ReferrerClass = (typeof REFERRER_CLASSES)[number];

export const REFERRER_CLASS_PARAM = "referrer_class";

/**
 * The class of the visit's first page, for the pages after it, whose referrer is this site.
 * Written only with analytics consent, removed when it is withdrawn, gone with the tab.
 */
export const REFERRER_CLASS_STORAGE_KEY = "wondermoney.referrer-class";

// Hostnames, each matching itself and its subdomains (`www.perplexity.ai`).
const AI_ASSISTANT_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
  "claude.ai",
];
const SEARCH_HOSTS = [
  "bing.com",
  "duckduckgo.com",
  "ecosia.org",
  "search.yahoo.com",
  "search.brave.com",
  "startpage.com",
  "qwant.com",
  "kagi.com",
  "baidu.com",
];
const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "t.co",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "lnkd.in",
  "reddit.com",
  "youtube.com",
  "tiktok.com",
  "threads.net",
  "bsky.app",
  "mastodon.social",
  "news.ycombinator.com",
  "whatsapp.com",
  "t.me",
];
// Google's and Yandex's search run on a country domain: `www.google.pt`, `google.co.uk`.
const COUNTRY_SEARCH_HOST = /^(?:www\.)?(?:google|yandex)\.[a-z]{2,3}(?:\.[a-z]{2})?$/u;

// Names a campaign link gives as its `utm_source` (`utm_source=chatgpt.com` from ChatGPT's answers).
const AI_ASSISTANT_SOURCES = new Set(["chatgpt", "openai", "perplexity", "gemini", "copilot", "claude"]);
const SEARCH_SOURCES = new Set(["google", "bing", "duckduckgo", "ecosia", "yahoo", "brave", "startpage", "qwant", "kagi", "yandex", "baidu"]);
const SOCIAL_SOURCES = new Set([
  "facebook", "fb", "instagram", "ig", "twitter", "x", "linkedin", "reddit", "youtube", "tiktok",
  "threads", "bluesky", "mastodon", "hackernews", "whatsapp", "telegram",
]);

// Android apps send `android-app://<package>/` as the referrer.
const ANDROID_APPS: Record<string, ReferrerClass> = {
  "com.openai.chatgpt": "ai_assistant",
  "ai.perplexity.app.android": "ai_assistant",
  "com.google.android.apps.bard": "ai_assistant",
  "com.anthropic.claude": "ai_assistant",
  "com.google.android.googlequicksearchbox": "search",
  "com.facebook.katana": "social",
  "com.instagram.android": "social",
  "com.linkedin.android": "social",
  "com.reddit.frontpage": "social",
  "com.twitter.android": "social",
  "com.whatsapp": "social",
};

const matchesHost = (host: string, hosts: readonly string[]) =>
  hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));

function classifyHost(host: string): ReferrerClass {
  if (matchesHost(host, AI_ASSISTANT_HOSTS)) return "ai_assistant";
  if (COUNTRY_SEARCH_HOST.test(host) || matchesHost(host, SEARCH_HOSTS)) return "search";
  if (matchesHost(host, SOCIAL_HOSTS)) return "social";
  return "other";
}

/** A `utm_source`'s class, or undefined for a source this list does not know. */
function classifyUtmSource(value: string): ReferrerClass | undefined {
  const source = value.trim().toLowerCase();
  if (!source) return undefined;
  if (source.includes(".")) {
    const host = source.replace(/^www\./u, "");
    const byHost = classifyHost(host);
    if (byHost !== "other") return byHost;
  }
  const name = source.split(/[.\s_-]/u)[0] ?? "";
  if (AI_ASSISTANT_SOURCES.has(name)) return "ai_assistant";
  if (SEARCH_SOURCES.has(name)) return "search";
  if (SOCIAL_SOURCES.has(name)) return "social";
  return undefined;
}

/**
 * wonder.money and its subdomains (the app, the docs): coming back from them continues the visit,
 * so it keeps the class it had rather than becoming `other`.
 */
const isOwnHost = (host: string) => host === "wonder.money" || host.endsWith(".wonder.money");

/**
 * The class of a page view, from its referrer and its URL's `utm_source`, or undefined when the
 * referrer is this site, the app or the docs (a click from one page to the next, or a return
 * from the app): the visit's first page has the class then. A `utm_source` the list knows wins over the referrer; an unknown one counts as
 * `other` only when there is no referrer to go by.
 */
export function classifyReferrer(referrer: string, pageUrl: string): ReferrerClass | undefined {
  let page: URL | undefined;
  try {
    page = new URL(pageUrl);
  } catch {
    page = undefined;
  }

  const utmSource = page?.searchParams.get("utm_source") ?? "";
  const fromUtm = classifyUtmSource(utmSource);
  if (fromUtm) return fromUtm;

  let from: URL;
  try {
    from = new URL(referrer);
  } catch {
    return utmSource.trim() ? "other" : "direct";
  }

  if (from.protocol === "android-app:") return ANDROID_APPS[from.hostname.toLowerCase()] ?? "other";
  const host = from.hostname.toLowerCase();
  if (isOwnHost(host) || (page && host === page.hostname.toLowerCase())) return undefined;
  return classifyHost(host);
}

export function isReferrerClass(value: unknown): value is ReferrerClass {
  return (REFERRER_CLASSES as readonly unknown[]).includes(value);
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(win: Window | undefined): StorageLike | undefined {
  try {
    return win?.sessionStorage;
  } catch {
    return undefined; // blocked storage: the class is then only the current page's
  }
}

/**
 * The visit's class, for a caller that already checked the visitor's analytics consent: this
 * page's own class, kept for the pages after it, or on a page reached from this site the one
 * kept from the visit's first page. Undefined when consent came after the first page.
 */
export function consentedReferrerClass(
  doc: Document = document,
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): ReferrerClass | undefined {
  const pageUrl = doc.location?.href ?? win?.location.href ?? "";
  const current = classifyReferrer(doc.referrer, pageUrl);
  const store = sessionStore(win);
  try {
    if (current) {
      store?.setItem(REFERRER_CLASS_STORAGE_KEY, current);
      return current;
    }
    const kept = store?.getItem(REFERRER_CLASS_STORAGE_KEY);
    return isReferrerClass(kept) ? kept : undefined;
  } catch {
    return current;
  }
}

/** Removes the kept class: analytics consent was withdrawn or never given. */
export function forgetReferrerClass(
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): void {
  try {
    sessionStore(win)?.removeItem(REFERRER_CLASS_STORAGE_KEY);
  } catch {
    // Nothing kept when storage is blocked.
  }
}
