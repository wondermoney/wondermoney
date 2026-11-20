import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
	CMVM_EXPORT_HEADER,
	MIN_ROWS,
	apiVersion,
	asfReturnsYear,
	buildAsfProducts,
	buildCmvmProducts,
	checkProducts,
	cmvmReturnsYear,
	dropPlaceholderZeros,
	managersFromExport,
	parseGuarantee,
	parsePercent,
	parseRiskClass,
	readAsfDir,
	renderFundsModule,
	renderInsuranceModule,
	splitCmvmName,
} from "../../../scripts/build-ppr-products.mjs"
import type { PprProduct } from "./pprTypes"

/** A row of the CMVM's DataActionGetPPRs answer, as the screen receives it. */
const cmvmRow = (overrides: Record<string, unknown> = {}) => ({
	Id: "302",
	NUM_FUN: 1538,
	NOM_FUN: "ABANCA PPR/OICVM Ciclo de Vida 35-44 - Fundo de Investimento Aberto de Poupança Reforma",
	DES_TIP: "FUNDOS DE POUPANÇA-REFORMA HARMONIZADOS",
	REND_1Y: "4.98",
	HAS_REND_1Y: true,
	REND_3Y: "7.02",
	HAS_REND_3Y: true,
	REND_5Y: "3.02",
	HAS_REND_5Y: true,
	REND_10Y: "0.0",
	HAS_REND_10Y: false,
	TAXA_TEC: "1.94",
	HAS_TAXA_TEC: true,
	PPRRiskClassId: 4,
	...overrides,
})

/** A row of the ASF platform's JSON list. */
const asfRow = (overrides: Record<string, unknown> = {}) => ({
	CodPPR_PK: 2761,
	NomComercial: "Allianz PPR ATIVO",
	CategoriaUP: "",
	EmpresaSeguros: "Allianz",
	TipoPPR: "Contrato de seguro do ramo «Vida» não ligado a fundos de investimento",
	EmComercializacao: true,
	IndicadorRisco: "",
	ValTxCustosAnual: "0,50%",
	ValComissaoSubscricaoMin: "0,00%",
	ValComissaoSubscricaoMax: "1,50%",
	ValComissaoReembolsoMin: "0,00%",
	ValComissaoReembolsoMax: "3,00%",
	ValComissaoTransferenciaMin: "0,00%",
	ValComissaoTransferenciaMax: "0,50%",
	ValRendibilidadeAnualizada1: "1,72%",
	ValRendibilidadeAnualizada3: "1,28%",
	ValRendibilidadeAnualizada5: "0,88%",
	ValRendibilidadeAnualizada10: "0,67%",
	CapitalGarantido: "No vencimento",
	RendibilidadeGarantida: "Outra situação",
	ValTxRendibilidadeMinGarantida: "2,50%",
	XComentariosAdicionais: "Free text from the insurer, never copied",
	...overrides,
})

const IFI = new Map([[1538, "https://investidor.cmvm.pt/PInvestidor/PDF_fundo?Input=ABC123"]])
const MANAGERS = new Map([
	[
		"ABANCA PPR/OICVM Ciclo de Vida 35-44 - Fundo de Investimento Aberto de Poupança Reforma",
		"IM Gestão de Ativos - Sociedade Gestora de Organismos de Investimento Coletivo, S.A.",
	],
])

let dir: string | null = null
afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true })
	dir = null
})

