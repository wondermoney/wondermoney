import ptPT from './resources/pt-PT.json'

/*
 * European Portuguese copy addresses the reader as "tu" ("Toca para
 * atualizar", "a tua conta"), never as "você" or in the formal third person
 * ("Toque para atualizar", "a sua conta"); CONTRIBUTING.md has the rule. These
 * patterns catch the formal form where it is unambiguous: "você" anywhere, and
 * a formal imperative opening a sentence. (The same list guards the web and
 * email copy.)
 */
const FORMAL_ADDRESS = [
  /(?<!\p{L})[Vv]ocê(?!\p{L})/u,
  /(?:^|[.!?:…]\s+|\n)(?:Clique|Toque|Adicione|Escolha|Selecione|Digite|Escreva|Insira|Introduza|Confirme|Verifique|Tente|Utilize|Aceda|Experimente|Certifique-se|Inicie|Registe-se|Contacte|Aguarde|Reveja|Volte|Abra|Crie|Guarde|Ligue|Faça|Veja|Consulte|Descarregue|Elimine|Mantenha)(?![\p{L}-])/u,
]

/** Keys of pt-PT strings that match on purpose, with the reason. */
const EXCEPTIONS: Record<string, string> = {}

const leaves = (value: unknown, prefix = ''): [string, string][] => {
  if (typeof value === 'string') return [[prefix, value]]
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  )
}

const isFormal = (message: string) => FORMAL_ADDRESS.some((pattern) => pattern.test(message))

describe('pt-PT form of address', () => {
  it('addresses the reader as tu', () => {
    const found = leaves(ptPT)
      .filter(([key, message]) => !(key in EXCEPTIONS) && isFormal(message))
      .map(([key, message]) => `${key}: ${message}`)

    // Use the tu form (CONTRIBUTING.md), or list the key in EXCEPTIONS with a reason.
    expect(found).toEqual([])
  })

  it('lists only exceptions that still exist and still match', () => {
    const all = new Map(leaves(ptPT))
    const stale = Object.keys(EXCEPTIONS).filter((key) => {
      const message = all.get(key)
      return message === undefined || !isFormal(message)
    })

    expect(stale).toEqual([])
  })
})
