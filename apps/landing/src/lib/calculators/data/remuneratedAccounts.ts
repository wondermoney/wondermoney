import { BANK_ACCOUNTS_SOURCE } from "./bankAccountsSource"

/**
 * Remunerated and savings accounts, transcribed row by row from the table the owner supplied, as
 * of 2026-11-19. Rows keep the table's order (highest TANB first). Merged TANB cells in the source
 * are repeated on each row they span. `notes` are the table's own lines in Portuguese, verbatim.
 *
 * "See notes" cells are kept as flags rather than numbers: `termSeeNotes` (Prazo "ver notas"),
 * `minimumSeeNotes` and `maximumSeeNotes` mean the cell carried a figure that the notes qualify,
 * so the calculator does not treat the number as a hard limit.
 */
export type RemuneratedAccountType = "ordem" | "poupancaComIban" | "poupancaSemIban" | "dividaPublica" | "seguro"

/** "paidPlan" is the table's "Em plano pago": joint holders only on a paid plan. */
export type TwoHolders = "yes" | "paidPlan" | "no"

export interface RemuneratedAccount {
	id: string
	/** Yearly gross rate in percent. A single rate has `tanbMin === tanbMax`; ranges differ by plan. */
	tanbMin: number
	tanbMax: number
	/** Months the rate or the product runs; null when the table leaves it blank. */
	termMonths: number | null
	termSeeNotes: boolean
	entity: string
	/** The table marks bunq with an asterisk it does not explain; kept, not displayed. */
	entityMark?: "*"
	product: string
	type: RemuneratedAccountType
	minimum: number | null
	minimumSeeNotes: boolean
	maximum: number | null
	maximumSeeNotes: boolean
	instantTransfer: boolean
	twoHolders: TwoHolders
	/** The table's IRS column: the bank does not withhold, the saver declares the interest. */
	irsNotWithheld: boolean
	/** Highlighted in the source: public debt, linked to the savings certificates tool. */
	highlighted?: boolean
	notes: readonly string[]
}

export const REMUNERATED_ACCOUNTS_AS_OF = BANK_ACCOUNTS_SOURCE.asOf
export const REMUNERATED_ACCOUNTS_SOURCE_NOTE = BANK_ACCOUNTS_SOURCE.note

const base = {
	termMonths: null,
	termSeeNotes: false,
	minimum: null,
	minimumSeeNotes: false,
	maximum: null,
	maximumSeeNotes: false,
	instantTransfer: false,
	twoHolders: "no",
	irsNotWithheld: false,
} as const satisfies Partial<RemuneratedAccount>

