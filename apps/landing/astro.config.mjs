import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import sanity from "@sanity/astro";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultLocale = "pt";
const locales = ["en", "pt", "es", "fr", "de", "it"];

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: vercel(),
  site: "https://wonder.money",
  trailingSlash: "never",
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
      // Paid-traffic ad landing pages are noindex,follow and must
      // never compete for organic rankings — keep them out of the sitemap too.
      filter: (page) => !/\/go\//.test(page),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  },
});
