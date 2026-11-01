import { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";
import { updateSession } from "./lib/auth/middleware";
import { getRequestPath, REQUEST_PATH_HEADER } from "./lib/auth/stale-session";

const handleI18nRouting = createMiddleware(routing);

export async function proxy(request: NextRequest) {
  // Server components cannot see the URL, but the login redirect after a
  // failed session check needs it as `next`. next-intl forwards the request
  // headers to the page, so set it here (overwriting any client-sent value).
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, getRequestPath(request.nextUrl));
  const response = handleI18nRouting(new NextRequest(request, { headers }));

  return await updateSession(request, response);
}

export const config = {
  matcher: [
    "/((?!api|trpc|health|_next|_vercel|.*\\..*).*)",
  ],
};
