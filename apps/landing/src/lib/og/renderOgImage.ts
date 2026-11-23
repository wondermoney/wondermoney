/**
 * Draws one OpenGraph image (ogImages.ts says what it shows) as a 1200×630 PNG, at build time
 * only: `src/pages/og/[...path].ts` is the one caller, and it is prerendered. It uses
 * @napi-rs/canvas (Skia) with the site's own Geist files, so the text looks the same on every
 * build machine and needs no system fonts.
 *
 * Layout: the wordmark at the top left; under it the section, the title (up to three lines,
 * smaller when it needs more) and the subtitle (cut to two lines); the page's lucide icon on a
 * tile at the right. Colours are DESIGN.md tokens, as sRGB.
 */
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas"
import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline"
import geistLatinExt from "@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2?inline"
import wordmark from "@/assets/logo.png?inline"
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, type OgCard } from "./ogImages"

/** DESIGN.md colour tokens (OKLCH) converted to sRGB hex. */
const COLORS = {
	background: "#faf9fe", // background oklch(98.5% 0.006 290)
	foreground: "#0a0a0a", // foreground oklch(14.5% 0 0)
	ink2: "#404040", // ink-2 oklch(37% 0 0)
	muted: "#6b6b72", // muted-foreground oklch(53% 0.012 290)
	primary: "#6044b5", // primary oklch(48% 0.17 290)
	paper2: "#f5f4fa", // paper-2 oklch(97% 0.007 290)
	border: "#e5e4ea", // border oklch(92.2% 0.008 290)
} as const

const FONT = "WonderMoneyOG, WonderMoneyOGExt"
const PADDING = 80
const ICON_TILE = 232
const TEXT_WIDTH = OG_IMAGE_WIDTH - PADDING * 2 - ICON_TILE - 64
const WORDMARK_HEIGHT = 52
/** Title sizes tried in order until the title fits in three lines. */
const TITLE_SIZES = [68, 60, 52, 46] as const
const TITLE_MAX_LINES = 3
const SUBTITLE_SIZE = 28
const SUBTITLE_MAX_LINES = 2
const EYEBROW_SIZE = 28

function dataUriBytes(dataUri: string): Buffer {
	const comma = dataUri.indexOf(",")
	if (!dataUri.startsWith("data:") || comma < 0) throw new Error("Expected a base64 data URI")
	return Buffer.from(dataUri.slice(comma + 1), "base64")
}

let fontsRegistered = false

function registerFonts(): void {
	if (fontsRegistered) return
	// The latin file covers pt, en, es, fr, de and it; latin-ext catches any other letter.
	GlobalFonts.register(dataUriBytes(geistLatin), "WonderMoneyOG")
	GlobalFonts.register(dataUriBytes(geistLatinExt), "WonderMoneyOGExt")
	fontsRegistered = true
}

/**
 * Splits `text` into lines no wider than `maxWidth`. With `maxLines`, the last line kept ends in
 * an ellipsis when words were left over; `overflowed` says whether that happened.
 */
export function wrapText(
	measure: (text: string) => number,
	text: string,
	maxWidth: number,
	maxLines = Number.POSITIVE_INFINITY,
): { lines: string[]; overflowed: boolean } {
	const words = text.trim().split(/\s+/).filter(Boolean)
	const lines: string[] = []
	let current = ""

	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word
		if (!current || measure(candidate) <= maxWidth) {
			current = candidate
		} else {
			lines.push(current)
			current = word
		}
	}
	if (current) lines.push(current)

	if (lines.length <= maxLines) return { lines, overflowed: false }

	const kept = lines.slice(0, maxLines)
	let last = kept[maxLines - 1]
	while (last.includes(" ") && measure(`${last}…`) > maxWidth) {
		last = last.slice(0, last.lastIndexOf(" "))
	}
	kept[maxLines - 1] = `${last.replace(/[\s,.;:–—-]+$/u, "")}…`
	return { lines: kept, overflowed: true }
}

function iconSvg(card: OgCard, size: number): string {
	return renderToStaticMarkup(
		createElement(card.icon, { size, color: COLORS.primary, strokeWidth: 1.5, absoluteStrokeWidth: false }),
	)
}

