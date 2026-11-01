import { NextFetchEvent, NextRequest, NextResponse } from 'next/server';
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation';
import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware';
import { docsContentRoute, docsRoute } from '@/lib/shared';
import { i18n, locales } from '@/lib/i18n';

// rewritePath patterns are path-to-regexp v8 syntax: `:lang` is a named
// parameter, `{...}` is an optional *group* (so `{lang}` would be the literal
// text "lang", and `/{lang}/docs` would match only `/lang/docs` or `/docs`),
// and `{/*path}` is an optional wildcard. `/en/docs.md` therefore maps to
// `/llms.mdx/docs/en/content.md` and `/en/docs/a/b.md` to
// `/llms.mdx/docs/en/a/b/content.md` (#91).
const { rewrite: rewriteDocs } = rewritePath(
  `/:lang${docsRoute}{/*path}`,
  `${docsContentRoute}/:lang{/*path}/content.md`,
);
const { rewrite: rewriteSuffix } = rewritePath(
  `/:lang${docsRoute}{/*path}.md`,
  `${docsContentRoute}/:lang{/*path}/content.md`,
);

const i18nMiddleware = createI18nMiddleware(i18n);

// The legal pages are route groups, not Fumadocs content: English lives at the
// unprefixed /about/<page> (app/(legal)), pt and es under their locale prefix
// (app/(legal-pt), app/(legal-es) — RAD-573). They must reach Next directly
// rather than being handed to the i18n middleware, which would prefix the
// English ones with /en/ and 404.
const legalPages = [
  'privacy-policy',
  'terms-of-service',
  'cookie-policy',
  'accessibility-statement',
  'refund-cancellation-policy',
];

const legalPaths = new Set(
  legalPages.flatMap((page) => [`/about/${page}`, `/pt/about/${page}`, `/es/about/${page}`]),
);

// /en/about/<page> is what a `{lang}` URL template (the API's
// PRIVACY_POLICY_URL, for one) produces for English. The canonical English URL
// has no prefix, so redirect there (#45).
const englishLegalPaths = new Set(legalPages.map((page) => `/en/about/${page}`));

function hasSupportedLocale(pathname: string) {
  return locales.some((locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`));
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  if (legalPaths.has(pathname)) {
    return NextResponse.next();
  }

  if (englishLegalPaths.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice('/en'.length);
    return NextResponse.redirect(url, 308);
  }

  if (hasSupportedLocale(request.nextUrl.pathname)) {
    const result = rewriteSuffix(request.nextUrl.pathname);
    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl));
    }

    if (isMarkdownPreferred(request)) {
      const result = rewriteDocs(request.nextUrl.pathname);

      if (result) {
        return NextResponse.rewrite(new URL(result, request.nextUrl));
      }
    }
  }

  return i18nMiddleware(request, event);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|images|favicon.ico|robots.txt|sitemap.xml|llms|og).*)'],
};
