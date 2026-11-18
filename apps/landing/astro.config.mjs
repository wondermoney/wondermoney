import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import sanity from "@sanity/astro";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";
import { isSitemapPage } from "./src/lib/sitemap.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultLocale = "pt";
const locales = ["en", "pt", "es", "fr", "de", "it"];

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: vercel(),
  site: "https://wonder.money",
  trailingSlash: "never",
  // Astro 7 defaults to "jsx", which drops whitespace between inline elements the way React
  // does; the copy relies on HTML whitespace (`<strong>x</strong> y`), so keep HTML rules.
  compressHTML: true,
  i18n: {
    locales,
    defaultLocale,
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: true,
    },
  },
  integrations: [
    react(),
    sanity({
      projectId: "94owjs69",
      dataset: "production",
      useCdn: true,
    }),
    sitemap({
      i18n: {
        locales: {
          en: "en",
          pt: "pt",
          es: "es",
          fr: "fr",
          de: "de",
          it: "it",
        },
        defaultLocale: "pt",
      },
      // filter: filterSitemapByDefaultLocale({ defaultLocale }),
      // Leaves out the noindex ad landing pages and the legacy-slug redirect pages.
      filter: isSitemapPage,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      // Bundle Astro's own runtime dependencies whose version differs from the one the hoisted
      // install puts at the root (other workspaces want cookie 0.x and html-escaper 2.x). Left
      // external, the server and prerender bundles resolve them from the root and load the
      // wrong major. Top-level `resolve` reaches every server environment; `ssr` only one.
      noExternal: ["cookie", "html-escaper"],
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  },
});
