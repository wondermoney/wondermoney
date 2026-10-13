import { NextFetchEvent, NextRequest, NextResponse } from 'next/server';
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation';
import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware';
import { docsContentRoute, docsRoute } from '@/lib/shared';
import { i18n, locales } from '@/lib/i18n';

const { rewrite: rewriteDocs } = rewritePath(
  `/{lang}${docsRoute}{/*path}`,
  `${docsContentRoute}/{lang}{/*path}/content.md`,
);
const { rewrite: rewriteSuffix } = rewritePath(
  `/{lang}${docsRoute}{/*path}.md`,
  `${docsContentRoute}/{lang}{/*path}/content.md`,
);

const i18nMiddleware = createI18nMiddleware(i18n);

const legacyLegalPaths = new Set([
  '/about/privacy-policy',
  '/about/terms-of-service',
  '/pt/about/privacy-policy',
  '/pt/about/terms-of-service',
  // RAD-573 — the es legal pages are real routes under app/(legal-es), so they
  // must reach Next directly rather than being handed to the i18n middleware,
  // exactly as their pt counterparts are.
  '/es/about/privacy-policy',
  '/es/about/terms-of-service',
]);

function hasSupportedLocale(pathname: string) {
  return locales.some((locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`));
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (legacyLegalPaths.has(request.nextUrl.pathname)) {
    return NextResponse.next();
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