describe("parsing", () => {
	it("reads percentages in both lists' formats and rejects anything else", () => {
		expect(parsePercent(" 3,10%", "x")).toBe(3.1)
		expect(parsePercent("-0,81%", "x")).toBe(-0.81)
		expect(parsePercent("4.98", "x")).toBe(4.98)
		expect(parsePercent(" - ", "x")).toBeNull()
		expect(parsePercent("", "x")).toBeNull()
		expect(parsePercent(null, "x")).toBeNull()
		expect(() => parsePercent("n/d", "x")).toThrow(/not a percentage/)
		expect(() => parsePercent("12%", "TEC", { min: 0, max: 10 })).toThrow(/outside/)
	})

	it("reads risk classes 1 to 7 and treats 0 or empty as not published", () => {
		expect(parseRiskClass("4", "x")).toBe(4)
		expect(parseRiskClass(6, "x")).toBe(6)
		expect(parseRiskClass(0, "x")).toBeNull()
		expect(parseRiskClass("", "x")).toBeNull()
		expect(() => parseRiskClass("8", "x")).toThrow(/1 to 7/)
	})

	it("shortens a CMVM fund name and keeps its share class", () => {
		expect(splitCmvmName("Bankinter 25 PPR / OICVM - Fundo de Investimento Mobiliário Aberto de Poupança Reforma - Categoria C")).toEqual({
			name: "Bankinter 25 PPR / OICVM - Fundo de Investimento Mobiliário Aberto de Poupança Reforma",
			shortName: "Bankinter 25 PPR / OICVM",
			shareClass: "C",
		})
		expect(splitCmvmName("SIXTY DEGREES PPR/OICVM Flexível, Fundo de Investimento Mobiliário Aberto Flexível").shortName).toBe(
			"SIXTY DEGREES PPR/OICVM Flexível",
		)
		// A name that starts with the legal form stays whole.
		expect(splitCmvmName("Fundo de Investimento Alternativo Aberto de Poupança Reforma Santander Poupança Prudente").shortName).toBe(
			"Fundo de Investimento Alternativo Aberto de Poupança Reforma Santander Poupança Prudente",
		)
		expect(splitCmvmName("SMART INVEST PPR/OICVM MODERADO")).toEqual({
			name: "SMART INVEST PPR/OICVM MODERADO",
			shortName: "SMART INVEST PPR/OICVM MODERADO",
			shareClass: null,
		})
	})

	it("maps the ASF guarantee wording and fails on new wording", () => {
		expect(parseGuarantee("A todo o tempo", "x")).toBe("always")
		expect(parseGuarantee("No vencimento", "x")).toBe("atMaturity")
		expect(parseGuarantee("Outra situação", "x")).toBe("other")
		expect(parseGuarantee("Sem garantia", "x")).toBe("none")
		expect(parseGuarantee("", "x")).toBeNull()
		expect(() => parseGuarantee("Parcial", "x")).toThrow(/unknown guarantee/)
	})

	it("reads trailing 0.00% returns as not published, but keeps a zero before a published return", () => {
		expect(dropPlaceholderZeros({ y1: 4.39, y3: 6.89, y5: 0, y10: 0 })).toEqual({ y1: 4.39, y3: 6.89, y5: null, y10: null })
		expect(dropPlaceholderZeros({ y1: 0, y3: 0, y5: 0, y10: null })).toEqual({ y1: null, y3: null, y5: null, y10: null })
		expect(dropPlaceholderZeros({ y1: 0, y3: 1.2, y5: 0, y10: null })).toEqual({ y1: 0, y3: 1.2, y5: null, y10: null })
	})

	it("works out the year the returns refer to", () => {
		expect(cmvmReturnsYear("2026-11-20")).toBe(2025)
		expect(asfReturnsYear("2026-04-30")).toBe(2024)
		expect(asfReturnsYear("2026-05-01")).toBe(2025)
	})

	it("reads each service's apiVersion from the screen script", () => {
		const script = `controller.callDataAction("DataActionGetPPRs", "079008ed", "screenservices/PInvestidor/Comparator/PPRList/DataActionGetPPRs", "jUVVdUlZgP6xJE2Qifuqcg", function () {})`
		expect(apiVersion(script, "DataActionGetPPRs")).toBe("jUVVdUlZgP6xJE2Qifuqcg")
		expect(() => apiVersion(script, "ActionExportPPRs")).toThrow(/no longer/)
	})
})

describe("CMVM funds", () => {
	it("joins the manager from the export and the IFI link, and keeps only published figures", () => {
		const [fund] = buildCmvmProducts([cmvmRow()], MANAGERS, IFI)
		expect(fund).toEqual({
			id: "cmvm-302",
			name: "ABANCA PPR/OICVM Ciclo de Vida 35-44",
			shareClass: null,
			manager: "IM Gestão de Ativos - Sociedade Gestora de Organismos de Investimento Coletivo, S.A.",
			kind: "fund",
			category: "ucits",
			riskClass: 4,
			yearlyCost: 1.94,
			subscriptionFee: null,
			redemptionFee: null,
			transferFee: null,
			returns: { y1: 4.98, y3: 7.02, y5: 3.02, y10: null },
			capitalGuarantee: null,
			returnGuarantee: null,
			minGuaranteedRate: null,
			documentUrl: "https://investidor.cmvm.pt/PInvestidor/PDF_fundo?Input=ABC123",
		})
	})

	it("leaves out share classes with no TEC and no return, and fails on an unknown type or manager", () => {
		const empty = cmvmRow({ HAS_TAXA_TEC: false, HAS_REND_1Y: false, HAS_REND_3Y: false, HAS_REND_5Y: false })
		expect(buildCmvmProducts([empty], MANAGERS, IFI)).toEqual([])
		expect(() => buildCmvmProducts([cmvmRow({ DES_TIP: "FUNDOS NOVOS" })], MANAGERS, IFI)).toThrow(/unknown fund type/)
		expect(() => buildCmvmProducts([cmvmRow({ NOM_FUN: "Outro PPR" })], MANAGERS, IFI)).toThrow(/not in the CMVM export/)
	})

	it("reads the managers from the export and fails on a changed header", () => {
		const rows = [[...CMVM_EXPORT_HEADER], ["Fund A", "FUNDOS", "Manager A", " - "], ["", "", "", ""]]
		expect(managersFromExport(rows)).toEqual(new Map([["Fund A", "Manager A"]]))
		expect(() => managersFromExport([["Fundo", "Tipo"], ["Fund A", "x"]])).toThrow(/unexpected header/)
		expect(() => managersFromExport([[...CMVM_EXPORT_HEADER], ["Fund A", "x", ""]])).toThrow(/no manager/)
	})
})

