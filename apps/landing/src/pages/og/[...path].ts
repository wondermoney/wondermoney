/**
 * The generated OpenGraph images, drawn at build time and served as static files:
 * `/og/<page path>.png`. What each one shows is in `src/lib/og/ogImages.ts`.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { getGuides } from "@/lib/contentCollections";
import { guideOgCard, listStaticOgCards, ogImagePath, type OgCard } from "@/lib/og/ogImages";
import { renderOgImage } from "@/lib/og/renderOgImage";

export const prerender = true;

export const getStaticPaths = (async () => {
  const guides = await getGuides();
  const cards: OgCard[] = [
    ...listStaticOgCards(),
    ...guides.filter((guide) => !guide.ogImageUrl).map((guide) => guideOgCard(guide)),
  ];

  return cards.map((card) => ({
    params: { path: ogImagePath(card.pagePath).replace(/^\/og\//, "") },
    props: { card },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgImage((props as { card: OgCard }).card);
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png" },
  });
};
