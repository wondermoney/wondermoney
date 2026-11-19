/**
 * Term deposit offers in Portugal, transcribed row by row from the table the owner supplied.
 * Conditions compiled by WonderMoney from the banks' published offers, as of 2026-11-19.
 *
 * Merged TANB and term cells of the source table are repeated on every row they span. Notes are
 * the original Portuguese text, verbatim: they are shown as written, never translated.
 * Educational data only: conditions change, so every figure must be confirmed with the bank.
 */

export type EarlyWithdrawal = "yes" | "seeNotes" | "no"

export interface TermDepositOffer {
	/** Gross nominal annual rate (TANB), in percent. */
	tanb: number
	termMonths: number
	bank: string
	product: string
	/** Minimum amount in euros; null when the source gives none. */
	minimum: number | null
	/** Maximum amount in euros; null when the source gives none. */
	maximum: number | null
	/** Only for new clients of the bank. */
	newClients: boolean
	/** Requires new money ("Novos recursos"). */
	newMoney: boolean
	/** Early withdrawal ("Mobilização antecipada"): allowed, "ver notas" (see notes) or not stated. */
	earlyWithdrawal: EarlyWithdrawal
	/** Foreign bank: interest is not withheld in Portugal and the saver declares it. */
	irsNotWithheld: boolean
	/** Original Portuguese notes, verbatim; empty when the source has none. */
	notes: string
}

export const TERM_DEPOSIT_OFFERS_AS_OF = "2026-11-19"

export const TERM_DEPOSIT_OFFERS_SOURCE = {
	note: "Conditions compiled by WonderMoney from the banks' published offers",
	asOf: TERM_DEPOSIT_OFFERS_AS_OF,
} as const

