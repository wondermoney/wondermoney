import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// The German site addresses the reader in the formal "Sie" ("Geben Sie … ein", "Ihr Konto"),
// as the tool pages do. These checks keep the informal "du" from coming back anywhere in the
// German catalogue.

const root = fileURLToPath(new URL("../../", import.meta.url))

function flattenStrings(value: unknown, path = ""): Array<[string, string]> {
	if (typeof value === "string") return [[path, value]]
	if (value === null || typeof value !== "object") return []
	return Object.entries(value).flatMap(([key, child]) => flattenStrings(child, path ? `${path}.${key}` : key))
}

const catalogues = ["src/locales/de/common.json", "public/locales/de/common.json"].map(
	(file) => [file, flattenStrings(JSON.parse(readFileSync(`${root}${file}`, "utf8")))] as const,
)

const informalPronoun = /(?<!\p{L})(?:du|dein|deine|deinen|deinem|deiner|deines|dir|dich|euch|euer|eure|euren|eurem|eurer)(?!\p{L})/iu

// Informal imperatives and second-person verb forms found while moving the site to "Sie". Forms
// that are also common nouns ("Bau", "Stelle", "Teile", "Suche") are left out. Formal imperatives ("Verbinden Sie") don't match. A form that is also
// the first person singular ("ich verfolge", "wenn ich meine Bank trenne") is allowed after "ich".
const informalVerbForms = [
	// Imperatives
	"analysiere", "baue", "beantworte", "beginne", "behalte", "beobachte", "beschreibe",
	"bleib", "bleibe", "bringe", "durchsuche", "entdecke", "entscheide", "erfahre", "erkenne",
	"erkunde", "erreiche", "erstelle", "filtere", "finde", "füge", "hinterlege", "hör", "höre",
	"identifiziere", "importiere", "lade", "lass", "lege", "lerne", "lies", "nutze", "passe",
	"pausiere", "plane", "probier", "probiere", "prüfe", "rechne", "reserviere", "schätze",
	"schlage", "setze", "sieh", "spare", "starte", "teste", "trenne", "triff",
	"übernimm", "überprüfe", "verbinde", "verfolge", "vergleiche", "verknüpfe", "verwandle",
	"weise", "wisse", "wähle", "betreibe", "gib", "nimm", "schau", "hol", "mach",
	// Second person singular
	"bist", "hast", "kannst", "musst", "willst", "möchtest", "solltest", "wirst", "brauchst",
	"weißt", "siehst", "findest", "verlierst", "gibst", "investierst", "sparst", "verwaltest",
	"formatierst", "fügst", "lädst", "bindest", "hebst", "wählst", "bekommst",
] as const

// "Weise" is also a noun ("auf sichere Weise", "auf ihre Weise"): after these words it is the noun.
const nounReadings: Record<string, RegExp> = {
	weise: /(?:auf|in|der|die|diese|ihre|seine|gleiche[nr]?|eigene[nr]?|sichere|andere)\s+$/iu,
}

const informalVerbPattern = new RegExp(`(?<!\\p{L})(?:${informalVerbForms.join("|")})(?!\\p{L})`, "giu")

function informalVerbs(text: string): string[] {
	return [...text.matchAll(informalVerbPattern)]
		.filter((match) => {
			const before = text.slice(0, match.index)
			if (/(?<!\p{L})ich(?!\p{L})[^.,;:!?]*$/iu.test(before)) return false
			return !nounReadings[match[0].toLowerCase()]?.test(before)
		})
		.map((match) => match[0])
}

describe("German catalogue", () => {
	it.each(catalogues)("%s has no du, dein, dir, dich or euch", (_file, strings) => {
		const informal = strings.filter(([, text]) => informalPronoun.test(text)).map(([key, text]) => `${key}: ${text}`)
		expect(informal).toEqual([])
	})

	it.each(catalogues)("%s has no informal imperatives or second-person verbs", (_file, strings) => {
		const informal = strings.flatMap(([key, text]) => informalVerbs(text).map((verb) => `${key} [${verb}]: ${text}`))
		expect(informal).toEqual([])
	})

	it("lets the first person and the noun Weise through", () => {
		expect(informalVerbs("Was passiert, wenn ich meine Bank trenne?")).toEqual([])
		expect(informalVerbs("Verbinden Sie Ihre Bankkonten auf sichere Weise")).toEqual([])
		expect(informalVerbs("Jede Bank rundet auf ihre Weise.")).toEqual([])
		expect(informalVerbs("Weise jedem Euro eine Aufgabe zu und verfolge die Ausgaben.")).toEqual(["Weise", "verfolge"])
		expect(informalVerbs("Hast du Fragen? Lies die Bedingungen.")).toEqual(["Hast", "Lies"])
	})
})
