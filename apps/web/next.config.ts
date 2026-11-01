// This file sets a custom webpack configuration to use your Next.js app with Sentry.
// https://nextjs.org/docs/api-reference/next.config.js/introduction
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import type { SentryBuildOptions } from "@sentry/nextjs/config";
import { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "path";

import { isSentryEnabled } from "./lib/utils/sentry-enabled";
import { version } from "./package.json";

const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

const withNextIntl = createNextIntlPlugin();

/**
 * The version shown in the app. package.json carries the release version, changed by hand in a
 * normal PR when cutting a release (nothing commits version bumps); the build
 * appends the commit it was built from, so staging and production builds are told apart without
 * committing anything. The SHA comes from GitHub Actions, Vercel's own git builds, or the
 * GIT_COMMIT_SHA build argument of the self-hosting image.
 */
function buildVersion(): string {
  const sha = (
    process.env.GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    ""
  ).trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? `${version}+${sha.slice(0, 7)}` : version;
}

const publicEnv: NextConfig["env"] = { PKG_VERSION: buildVersion() };

const nextConfig: NextConfig = {
  // The self-hosting image (Dockerfile) builds a standalone server; Vercel builds as before.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
  // Next 16.3+ makes `next dev` write a managed "agent rules" block into AGENTS.md whenever it
  // detects a coding agent, and rewrite it whenever the installed version words it differently,
  // so the file kept showing up as modified. AGENTS.md is hand-maintained here and already
  // points at the bundled docs, so the generation is off (documented: next-config-js/agentRules).
  agentRules: false,
  images: {
    // Intentional: Vercel image optimization is cost-prohibitive for the current
    // WonderMoney image usage, so the app relies on upstream/CDN image sizing.
    unoptimized: true,
    // Empty on purpose: `unoptimized: true` above means next/image never
    // enforces `remotePatterns` (the hostname check lives in the default
    // loader, which `unoptimized` skips entirely).
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
  reactComponentAnnotation: {
    enabled: true,
  },
};

const baseConfig = [withBundleAnalyzer, withNextIntl].reduce(
  (config, plugin) => plugin(config),
  nextConfig,
);

const withSentryConfig = (...args: any[]) =>
  require("@sentry/nextjs/config").withSentryConfig(...args);

module.exports = isSentryConfigEnabled()
  ? withSentryConfig(baseConfig, sentryWebpackPluginOptions)
  : baseConfig;
