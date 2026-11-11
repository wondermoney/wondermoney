import { describe, expect, it } from "vitest";

/**
 * The API owns `/v1/*` and `/api/auth/*` on the instance's hostname: the self-hosting `proxy`
 * profile sends those paths to the API and everything else to this app. A Next.js route added
 * under either prefix would be shadowed by the proxy — it would build, deploy and never answer,
 * which is invisible until someone uses it.
 *
 * This walks the app's route files (the route table Next.js builds from) and fails if one
 * appears there. `app/api/recaptcha` is fine: only `/api/auth` is the API's.
 */
const ROUTE_FILES = Object.keys(
  import.meta.glob("/app/**/{page,route}.{ts,tsx}", { eager: false }),
);

const API_PATH_PREFIXES = ["/v1", "/api/auth"];

/** The URL path a route file answers, with route groups dropped and dynamic segments collapsed. */
function routePath(file: string): string {
  const segments = file
    .replace(/^\/app/u, "")
    .replace(/\/(page|route)\.(ts|tsx)$/u, "")
    .split("/")
    .filter(Boolean)
    // `(full-layout)` and `(no-layout)` group files without adding a URL segment.
    .filter((segment) => !/^\(.*\)$/u.test(segment))
    // `[locale]` and `[...rest]` match anything, so they are not a fixed path of their own.
    .map((segment) => (/^\[.*\]$/u.test(segment) ? ":segment" : segment));

  return `/${segments.join("/")}`;
}

const ROUTE_PATHS = ROUTE_FILES.map(routePath);

describe("web routes and the API's paths", () => {
  it("walks the app's real route table", () => {
    // Without this, a broken glob would make the guard below pass by finding nothing.
    expect(ROUTE_PATHS).toEqual(
      expect.arrayContaining(["/", "/health", "/api/recaptcha", "/:segment/settings"]),
    );
  });

  it("keeps /v1 and /api/auth for the API", () => {
    const collisions = ROUTE_PATHS.filter((path) =>
      API_PATH_PREFIXES.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      ),
    );

    expect(collisions).toEqual([]);
  });
});
