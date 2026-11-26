import type { APIRoute } from "astro"
import { llmsTxtResponse } from "@/lib/llmsTxtRoute"

export const prerender = true

export const GET: APIRoute = () => llmsTxtResponse("de")
