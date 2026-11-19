import { BANK_ACCOUNTS_SOURCE } from "./bankAccountsSource"

/**
 * Free (or near-free) current accounts, transcribed row by row from the table the owner supplied,
 * as of 2026-11-19. `notes` are the table's own lines in Portuguese, one entry per line, and stay
 * verbatim; pages show them as they are.
 *
 * The last five rows (bunq, Klarna, MeDirect, N26, Openbank) share one merged notes cell in the
 * source. Lines without a bank in brackets apply to all five; "(bunq, Klarna)" and "(N26)" lines
 * apply to the banks named, with the bracket removed.
 */
export interface FreeBankAccount {
	id: string
	bank: string
	/** The account's name when the table gives one. */
	account: string | null
	twoHolders: boolean
	notes: readonly string[]
}

export const FREE_BANK_ACCOUNTS_AS_OF = BANK_ACCOUNTS_SOURCE.asOf
export const FREE_BANK_ACCOUNTS_SOURCE_NOTE = BANK_ACCOUNTS_SOURCE.note

const SHARED_BY_NEW_BANKS = [
	"Estrangeiro, a declarar no IRS",
	"Sem balcões, depósito de numerário ou cheque",
	"Sem pagamentos ent+ref ou ao estado, carregar telemóvel, MB Way",
	"Cartão não funciona em terminais apenas-multibanco",
] as const
const JOINT_ADDITIONAL = "Conta coletiva adicional a contas individuais de cada titular"

export const FREE_BANK_ACCOUNTS: readonly FreeBankAccount[] = [
	{
		id: "activo-bank-simples",
		bank: "Activo Bank",
		account: "Simples",
		twoHolders: true,
		notes: [
			"Cartão gratuito também para 2º titular",
			"Depósito de numerário ou cheque nos balcões e máquinas do Millennium BCP",
		],
	},
	{
		id: "bai-europa",
		bank: "BAI Europa",
		account: null,
		twoHolders: true,
		notes: ["DP de 1000€ (ou outro produto financeiro) para não pagar manutenção", "Cartão com anuidade a partir do 2º ano"],
	},
	{
		id: "banco-ctt",
		bank: "Banco CTT",
		account: "Banco CTT",
		twoHolders: true,
		notes: [
			"Cartão ou DP (ou outro produto financeiro) de 5000€ para não pagar manutenção",
			"Cartão com anuidade caso se façam menos de 20 compras por mês",
		],
	},
	{
		id: "bankinter-online",
		bank: "Bankinter",
		account: "ONline",
		twoHolders: true,
		notes: ["Exclusiva para novos clientes", "Saldo remunerado", "Transferências para o estrangeiro com custo"],
	},
	{
		id: "best-digital",
		bank: "Best",
		account: "Digital",
		twoHolders: true,
		notes: ["Cartão com anuidade a partir do 2º ano", "Depósito de numerário ou cheque nos balcões do Novo Banco"],
	},
	{ id: "bpi-plano-livre", bank: "BPI", account: "Plano Livre", twoHolders: true, notes: [] },
	{
		id: "moey",
		bank: "moey",
		account: null,
		twoHolders: false,
		notes: ["Sem balcões, depósito de numerário ou cheque, homebanking para PC/browser"],
	},
	{
		id: "revolut-standard",
		bank: "Revolut",
		account: "Standard",
		twoHolders: true,
		notes: [
			"Cartão físico tem custo inicial",
			"Sem balcões, depósito de numerário ou cheque",
			JOINT_ADDITIONAL,
		],
	},
	{
		id: "trade-republic",
		bank: "Trade Republic",
		account: null,
		twoHolders: false,
		notes: [
			"Saldo remunerado, parte pode ficar em fundo de investimento (capital não garantido)",
			"Cartão físico tem custo inicial",
			"Sem balcões, depósito de numerário ou cheque",
			"Sem pagamentos ent+ref ou ao estado, carregar telemóvel, MB Way",
			"Cartão não funciona em terminais apenas-multibanco",
		],
	},
	{
		id: "bunq-free",
		bank: "bunq",
		account: "Free",
		twoHolders: false,
		notes: [...SHARED_BY_NEW_BANKS, "Sem cartão físico no plano gratuito", JOINT_ADDITIONAL],
	},
	{
		id: "klarna-standard",
		bank: "Klarna",
		account: "Standard",
		twoHolders: false,
		notes: [...SHARED_BY_NEW_BANKS, "Sem cartão físico no plano gratuito", JOINT_ADDITIONAL],
	},
	{
		id: "medirect",
		bank: "MeDirect",
		account: null,
		twoHolders: true,
		notes: [...SHARED_BY_NEW_BANKS, JOINT_ADDITIONAL],
	},
	{
		id: "n26-standard",
		bank: "N26",
		account: "Standard",
		twoHolders: true,
		notes: [...SHARED_BY_NEW_BANKS, "Cartão físico tem custo inicial", JOINT_ADDITIONAL],
	},
	{
		id: "openbank",
		bank: "Openbank",
		account: null,
		twoHolders: false,
		notes: [...SHARED_BY_NEW_BANKS, JOINT_ADDITIONAL],
	},
]