export const REMUNERATED_ACCOUNTS: readonly RemuneratedAccount[] = [
	{
		...base,
		id: "bankinter-conta-mais-ordenado",
		tanbMin: 5,
		tanbMax: 5,
		termMonths: 12,
		entity: "Bankinter",
		product: "Conta Mais Ordenado",
		type: "ordem",
		maximum: 10_000,
		instantTransfer: true,
		twoHolders: "yes",
		notes: [
			"Juros semestrais",
			"Exige domiciliação de salário de 750€ e utilização de cartão de crédito",
			"2,00% no segundo ano",
			"Conta sem custo",
		],
	},
	{
		...base,
		id: "advanzia-deposit-account",
		tanbMin: 4.1,
		tanbMax: 4.1,
		termMonths: 3,
		entity: "Advanzia Bank",
		product: "Deposit Account",
		type: "poupancaComIban",
		minimum: 5_000,
		maximum: 1_000_000,
		irsNotWithheld: true,
		notes: [
			"Juros mensais",
			"1,50% após 3 meses, se não houver prolongamento da taxa inicial",
			"Associado a nossa conta à ordem em outro banco",
		],
	},
	{
		...base,
		id: "bunq-savings-account",
		tanbMin: 3.11,
		tanbMax: 3.11,
		termSeeNotes: true,
		entity: "bunq",
		entityMark: "*",
		product: "Savings Account",
		type: "poupancaComIban",
		maximum: 100_000,
		instantTransfer: true,
		twoHolders: "paidPlan",
		irsNotWithheld: true,
		notes: [
			"Juros semanais",
			"1,51% a partir de janeiro/julho no saldo máximo do semestre anterior",
			"2 levantamentos por mês",
			"Conta à ordem sem custo no plano Free",
		],
	},
	{
		...base,
		id: "banco-ctt-conta-poupanca-livre",
		tanbMin: 3,
		tanbMax: 3,
		entity: "Banco CTT",
		product: "Conta Poupança Livre",
		type: "poupancaSemIban",
		minimum: 5_000,
		minimumSeeNotes: true,
		maximum: 5_000,
		instantTransfer: true,
		twoHolders: "yes",
		notes: [
			"Juros em janeiro, abril, julho e outubro, na conta à ordem",
			"Exige domiciliação de salário/pensão de 800€ ou de 3 débitos diretos",
			"Conta à ordem sem custo se saldo na conta poupança >= 5 000€",
		],
	},
	{
		...base,
		id: "bankinter-conta-online",
		tanbMin: 3,
		tanbMax: 3,
		entity: "Bankinter",
		product: "Conta ONline",
		type: "ordem",
		maximum: 100_000,
		instantTransfer: true,
		twoHolders: "yes",
		notes: ["Juros mensais", "Exclusiva para novos clientes", "Conta sem custo"],
	},
	{
		...base,
		id: "activobank-poupeup-premium",
		tanbMin: 2.75,
		tanbMax: 2.75,
		entity: "ActivoBank",
		product: "Conta PoupeUp com plano Premium",
		type: "poupancaSemIban",
		maximum: 20_000,
		instantTransfer: true,
		twoHolders: "yes",
		notes: ["Juros mensais", "Plano com custo 8,99€/mês (gratuito por 3 meses para novos clientes)"],
	},
	{
		...base,
		id: "fcm-bank-top-saver-pro",
		tanbMin: 2.68,
		tanbMax: 2.68,
		entity: "FCM Bank",
		product: "Top Saver Pro",
		type: "poupancaComIban",
		minimum: 2_000,
		maximum: 10_000,
		maximumSeeNotes: true,
		irsNotWithheld: true,
		notes: [
			"Juros mensais",
			"2,28% sobre saldo acima de 10 000€ até 25 000€",
			"1,78% sobre saldo acima de 25 000€",
			"Associado a nossa conta à ordem em outro banco",
		],
	},
	{
		...base,
		id: "igcp-certificados-aforro-serie-f",
		tanbMin: 2.5,
		tanbMax: 2.5,
		termMonths: 3,
		entity: "IGCP",
		product: "Certificados Aforro série F",
		type: "dividaPublica",
		minimum: 100,
		maximum: 250_000,
		highlighted: true,
		notes: [
			"Juros trimestrais",
			"TANB atualizada trimestralmente (máx 2,50%)",
			"Prémio de permanência a partir do segundo ano",
		],
	},
	{
		...base,
		id: "openbank-conta-poupanca-boas-vindas",
		tanbMin: 2.5,
		tanbMax: 2.5,
		termMonths: 6,
		entity: "Openbank",
		product: "Conta Poupança Boas-vindas",
		type: "poupancaComIban",
		maximum: 500_000,
		instantTransfer: true,
		irsNotWithheld: true,
		notes: [
			"Juros mensais",
			"Exclusiva para novos clientes",
			"Após 6 meses, passa a Conta Poupança Ordenado",
			"Conta à ordem sem custo",
		],
	},
	{
		...base,
		id: "fidelidade-savings-seguro",
		tanbMin: 2.3,
		tanbMax: 2.3,
		termSeeNotes: true,
		entity: "Fidelidade",
		product: "Savings - opção seguro",
		type: "seguro",
		minimum: 25,
		notes: [
			"Juros diários sem capitalização",
			"TANB atualizada a 1 janeiro e 1 julho",
			"Levantamentos demoram 3 a 5 dias úteis",
			"Seguro sem comissões",
		],
	},
	{
		...base,
		id: "klarna-conta-flex",
		tanbMin: 2.2,
		tanbMax: 2.7,
		entity: "Klarna",
		product: "Conta Flex",
		type: "poupancaComIban",
		irsNotWithheld: true,
		notes: [
			"Juros mensais",
			"2,20% na conta Standard, sem custo",
			"2,20% na conta Core, com custo 1,99€/mês",
			"2,30% na conta Plus, com custo 7,99€/mês",
			"2,40% na conta Premium, com custo 14,99€/mês (-30% por 3 meses)",
			"2,70% na conta Max, com custo 34,99€/mês (-30% por 3 meses)",
		],
	},
	{
		...base,
		id: "activobank-poupeup-plus",
		tanbMin: 2,
		tanbMax: 2,
		entity: "ActivoBank",
		product: "Conta PoupeUp com plano Plus",
		type: "poupancaSemIban",
		maximum: 5_000,
		instantTransfer: true,
		twoHolders: "yes",
		notes: ["Juros mensais", "Plano com custo 3,99€/mês (gratuito por 3 meses para novos clientes)"],
	},
	{
		...base,
		id: "medirect-memax-savings",
		tanbMin: 2,
		tanbMax: 2,
		entity: "MeDirect",
		product: "MeMax Savings Account",
		type: "poupancaSemIban",
		maximum: 100_000,
		instantTransfer: true,
		irsNotWithheld: true,
		notes: ["Juros mensais", "Depósito de até 4 000€ por mês", "Conta à ordem sem custo"],
	},
	{
		...base,
		id: "openbank-conta-poupanca-ordenado",
		tanbMin: 2,
		tanbMax: 2,
		entity: "Openbank",
		product: "Conta Poupança Ordenado",
		type: "poupancaComIban",
		instantTransfer: true,
		irsNotWithheld: true,
		notes: ["Juros mensais", "1,00% sem transferência mensal de 700€ para conta à ordem", "Conta à ordem sem custo"],
	},
	{
		...base,
		id: "revolut-poupanca-acesso-imediato",
		tanbMin: 1.5,
		tanbMax: 2.75,
		entity: "Revolut (conta PT)",
		product: "Poupança Acesso Imediato",
		type: "poupancaSemIban",
		maximum: 100_000,
		instantTransfer: true,
		twoHolders: "yes",
		notes: [
			"Juros diários",
			"1,50% na conta Standard, sem custo",
			"1,50% na conta Plus, com custo 3,99€/mês ou 40€/ano",
			"1,75% na conta Premium, com custo 9,99€/mês ou 100€/ano",
			"2,50% na conta Metal, com custo 15,99€/mês ou 155€/ano",
			"2,75% na conta Ultra, com custo 50€/mês ou 540€/ano",
		],
	},
]
