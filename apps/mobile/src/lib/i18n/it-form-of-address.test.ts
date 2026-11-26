import italian from './resources/it.json'

/*
 * Italian copy addresses the reader as "tu" ("Tocca per aggiornare", "il tuo
 * conto"), never as "Lei" ("Tocchi per aggiornare", "il Suo conto"), and greets
 * without a gender ("Ti diamo il benvenuto", not "Benvenuto"). These patterns
 * catch the formal form where it is unambiguous: a formal imperative that has
 * no tu reading opening a sentence (an -are verb's "Confermi" or "Controlli"
 * is also the tu present, so it is not listed), a capitalised courtesy pronoun
 * in the middle of a sentence, and the gendered welcome. (The web copy has the
 * same list.)
 */
const FORMAL_ADDRESS = [
  /(?:^|[.!?:…]\s+|\n)(?:Scelga|Inserisca|Apra|Attenda|Faccia|Veda|Mantenga|Acceda|Scriva|Aggiunga|Si assicuri|Si registri|Legga|Prema|Chiuda|Tocchi|Crei|Torni)(?![\p{L}-])/u,
  /(?<=[\p{Ll},;] )(?:Lei|Suo|Sua|Suoi|Sue)(?!\p{L})/u,
  /(?<!\p{L})(?:La preghiamo|Le chiediamo|Le consigliamo)(?!\p{L})/u,
]

// "Benvenuto" or "Bentornata" as a greeting; "il benvenuto", the noun, is neutral.
const GENDERED_WELCOME = /(?<!\p{L})(?<!(?:il|un) )(?:[Bb]envenut|[Bb]entornat)[oaie](?!\p{L})/u

/** Keys of Italian strings that match on purpose, with the reason. */
const EXCEPTIONS: Record<string, string> = {}

const leaves = (value: unknown, prefix = ''): [string, string][] => {
  if (typeof value === 'string') return [[prefix, value]]
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  )
}

const isFormal = (message: string) => FORMAL_ADDRESS.some((pattern) => pattern.test(message))
const isGendered = (message: string) => GENDERED_WELCOME.test(message)

describe('Italian form of address', () => {
  it('addresses the reader as tu', () => {
    const found = leaves(italian)
      .filter(([key, message]) => !(key in EXCEPTIONS) && isFormal(message))
      .map(([key, message]) => `${key}: ${message}`)

    // Use the tu form, never Lei, or list the key in EXCEPTIONS with a reason.
    expect(found).toEqual([])
  })

  it('greets without a gender', () => {
    const found = leaves(italian)
      .filter(([key, message]) => !(key in EXCEPTIONS) && isGendered(message))
      .map(([key, message]) => `${key}: ${message}`)

    // "Ti diamo il benvenuto", "Che piacere rivederti".
    expect(found).toEqual([])
  })

  it('catches the formal and gendered forms it is meant to', () => {
    expect(isFormal('Inserisca il codice.')).toBe(true)
    expect(isFormal('Non è stato possibile salvare. Tocchi per riprovare')).toBe(true)
    expect(isFormal('Abbiamo aggiornato il Suo conto')).toBe(true)
    expect(isFormal('Inserisci il codice. Tocca per riprovare il tuo conto')).toBe(false)
    expect(isGendered('Benvenuto in WonderMoney')).toBe(true)
    expect(isGendered('Ciao, bentornata!')).toBe(true)
    expect(isGendered('Ti diamo il benvenuto in WonderMoney')).toBe(false)
  })

  it('lists only exceptions that still exist and still match', () => {
    const all = new Map(leaves(italian))
    const stale = Object.keys(EXCEPTIONS).filter((key) => {
      const message = all.get(key)
      return message === undefined || !(isFormal(message) || isGendered(message))
    })

    expect(stale).toEqual([])
  })
})
