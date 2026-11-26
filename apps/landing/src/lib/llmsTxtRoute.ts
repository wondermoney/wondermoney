/**
 * The llms.txt endpoints' shared body (`src/pages/llms.txt.ts`, `src/pages/{locale}/llms.txt.ts`).
 * Apart from `llmsTxt.ts` because it reads the guides through `astro:content`.
 */
import { getGuides } from "./contentCollections"
import type { Lang } from "./i18nLocale"
import { buildLlmsTxt } from "./llmsTxt"

export async function llmsTxtResponse(locale: Lang): Promise<Response> {
	const guides = (await getGuides()).filter((guide) => guide.locale === locale)
	return new Response(buildLlmsTxt(locale, guides), {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	})
}
