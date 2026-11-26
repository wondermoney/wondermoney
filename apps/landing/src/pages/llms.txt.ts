import type { APIRoute } from "astro"
import { ROOT_LLMS_LOCALE } from "@/lib/llmsTxt"
import { llmsTxtResponse } from "@/lib/llmsTxtRoute"

export const prerender = true

export const GET: APIRoute = () => llmsTxtResponse(ROOT_LLMS_LOCALE)
