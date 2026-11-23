import { webFeatureScreens } from "@wondermoney/shared/analytics";
import { describe, expect, it } from "vitest";

import { resolveFeatureScreen } from "./feature-screen";

/** Routes walked from the app that are deliberately not counted. */
const NOT_COUNTED = new Set(["/admin/bank-sync", "/sample-rest"]);

/**
 * Every `page.tsx` under `app/[locale]`, as the pathname `usePathname` reports for it: route
 * groups such as `(full-layout)` drop out and each dynamic segment takes a sample value. The
 * glob is lazy, so no page is loaded.
 */
function routes(): string[] {
  const prefix = "../../app/[locale]/";
  return Object.keys(import.meta.glob("../../app/**/page.tsx"))
    .filter((file) => file.startsWith(prefix))
    .map((file) => {
      const segments = file
        .slice(prefix.length)
        .split("/")
        .slice(0, -1)
        .filter((segment) => !/^\(.*\)$/u.test(segment))
        .map((segment) =>
          segment.startsWith("[...")
            ? "sample-rest"
            : segment.startsWith("[")
              ? "sample-1"
              : segment,
        );
      return `/${segments.join("/")}`;
    });
}

describe("resolveFeatureScreen", () => {
  const all = routes();

  it("walks the app's routes", () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it.each(all.filter((route) => !NOT_COUNTED.has(route)))(
    "names the screen of %s",
    (route) => {
      expect(resolveFeatureScreen(route)).not.toBeNull();
    },
  );

  it("counts no route of the operators' console, and no unknown path", () => {
    expect(resolveFeatureScreen("/admin/bank-sync")).toBeNull();
    expect(resolveFeatureScreen("/sample-rest")).toBeNull();
  });

  it("leaves no identifier without a route", () => {
    const reached = new Set(all.map((route) => resolveFeatureScreen(route)));
    expect(webFeatureScreens.filter((screen) => !reached.has(screen))).toEqual(
      [],
    );
  });

  it("never answers with the path, and ignores a trailing slash", () => {
    expect(resolveFeatureScreen("/accounts/123/transactions")).toBe(
      "account_transactions",
    );
    expect(resolveFeatureScreen("/accounts/transactions/review")).toBe(
      "transaction_review",
    );
    expect(resolveFeatureScreen("/portfolio/transactions/")).toBe(
      "portfolio_activity",
    );
    expect(resolveFeatureScreen("/budgets/wizard/income")).toBe(
      "budget_create",
    );
  });
});
