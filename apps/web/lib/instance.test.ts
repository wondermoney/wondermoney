import { describe, expect, it } from "vitest";

import { resolveInstanceConfig } from "./instance";

const SELF_HOSTED = { NEXT_PUBLIC_API_URL: "https://api.example.com", NEXT_PUBLIC_APP_URL: "https://money.example.com" };

describe("resolveInstanceConfig", () => {
  it("gives a self-hosted instance no legal links, admin domain, demo account, cookie domain or error tracking of ours", () => {
    expect(resolveInstanceConfig(SELF_HOSTED)).toEqual({
      adminEmailDomain: null,
      appHost: "money.example.com",
      cookieDomain: undefined,
      demoEmail: null,
      docsUrl: "https://docs.wonder.money",
      privacyUrl: null,
      sentryDsn: null,
      termsUrl: null,
    });
  });

  it("lets every setting be configured explicitly", () => {
    expect(
      resolveInstanceConfig({
        ...SELF_HOSTED,
        NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN: "@example.com",
        NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: ".example.com",
        NEXT_PUBLIC_DOCS_URL: "https://docs.example.com/",
        NEXT_PUBLIC_PRIVACY_URL: "https://example.com/privacy",
        NEXT_PUBLIC_SENTRY_DSN: "https://key@sentry.example.com/1",
        NEXT_PUBLIC_TERMS_URL: "https://example.com/terms",
      }),
    ).toMatchObject({
      adminEmailDomain: "@example.com",
      cookieDomain: ".example.com",
      docsUrl: "https://docs.example.com",
      privacyUrl: "https://example.com/privacy",
      sentryDsn: "https://key@sentry.example.com/1",
      termsUrl: "https://example.com/terms",
    });
  });

  it("uses a host-only cookie on localhost", () => {
    expect(resolveInstanceConfig({ NEXT_PUBLIC_API_URL: "http://localhost:3001", NEXT_PUBLIC_APP_URL: "http://localhost:3000" }).cookieDomain).toBe("localhost");
  });
});