function roundedRect(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number) {
	ctx.beginPath()
	ctx.roundRect(x, y, width, height, radius)
}

/** Renders the card as PNG bytes. */
export async function renderOgImage(card: OgCard): Promise<Buffer> {
	registerFonts()
	const canvas = createCanvas(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT)
	const ctx = canvas.getContext("2d")

	ctx.fillStyle = COLORS.background
	ctx.fillRect(0, 0, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT)
	// A primary rule along the bottom edge, as the site's firmer rules under an answer.
	ctx.fillStyle = COLORS.primary
	ctx.fillRect(0, OG_IMAGE_HEIGHT - 10, OG_IMAGE_WIDTH, 10)

	const logo = await loadImage(dataUriBytes(wordmark))
	const logoWidth = Math.round((logo.width / logo.height) * WORDMARK_HEIGHT)
	ctx.drawImage(logo, PADDING, 64, logoWidth, WORDMARK_HEIGHT)

	// The icon tile, vertically centred at the right.
	const tileX = OG_IMAGE_WIDTH - PADDING - ICON_TILE
	const tileY = Math.round((OG_IMAGE_HEIGHT - ICON_TILE) / 2)
	roundedRect(ctx, tileX, tileY, ICON_TILE, ICON_TILE, 32)
	ctx.fillStyle = COLORS.paper2
	ctx.fill()
	ctx.lineWidth = 2
	ctx.strokeStyle = COLORS.border
	ctx.stroke()
	const iconSize = 128
	const icon = await loadImage(Buffer.from(iconSvg(card, iconSize)))
	ctx.drawImage(
		icon,
		tileX + (ICON_TILE - iconSize) / 2,
		tileY + (ICON_TILE - iconSize) / 2,
		iconSize,
		iconSize,
	)

	// The text block: section, title, subtitle.
	ctx.textBaseline = "alphabetic"
	let titleSize: number = TITLE_SIZES[0]
	let title = { lines: [] as string[], overflowed: false }
	for (const size of TITLE_SIZES) {
		titleSize = size
		ctx.font = `600 ${size}px ${FONT}`
		title = wrapText((text) => ctx.measureText(text).width, card.title, TEXT_WIDTH, TITLE_MAX_LINES)
		if (!title.overflowed) break
	}
	const titleLineHeight = Math.round(titleSize * 1.12)

	ctx.font = `400 ${SUBTITLE_SIZE}px ${FONT}`
	const subtitle = card.subtitle
		? wrapText((text) => ctx.measureText(text).width, card.subtitle, TEXT_WIDTH, SUBTITLE_MAX_LINES).lines
		: []
	const subtitleLineHeight = Math.round(SUBTITLE_SIZE * 1.4)

	const eyebrowBlock = EYEBROW_SIZE + 20
	const titleBlock = title.lines.length * titleLineHeight
	const subtitleBlock = subtitle.length ? 24 + subtitle.length * subtitleLineHeight : 0
	const blockHeight = eyebrowBlock + titleBlock + subtitleBlock
	const areaTop = 64 + WORDMARK_HEIGHT + 40
	const areaBottom = OG_IMAGE_HEIGHT - 10 - 56
	let y = Math.max(areaTop, Math.round(areaTop + (areaBottom - areaTop - blockHeight) / 2))

	ctx.font = `500 ${EYEBROW_SIZE}px ${FONT}`
	ctx.fillStyle = COLORS.primary
	ctx.fillText(card.eyebrow, PADDING, y + EYEBROW_SIZE)
	y += eyebrowBlock

	ctx.font = `600 ${titleSize}px ${FONT}`
	ctx.fillStyle = COLORS.foreground
	for (const line of title.lines) {
		ctx.fillText(line, PADDING, y + titleSize)
		y += titleLineHeight
	}

	if (subtitle.length) {
		y += 24
		ctx.font = `400 ${SUBTITLE_SIZE}px ${FONT}`
		ctx.fillStyle = COLORS.ink2
		for (const line of subtitle) {
			ctx.fillText(line, PADDING, y + SUBTITLE_SIZE)
			y += subtitleLineHeight
		}
	}

	return canvas.encode("png")
}