describe("ASF products", () => {
	it("maps fees, guarantees and returns, keeps only products on sale and never copies the free-text comments", () => {
		const products = buildAsfProducts([asfRow(), asfRow({ CodPPR_PK: 1, EmComercializacao: false })], "insuranceGuaranteed")
		expect(products).toHaveLength(1)
		expect(products[0]).toEqual({
			id: "asf-2761",
			name: "Allianz PPR ATIVO",
			shareClass: null,
			manager: "Allianz",
			kind: "insuranceGuaranteed",
			category: null,
			riskClass: null,
			yearlyCost: 0.5,
			subscriptionFee: [0, 1.5],
			redemptionFee: [0, 3],
			transferFee: [0, 0.5],
			returns: { y1: 1.72, y3: 1.28, y5: 0.88, y10: 0.67 },
			capitalGuarantee: "atMaturity",
			returnGuarantee: "other",
			minGuaranteedRate: 2.5,
			documentUrl: null,
		})
		expect(JSON.stringify(products)).not.toContain("Free text")
	})

	it("names a share class only when a product is listed more than once, and drops the guaranteed rate without a guarantee", () => {
		const fund = (code: number, category: string) =>
			asfRow({ CodPPR_PK: code, NomComercial: "BBVA Estratégia Capital PPR", CategoriaUP: category, TipoPPR: "Fundo de pensões", CapitalGarantido: "Sem garantia", RendibilidadeGarantida: "Sem garantia", ValTxRendibilidadeMinGarantida: "0,00%" })
		const products = buildAsfProducts([fund(1, "A"), fund(2, "P"), asfRow({ CodPPR_PK: 3, NomComercial: "CVI PPR", CategoriaUP: "Não aplicável", TipoPPR: "Fundo de pensões" })], "pensionFund")
		expect(products.map((item) => item.shareClass)).toEqual(["A", "P", null])
		expect(products[0].minGuaranteedRate).toBeNull()
	})

	it("fails when a list holds another type of PPR", () => {
		expect(() => buildAsfProducts([asfRow()], "pensionFund")).toThrow(/expected pensionFund/)
	})

	it("reads saved lists from a folder and rejects a saved bot-check page", () => {
		dir = mkdtempSync(join(tmpdir(), "asf-"))
		const lists = {
			1: Array.from({ length: MIN_ROWS.insuranceGuaranteed }, (_, i) => asfRow({ CodPPR_PK: 100 + i, NomComercial: `G${i}` })),
			2: Array.from({ length: MIN_ROWS.insuranceLinked }, (_, i) =>
				asfRow({ CodPPR_PK: 200 + i, NomComercial: `L${i}`, TipoPPR: "Contrato de seguro do ramo «Vida» ligado a fundos de investimento" }),
			),
			3: Array.from({ length: MIN_ROWS.pensionFund }, (_, i) => asfRow({ CodPPR_PK: 300 + i, NomComercial: `P${i}`, TipoPPR: "Fundo de pensões" })),
		}
		for (const [type, rows] of Object.entries(lists)) writeFileSync(join(dir, `asf-${type}.json`), JSON.stringify(rows))
		const products = readAsfDir(dir)
		expect(products).toHaveLength(MIN_ROWS.insuranceGuaranteed + MIN_ROWS.insuranceLinked + MIN_ROWS.pensionFund)
		const module = renderInsuranceModule({ products, fetchedOn: "2026-11-20" })
		expect(module).toContain("returnsYear: 2025,")
		expect(module).toContain('id: "asf-300"')
		writeFileSync(join(dir, "asf-2.json"), "<!DOCTYPE html><html><script>window.bobcmn=1</script>")
		expect(() => readAsfDir(dir as string)).toThrow(/bot check/)
	})
})

describe("checks before writing", () => {
	const fund = (id: string): PprProduct => buildCmvmProducts([cmvmRow({ Id: id })], MANAGERS, IFI)[0]

	it("refuses a short list or a repeated id", () => {
		const funds = Array.from({ length: MIN_ROWS.cmvm }, (_, index) => fund(String(index)))
		expect(checkProducts(funds, ["cmvm"]).cmvm).toBe(MIN_ROWS.cmvm)
		expect(() => checkProducts(funds.slice(1), ["cmvm"])).toThrow(/Only 39 cmvm/)
		expect(() => checkProducts([...funds, funds[0]], ["cmvm"])).toThrow(/Duplicate/)
		const module = renderFundsModule({ products: funds, updatedOn: "2026-11-20", fetchedOn: "2026-11-20" })
		expect(module).toContain('fetchedOn: "2026-11-20"')
		expect(module).toContain("returnsYear: 2025,")
		// A list the CMVM stopped updating is refused.
		expect(() => renderFundsModule({ products: funds, updatedOn: "2026-10-01", fetchedOn: "2026-11-20" })).toThrow(/last updated/)
		expect(() => renderFundsModule({ products: funds.slice(5), updatedOn: "2026-11-20", fetchedOn: "2026-11-20" })).toThrow(/Only/)
	})
})
