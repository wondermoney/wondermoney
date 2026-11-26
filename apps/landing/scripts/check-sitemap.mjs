// Validate the built sitemap, the legacy redirects emitted by Vercel, and any HTML redirects; in
// every built page, that its JSON-LD parses, that an FAQPage states only questions and answers the
// page prints, and that its own og:image file was built; and that every llms.txt links only built,
// canonical pages.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { getLegacyRedirects } from "../src/lib/legacySlugs.ts";

const outDir = fileURLToPath(new URL("../dist/client", import.meta.url));
const site = "https://wonder.money";

assert.ok(existsSync(join(outDir, "sitemap-index.xml")), `No sitemap-index.xml in ${outDir}: run astro build first`);

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const sitemapPaths = locs(readFileSync(join(outDir, "sitemap-index.xml"), "utf8")).flatMap((sitemapUrl) =>
  locs(readFileSync(join(outDir, new URL(sitemapUrl).pathname), "utf8")).map((url) => new URL(url).pathname),
);
const sitemap = new Set(sitemapPaths);

const pages = new Map();
const unfilled = [];
const pageFailures = [];
let jsonLdBlocks = 0;
let faqPages = 0;

// A page's visible text, as a reader sees it: no tags, scripts or styles, entities decoded.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
const decode = (text) =>
  text.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/giu, (entity, dec, hex, name) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name] ?? entity),
  );
const squash = (text) => text.replace(/\s+/gu, " ").trim();
const visibleText = (html) =>
  squash(decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/giu, " ").replace(/<[^>]+>/gu, "")));
for (const file of readdirSync(outDir, { recursive: true, encoding: "utf8" })) {
  if (!file.endsWith(".html")) continue;
  const path = `/${file.split(sep).join("/")}`.replace(/(\/index)?\.html$/, "") || "/";
  const html = readFileSync(join(outDir, file), "utf8");
  // A {{placeholder}} in page text means a translation was rendered without its values.
  for (const [text] of html.matchAll(/>[^<]*\{\{\s*[\w.]+\s*\}\}[^<]*</g)) {
    unfilled.push(`${file}: ${text.slice(1, -1).trim().slice(0, 120)}`);
  }
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    jsonLdBlocks++;
    try {
      const node = JSON.parse(json);
      if (!node["@context"] || !node["@type"]) pageFailures.push(`${file}: JSON-LD without @context or @type`);
      if (node["@type"] === "FAQPage") {
        faqPages++;
        const text = visibleText(html);
        for (const { name, acceptedAnswer } of node.mainEntity ?? []) {
          for (const part of [name, acceptedAnswer?.text]) {
            if (!part || !text.includes(squash(part))) pageFailures.push(`${file}: FAQPage states "${String(part).slice(0, 80)}", which the page does not show`);
          }
        }
      }
    } catch (error) {
      pageFailures.push(`${file}: JSON-LD does not parse (${error.message})`);
    }
  }
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  if (ogImage?.startsWith(`${site}/`) && !existsSync(join(outDir, new URL(ogImage).pathname))) {
    pageFailures.push(`${file}: og:image ${ogImage} was not built`);
  }
  const refresh = html.match(/<meta http-equiv="refresh" content="\d+;\s*url=([^"]+)"/i);
  pages.set(path, refresh ? { redirectTo: refresh[1] } : {});
}

const htmlRedirects = [...pages].filter(([, page]) => page.redirectTo);
const config = JSON.parse(readFileSync(new URL("../.vercel/output/config.json", import.meta.url), "utf8"));
const filesystemIndex = config.routes.findIndex(({ handle }) => handle === "filesystem");
assert.ok(filesystemIndex >= 0, "Vercel output is missing the filesystem route");
const edgeRedirects = config.routes.slice(0, filesystemIndex).flatMap(({ src, status, headers }) => {
  const location = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "location")?.[1];
  return src && location ? [{ pattern: new RegExp(src), status, location }] : [];
});
const legacyRedirects = getLegacyRedirects();
const failures = [];

function checkDestination(source, destination) {
  const target = new URL(destination, site).pathname;
  if (!pages.has(target) || pages.get(target).redirectTo) {
    failures.push(`${source} redirects to ${target}, which is not a built page`);
  } else if (!sitemap.has(target)) {
    failures.push(`${source} redirects to ${target}, which the sitemap leaves out`);
  }
}

for (const path of sitemapPaths) {
  const redirectTo = pages.get(path)?.redirectTo ?? edgeRedirects.find(({ pattern }) => pattern.test(path))?.location;
  if (redirectTo) failures.push(`${path} is in the sitemap but redirects to ${redirectTo}`);
}

for (const { source, destination } of legacyRedirects) {
  const rule = edgeRedirects.find(({ pattern }) => pattern.test(source));
  if (rule?.status !== 301 || rule.location !== destination) {
    failures.push(`${source} must have a Vercel 301 to ${destination}, found ${rule?.status ?? "no rule"} ${rule?.location ?? ""}`);
  }
  checkDestination(source, destination);
}
for (const [path, { redirectTo }] of htmlRedirects) checkDestination(path, redirectTo);

// llms.txt, the site-wide file and one per locale: every link to this site is a built page the
// sitemap lists.
const llmsFiles = ["llms.txt", ...["pt", "en", "es", "fr", "de", "it"].map((locale) => `${locale}/llms.txt`)];
let llmsLinks = 0;
for (const file of llmsFiles) {
  if (!existsSync(join(outDir, file))) {
    failures.push(`/${file} was not built`);
    continue;
  }
  for (const [, url] of readFileSync(join(outDir, file), "utf8").matchAll(/\]\((https:\/\/wonder\.money[^)]*)\)/gu)) {
    llmsLinks++;
    const path = new URL(url).pathname;
    if (path.endsWith("/llms.txt")) {
      if (!llmsFiles.includes(path.slice(1))) failures.push(`/${file} links ${path}, which is not an llms.txt`);
    } else if (!pages.has(path) || pages.get(path).redirectTo || !sitemap.has(path)) {
      failures.push(`/${file} links ${path}, which is not a built page in the sitemap`);
    }
  }
}

assert.deepEqual(unfilled, [], `Unfilled translation placeholders in built pages:\n${unfilled.join("\n")}`);
assert.deepEqual(failures, [], `Sitemap check failed:\n${failures.join("\n")}`);
assert.deepEqual(pageFailures, [], `Page metadata check failed:\n${pageFailures.join("\n")}`);
console.log(`Sitemap check: ${sitemap.size} canonical URLs, ${legacyRedirects.length} legacy HTTP 301s and ${htmlRedirects.length} HTML redirects.`);
console.log(`Page metadata check: ${jsonLdBlocks} JSON-LD blocks parsed, ${faqPages} FAQPage blocks shown on their pages, every site og:image built.`);
console.log(`llms.txt check: ${llmsFiles.length} files, ${llmsLinks} links to built pages.`);