export const TERM_DEPOSIT_OFFERS: readonly TermDepositOffer[] = [
	{ tanb: 4.0, termMonths: 3, bank: "BiG", product: "Super Depósito", minimum: 5000, maximum: 50000, newClients: true, newMoney: false, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "+0,10% para < 30 anos, ACP, ordens profissionais" },
	{ tanb: 3.5, termMonths: 6, bank: "ActivoBank", product: "Novos Clientes", minimum: 500, maximum: 100000, newClients: true, newMoney: false, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "" },
	{ tanb: 3.5, termMonths: 6, bank: "BiG", product: "Super Depósito", minimum: 10000, maximum: 50000, newClients: true, newMoney: false, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "+0,10% para ACP e ordens profissionais" },
	{ tanb: 3.35, termMonths: 12, bank: "Haitong Bank", product: "Depósito premium", minimum: 50000, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "3,30% mobilizável" },
	{ tanb: 3.35, termMonths: 24, bank: "Haitong Bank", product: "Depósito premium", minimum: 50000, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "" },
	{ tanb: 3.3, termMonths: 6, bank: "Best", product: "Novos Clientes", minimum: 500, maximum: 250000, newClients: true, newMoney: false, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "" },
	{ tanb: 3.3, termMonths: 6, bank: "Haitong Bank", product: "Depósito premium", minimum: 50000, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "3,25% mobilizável" },
	{ tanb: 3.3, termMonths: 12, bank: "Easisave", product: "Fixed term deposit", minimum: 1000, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: true, notes: "Juros trimestrais ou na maturidade" },
	{ tanb: 3.3, termMonths: 24, bank: "Easisave", product: "Fixed term deposit", minimum: 1000, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: true, notes: "Juros trimestrais, anuais ou na maturidade" },
	{ tanb: 3.3, termMonths: 24, bank: "Haitong Bank", product: "Depósito a prazo", minimum: null, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "3,25% mobilizável\n50€/ano manutenção se < 5 000€" },
	{ tanb: 3.3, termMonths: 36, bank: "Easisave", product: "Fixed term deposit", minimum: 1000, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: true, notes: "Juros trimestrais, anuais ou na maturidade" },
	{ tanb: 3.25, termMonths: 6, bank: "Novobanco", product: "Novos Clientes", minimum: 10000, maximum: 500000, newClients: true, newMoney: false, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "7,90€/mês (redução por idade, domiciliação, etc)" },
	{ tanb: 3.25, termMonths: 12, bank: "BAI Europa", product: "Depósito a prazo", minimum: 1000, maximum: 10000000, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "2,00% mobilizável" },
	{ tanb: 3.25, termMonths: 12, bank: "Haitong Bank", product: "Depósito a prazo", minimum: null, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "3,20% mobilizável\n+0,05% ou +0,10% para subscritores Proteste\n50€/ano manutenção se < 5 000€" },
	{ tanb: 3.24, termMonths: 48, bank: "Klarna", product: "Conta poupança", minimum: null, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: true, notes: "Juros anuais" },
	{ tanb: 3.2, termMonths: 6, bank: "Haitong Bank", product: "Depósito a prazo", minimum: null, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "3,15% mobilizável\n+0,05% ou +0,10% para subscritores Proteste\n50€/ano manutenção se < 5 000€" },
	{ tanb: 3.19, termMonths: 36, bank: "Klarna", product: "Conta poupança", minimum: null, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: true, notes: "Juros anuais" },
	{ tanb: 3.15, termMonths: 3, bank: "Haitong Bank", product: "Depósito premium", minimum: 50000, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: false, notes: "" },
	{ tanb: 3.15, termMonths: 6, bank: "BAI Europa", product: "Depósito a prazo", minimum: 1000, maximum: 10000000, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "2,10% mobilizável" },
	{ tanb: 3.15, termMonths: 6, bank: "BAI Europa", product: "Novos Clientes", minimum: 2500, maximum: 10000000, newClients: true, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: false, notes: "+0,05% ou +0,10% para subscritores Proteste" },
	{ tanb: 3.15, termMonths: 24, bank: "Finantia", product: "Visão", minimum: 50000, maximum: 500000, newClients: false, newMoney: true, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "Opção de juros semestrais, mobilizável só no final de cada semestre" },
	{ tanb: 3.15, termMonths: 24, bank: "Klarna", product: "Conta poupança", minimum: null, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: true, notes: "Juros anuais" },
	{ tanb: 3.11, termMonths: 18, bank: "Klarna", product: "Conta poupança", minimum: null, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: true, notes: "" },
	{ tanb: 3.1, termMonths: 12, bank: "Finantia", product: "Jump", minimum: 50000, maximum: 500000, newClients: false, newMoney: true, earlyWithdrawal: "no", irsNotWithheld: false, notes: "Juros semestrais" },
	{ tanb: 3.05, termMonths: 3, bank: "Haitong Bank", product: "Depósito a prazo", minimum: null, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "3,00% mobilizável\n+0,05% ou +0,10% para subscritores Proteste\n50€/ano manutenção se < 5 000€" },
	{ tanb: 3.0, termMonths: 3, bank: "ActivoBank", product: "Dinheiro Novo", minimum: 5000, maximum: 125000, newClients: false, newMoney: true, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "Bónus 50€ se >= 25 000€ (ver regulamento)" },
	{ tanb: 3.0, termMonths: 3, bank: "Bison Bank", product: "Rendimento Premium", minimum: 5000, maximum: 250000, newClients: false, newMoney: true, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "" },
	{ tanb: 3.0, termMonths: 3, bank: "Carregosa", product: "Bem-Vindo", minimum: 5000, maximum: 100000, newClients: true, newMoney: false, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "Mínimo 1 000€ no Canal NextGen (< 30 anos)" },
	{ tanb: 3.0, termMonths: 6, bank: "Bankinter", product: "Net Boas Vindas", minimum: 1000, maximum: 100000, newClients: true, newMoney: false, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "Exclusivo online" },
	{ tanb: 3.0, termMonths: 6, bank: "Bankinter", product: "TOP", minimum: 5000, maximum: 250000, newClients: false, newMoney: true, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "" },
	{ tanb: 3.0, termMonths: 6, bank: "Bison Bank", product: "Rendimento Premium", minimum: 5000, maximum: 250000, newClients: false, newMoney: true, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "" },
	{ tanb: 3.0, termMonths: 6, bank: "Easisave", product: "Fixed term deposit", minimum: 1000, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: true, notes: "Juros trimestrais ou na maturidade" },
	{ tanb: 3.0, termMonths: 6, bank: "Finantia", product: "Jump", minimum: 50000, maximum: 500000, newClients: false, newMoney: true, earlyWithdrawal: "no", irsNotWithheld: false, notes: "" },
	{ tanb: 3.0, termMonths: 9, bank: "Easisave", product: "Fixed term deposit", minimum: 1000, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: true, notes: "Juros trimestrais ou na maturidade" },
	{ tanb: 3.0, termMonths: 12, bank: "ABANCA", product: "Especial", minimum: 15000, maximum: 100000, newClients: false, newMoney: true, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "6€/mês (3€ com ordenado) a partir do 13º mês" },
	{ tanb: 3.0, termMonths: 12, bank: "BAI Europa", product: "Premium", minimum: 2500, maximum: 10000000, newClients: false, newMoney: false, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "+0,05% ou +0,10% para subscritores Proteste" },
	{ tanb: 3.0, termMonths: 12, bank: "Banco CTT", product: "Novos Montantes", minimum: 5000, maximum: 1000000, newClients: false, newMoney: true, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "" },
	{ tanb: 3.0, termMonths: 12, bank: "BIL", product: "Term deposit", minimum: 10000, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: true, notes: "3,50€/mês a partir do 13º mês se < 25 000€" },
	{ tanb: 3.0, termMonths: 12, bank: "Bison Bank", product: "Rendimento Premium", minimum: 5000, maximum: 250000, newClients: false, newMoney: true, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "" },
	{ tanb: 3.0, termMonths: 12, bank: "Carregosa", product: "Natal", minimum: 5000, maximum: 150000, newClients: false, newMoney: true, earlyWithdrawal: "no", irsNotWithheld: false, notes: "Juros no início\nMínimo 1 000€ no Canal NextGen (< 30 anos)" },
	{ tanb: 3.0, termMonths: 12, bank: "CGD", product: "+Valor", minimum: 250, maximum: 15000, newClients: true, newMoney: false, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "4,95€/mês" },
	{ tanb: 3.0, termMonths: 12, bank: "Novobanco", product: "Novos Recursos", minimum: 100, maximum: 5000, newClients: false, newMoney: true, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "Exclusivo online\n7,90€/mês (redução por idade, domiciliação, etc)" },
	{ tanb: 3.0, termMonths: 24, bank: "Bison Bank", product: "Rendimento Premium", minimum: 5000, maximum: 250000, newClients: false, newMoney: true, earlyWithdrawal: "yes", irsNotWithheld: false, notes: "" },
	{ tanb: 3.0, termMonths: 24, bank: "BNI Europa", product: "Depósito a prazo", minimum: 2500, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "2,95% com juros mensais\n2,75% mobilizável\n2,50€/mês manutenção se < 5 000€" },
	{ tanb: 3.0, termMonths: 36, bank: "BNI Europa", product: "Depósito a prazo", minimum: 2500, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "2,95% com juros mensais\n2,75% mobilizável\n2,50€/mês manutenção se < 5 000€" },
	{ tanb: 3.0, termMonths: 36, bank: "MeDirect", product: "Fixed term deposit", minimum: 5000, maximum: null, newClients: false, newMoney: true, earlyWithdrawal: "no", irsNotWithheld: true, notes: "Juros trimestrais, semestrais ou anuais" },
	{ tanb: 3.0, termMonths: 48, bank: "BNI Europa", product: "Depósito a prazo", minimum: 2500, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "2,95% com juros mensais\n2,75% mobilizável\n2,50€/mês manutenção se < 5 000€" },
	{ tanb: 3.0, termMonths: 60, bank: "BNI Europa", product: "Depósito a prazo", minimum: 2500, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "seeNotes", irsNotWithheld: false, notes: "2,95% com juros mensais\n2,75% mobilizável\n2,50€/mês manutenção se < 5 000€" },
	{ tanb: 3.0, termMonths: 60, bank: "BluOr Bank", product: "Deposit account", minimum: 1000, maximum: null, newClients: false, newMoney: false, earlyWithdrawal: "no", irsNotWithheld: true, notes: "Subscrever depósito sem abrir conta (tem custos)\nPedir redução da taxa de retenção" },
]
