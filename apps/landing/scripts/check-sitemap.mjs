// Runs after `astro build`: fails when the sitemap lists a redirect page, or when a redirect page
// does not lead to a built page the sitemap lists. Prerendered `Astro.redirect` pages are
// meta-refresh stubs (the legacy-slug addresses), so they are found by their markup.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = fileURLToPath(new URL("../dist/client", import.meta.url));
const site = "https://wonder.money";

assert.ok(existsSync(join(outDir, "sitemap-index.xml")), `No sitemap-index.xml in ${outDir}: run astro build first`);

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const sitemapPaths = locs(readFileSync(join(outDir, "sitemap-index.xml"), "utf8")).flatMap((sitemapUrl) =>
  locs(readFileSync(join(outDir, new URL(sitemapUrl).pathname), "utf8")).map((url) => new URL(url).pathname),
);
const sitemap = new Set(sitemapPaths);

const pages = new Map();
for (const file of readdirSync(outDir, { recursive: true, encoding: "utf8" })) {
  if (!file.endsWith(".html")) continue;
  const path = `/${file.split(sep).join("/")}`.replace(/(\/index)?\.html$/, "") || "/";
  const html = readFileSync(join(outDir, file), "utf8");
  const refresh = html.match(/<meta http-equiv="refresh" content="\d+;\s*url=([^"]+)"/i);
  pages.set(path, refresh ? { redirectTo: refresh[1] } : {});
}

const redirects = [...pages].filter(([, page]) => page.redirectTo);
const failures = [];

for (const path of sitemapPaths) {
  if (pages.get(path)?.redirectTo) failures.push(`${path} is in the sitemap but redirects to ${pages.get(path).redirectTo}`);
}
for (const [path, { redirectTo }] of redirects) {
  const target = new URL(redirectTo, site).pathname;
  if (!pages.has(target) || pages.get(target).redirectTo) failures.push(`${path} redirects to ${target}, which is not a built page`);
  else if (!sitemap.has(target)) failures.push(`${path} redirects to ${target}, which the sitemap leaves out`);
}

assert.deepEqual(failures, [], `Sitemap check failed:\n${failures.join("\n")}`);
console.log(`Sitemap check: ${sitemap.size} URLs, none of them redirects; ${redirects.length} redirect pages lead to listed pages.`);
