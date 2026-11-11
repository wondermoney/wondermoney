import { describe, expect, it } from "vitest";

import { resolveInstanceConfig } from "./instance";

const SELF_HOSTED = { NEXT_PUBLIC_API_URL: "https://api.example.com", NEXT_PUBLIC_APP_URL: "https://money.example.com" };

describe("resolveInstanceConfig", () => {
  it("gives a self-hosted instance no legal links, demo account, cookie domain, error tracking or announcements of ours", () => {
    expect(resolveInstanceConfig(SELF_HOSTED)).toEqual({
      appHost: "money.example.com",
      cookieDomain: undefined,
      demoEmail: null,
      docsUrl: "https://docs.wonder.money",
      privacyUrl: null,
      sentryDsn: null,
      showPivotBanner: false,
      termsUrl: null,
    });
  });

  it("lets every setting be configured explicitly", () => {
    expect(
      resolveInstanceConfig({
        ...SELF_HOSTED,
        NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: ".example.com",
        NEXT_PUBLIC_DOCS_URL: "https://docs.example.com/",
        NEXT_PUBLIC_PRIVACY_URL: "https://example.com/privacy",
        NEXT_PUBLIC_SENTRY_DSN: "https://key@sentry.example.com/1",
        NEXT_PUBLIC_SHOW_PIVOT_BANNER: "true",
        NEXT_PUBLIC_TERMS_URL: "https://example.com/terms",
      }),
    ).toMatchObject({
      cookieDomain: ".example.com",
      docsUrl: "https://docs.example.com",
      privacyUrl: "https://example.com/privacy",
      sentryDsn: "https://key@sentry.example.com/1",
      showPivotBanner: true,
      termsUrl: "https://example.com/terms",
    });
  });

  it("uses a host-only cookie on localhost", () => {
    expect(resolveInstanceConfig({ NEXT_PUBLIC_API_URL: "http://localhost:3001", NEXT_PUBLIC_APP_URL: "http://localhost:3000" }).cookieDomain).toBeUndefined();
  });

  it("needs no cookie domain when the web app and the API share a hostname", () => {
    // One-hostname self-hosting: a host-only cookie already reaches every path on that host.
    expect(
      resolveInstanceConfig({
        NEXT_PUBLIC_API_URL: "https://money.example.com",
        NEXT_PUBLIC_APP_URL: "https://money.example.com",
        NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: ".example.com",
      }).cookieDomain,
    ).toBeUndefined();
  });

  it("applies the configured domain when the API has its own hostname", () => {
    expect(
      resolveInstanceConfig({
        ...SELF_HOSTED,
        NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: ".example.com",
      }).cookieDomain,
    ).toBe(".example.com");
  });
});
