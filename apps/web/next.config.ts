// This file sets a custom webpack configuration to use your Next.js app with Sentry.
// https://nextjs.org/docs/api-reference/next.config.js/introduction
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import type { SentryBuildOptions } from "@sentry/nextjs";
import { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "path";

import { isSentryEnabled } from "./lib/utils/sentry-enabled";
import { version } from "./package.json";

const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

const withNextIntl = createNextIntlPlugin();

const publicEnv: NextConfig["env"] = { PKG_VERSION: version };

const nextConfig: NextConfig = {
  // The self-hosting image (Dockerfile) builds a standalone server; Vercel builds as before.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
  images: {
    // Intentional: Vercel image optimization is cost-prohibitive for the current
    // WonderMoney image usage, so the app relies on upstream/CDN image sizing.
    unoptimized: true,
    // The only entries here were GoCardless/Nordigen bank-logo CDN hosts
    // (cdn.nordigen.com, cdn-logos.gocardless.com, and a scoped
    // storage.googleapis.com/gc-prd-institution_icons-production/** pattern).
    // GoCardless is no longer used for new bank connections (Enable Banking,
    // BYOK — see plan §8), no code path constructs image URLs against those
    // hosts anymore, and `unoptimized: true` above means next/image never
    // enforces `remotePatterns` in the first place (the hostname check lives
    // in the default loader, which `unoptimized` skips entirely). Removed as
    // dead config rather than left to bit-rot further.
    remotePatterns: [],
  },
  reactStrictMode: true,
  /**
   * The loans module lived at /credits until we renamed it to the word we
   * actually use. Emails already sent, bookmarks and anything else holding the
   * old path keep working — there is no reason to serve those a 404.
   *
   * The locale segment is matched explicitly rather than with a bare `:locale`
   * so this cannot swallow some future top-level `/<something>/credits`.
   */
  async redirects() {
    return [
      {
        source: "/:locale(en|pt|es)/credits/:path*",
        destination: "/:locale/loans/:path*",
        permanent: true,
      },
      {
        source: "/credits/:path*",
        destination: "/loans/:path*",
        permanent: true,
      },
    ];
  },
  // Dependencies are installed at the monorepo root, so both bundlers and the standalone
  // output's file tracing have to look there.
  turbopack: { root: path.join(__dirname, "../..") },
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // @ts-ignore
  webpack(config, { dev, isServer }) {
    if (dev && !isServer && process.env.NEXT_PUBLIC_ENABLE_WDYR === "1") {
      const originalEntry = config.entry;
      config.entry = async () => {
        const wdrPath = path.resolve(__dirname, "./scripts/wdyr.ts");
        const entries = await originalEntry();

        if (entries["main.js"] && !entries["main.js"].includes(wdrPath)) {
          entries["main.js"].push(wdrPath);
        }
        return entries;
      };
    }

    return config;
  },
  env: publicEnv,
};

function isSentryConfigEnabled() {
  return isSentryEnabled();
}

const sentryWebpackPluginOptions: SentryBuildOptions = {
  org: "wonder-money",
  project: "web",
  telemetry: false,
  silent: !process.env.CI,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  widenClientFileUpload: true,
  webpack: {
    reactComponentAnnotation: {
      enabled: true,
    },
  },
};

const baseConfig = [withBundleAnalyzer, withNextIntl].reduce(
  (config, plugin) => plugin(config),
  nextConfig,
);

const withSentryConfig = (...args: any[]) =>
  require("@sentry/nextjs").withSentryConfig(...args);

module.exports = isSentryConfigEnabled()
  ? withSentryConfig(baseConfig, sentryWebpackPluginOptions)
  : baseConfig;
