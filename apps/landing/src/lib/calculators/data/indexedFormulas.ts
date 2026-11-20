// The energy-price formulas of the indexed (OMIE) household offers in ERSE's export
// (data/electricityOffers.ts), each read from the supplier's own documents on the day given. Kept by
// hand: check them when the offers refresh shows a supplier's indexed prices or documents changed,
// and at least every quarter (several suppliers may revise their adders in January, April, July and
// October). The form of each formula is in indexedPricing.ts (IndexedFormula).
//
// Only offers whose supplier publishes every term of the formula are here. The others stay on
// ERSE's estimate (the comparison marks them `estimated`), for the reason given:
// - Plenitude (Power Index, Energy Index, Tendência), Luzboa and Rockwatt (SPOTDEF, Autorock, Indie
//   Spot), Coopérnico (Único), Audax (TOP T0 to T4), Alfa Energia (Power Index BTN) and Nossa
//   Energia: their formulas add the system operator's costs (REN "custos de gestão do sistema",
//   deviations) or guarantees of origin at the actual monthly value, which they do not publish.
// - Iberdrola (Simples Indexado Dinâmico, Tri-Horário Indexado): both fichas are past their own
//   validity date (30 June and 30 September 2026), and the live pages give other loss factors and
//   adders than the fichas.
// - Luzigás (Super LIG Index): the ficha and the tariff page give different K and system-cost
//   values, and the network-access tariff is not mentioned.
// - Oeneo (Flex): its only stated adder (0,00206 EUR/kWh for operating, system and deviation costs
//   and the social-tariff financing together) equals the social-tariff charge alone, and the
//   guarantees of origin have no value.
// - Portulogos (Plano Ajustado GO 30): the product is not on the supplier's site; its indexed ficha
//   publishes the formula without any of its values.
// Never copy formulas from third-party simulators: each one here cites the supplier's document.
// The social-tariff financing charge (`levies`, 0,0020666 EUR/kWh) is ERSE's for 2026: update it
// each January with the new Diretiva.

import type { IndexedFormula } from "../indexedPricing";

const READ_ON = "2026-11-20";

export const INDEXED_FORMULAS_REVIEWED = READ_ON;

export const INDEXED_FORMULAS: readonly IndexedFormula[] = [
  {
    supplier: "EDPC",
    product: "Eletricidade Indexada média",
    // The electricity-only offers and every dual and "Pack Funciona" offer built on it: their fichas
    // in the same bundle carry the same K1, K2, K3 and losses.
    offerIds: [
      "EDPC_33", "EDPC_34", "EDPC_35", "EDPC_36", "EDPC_92", "EDPC_93", "EDPC_94", "EDPC_95",
      "EDPC_114", "EDPC_115", "EDPC_116", "EDPC_117", "EDPC_141", "EDPC_142", "EDPC_143", "EDPC_144",
      "EDPC_160", "EDPC_161", "EDPC_162", "EDPC_163", "EDPC_179", "EDPC_180", "EDPC_181", "EDPC_182",
    ],
    basis: "periodMean",
    losses: { kind: "fixed", factor: 1.164 },
    multiplier: 1.1,
    beforeLosses: 0,
    adder: 0.0185,
    levies: 0,
    tar: "added",
    options: ["simple", "biHourly", "triHourly"],
    sources: [
      {
        document: "EDP Comercial, Ficha normalizada de oferta de fornecimento de energia, Eletricidade Indexada média (EDPC138, 22122025)",
        url: "https://www.edp.pt/media/uknapr1m/fin-indexada.pdf",
        location: "PDF page 15 (Pag 2/5 of the offer's ficha); the dual and pack fichas, PDF pages 24 to 362, repeat it",
        readOn: READ_ON,
        quote:
          "Preço = Σi [(POMIE i × (1 + Perdas i) × K1 + K2 + TAREnergia i) × Consumo i] + (K3 + TARPotência) × Nº de dias. " +
          "POMIE i: Correspondente ao preço médio do mercado ibérico de eletricidade em Portugal (OMIE PT), apurado de acordo com a opção tarifária contratada e para o período de consumo. " +
          "Perdas i = 16.4%. K1 = 1.10. K2 = 0.0185 €/kWh. K3 = 0.1171 €/dia.",
      },
      {
        document: "EDP, Eletricidade e gás com preço indexado (offer page), worked example",
        url: "https://www.edp.pt/particulares/energia/gas-eletricidade-oferta-indexada/",
        location: "\"Exemplo ilustrativo\": 3,45 kVA, tarifa simples, 200 kWh/mês; OMIE PT 50, 70 and 155 €/MWh give 37, 42 and 64 €/mês",
        readOn: READ_ON,
        quote: "Exemplo ilustrativo. Não considera a aplicação de descontos comerciais. Exemplo para cliente com potência 3,45kVA, tarifa simples e consumo de 200kWh/mês.",
      },
    ],
    caveat:
      "\"Preço médio ... apurado de acordo com a opção tarifária\" is read as the arithmetic mean of OMIE PT over each tariff period's hours of the billing month; the ficha does not say whether it is weighted by consumption.",
  },
  {
    supplier: "GOLD",
    product: "Tarifa Index 04/25",
    offerIds: ["GOLD_41", "GOLD_42", "GOLD_77", "GOLD_78", "GOLD_85", "GOLD_86"],
    basis: "monthMean",
    losses: { kind: "monthly", factors: [1.29, 1.18, 1.18, 1.15, 1.11, 1.1, 1.15, 1.13, 1.1, 1.1, 1.16, 1.25] },
    multiplier: 1,
    beforeLosses: 0,
    // QTarifa 0,02425 + CG 0,03.
    adder: 0.05425,
    // Social-tariff financing, ERSE Diretiva n.º 12-A/2025, for 2026.
    levies: 0.0020666,
    tar: "added",
    options: ["simple"],
    sources: [
      {
        document: "Goldenergy, Ficha normalizada, tarifários indexados (preços para novas adesões atualizados a 01-10-2026)",
        url: "https://goldenergy.pt/resources/data/website/documentos/ficha-normalizada-indexados.pdf",
        location: "p. 5 (Tarifa Index 04/25), repeated on pp. 8 and 9 for the dual offers",
        readOn: READ_ON,
        quote:
          "CE = ((Pomie* (1 + Perdas) + QTarifa + CG ) * Consumo) + (TEPAi * Consumo). Pomie = Valor médio do período de faturação, do mercado diário publicado pelo Operador do Mercado Ibérico de Energia (€/kWh). " +
          "Perdas: jan 29%, fev 18%, mar 18%, abr 15%, mai 11%, jun 10%, jul 15%, ago 13%, set 10%, out 10%, nov 16%, dez 25%. QTarifa = 0,02425 €/kWh. CG = 0,03 €/kWh. " +
          "Ao preço da energia acresce o encargo com o financiamento da tarifa social de eletricidade ... no valor de 0,0020666 €/kWh para 2026.",
      },
    ],
    caveat: "The billing period's average is read as OMIE Portugal's arithmetic mean over the month; the ficha names neither the weighting nor the price zone.",
  },
  {
    supplier: "GOLD",
    product: "Tarifa Index 100% Online",
    offerIds: ["GOLD_79", "GOLD_80", "GOLD_83", "GOLD_84", "GOLD_87", "GOLD_88"],
    basis: "monthMean",
    losses: { kind: "monthly", factors: [1.29, 1.18, 1.18, 1.15, 1.11, 1.1, 1.15, 1.13, 1.1, 1.1, 1.16, 1.25] },
    multiplier: 1,
    beforeLosses: 0,
    // QTarifa 0,02425 + CG 0,005 (0,03 if direct debit or the electronic invoice is cancelled).
    adder: 0.02925,
    levies: 0.0020666,
    tar: "added",
    options: ["simple"],
    sources: [
      {
        document: "Goldenergy, Ficha normalizada, tarifários indexados (preços para novas adesões atualizados a 01-10-2026)",
        url: "https://goldenergy.pt/resources/data/website/documentos/ficha-normalizada-indexados.pdf",
        location: "pp. 11, 13 and 14 (Tarifa Index 100% Online, with direct debit and electronic invoice)",
        readOn: READ_ON,
        quote:
          "CE = ((Pomie* (1 + Perdas) + QTarifa + CG ) * Consumo) + (TEPAi * Consumo). QTarifa = 0,02425 €/kWh. CG = 0,005 €/kWh – Custo de gestão por cada kWh consumido pelo Cliente. " +
          "Perdas as in Tarifa Index 04/25. Acresce o encargo com o financiamento da tarifa social ... 0,0020666 €/kWh para 2026.",
      },
    ],
    caveat: "As Tarifa Index 04/25.",
  },
  {
    supplier: "END",
    product: "Tarifa Indexada",
    offerIds: ["END_86", "END_87", "END_90"],
    basis: "monthMean",
    losses: { kind: "fixed", factor: 1 },
    multiplier: 1,
    beforeLosses: 0,
    adder: 0,
    levies: 0,
    // "A" holds the access tariffs, estimated system services and losses, and the margin.
    tar: "included",
    periodTerms: [
      { fromKva: 1.15, toKva: 2.3, simple: 0.109409 },
      { fromKva: 3.45, toKva: 6.9, simple: 0.109409, biHourly: [0.127166, 0.072035] },
      { fromKva: 10.35, toKva: 13.8, simple: 0.109409, biHourly: [0.127148, 0.071984], triHourly: [0.294252, 0.073425, 0.071904] },
      { fromKva: 17.25, toKva: 20.7, simple: 0.109354, biHourly: [0.127134, 0.071963], triHourly: [0.294252, 0.073425, 0.071883] },
      { fromKva: 27.6, toKva: 41.4, triHourly: [0.294752, 0.084625, 0.071083] },
    ],
    options: ["simple", "biHourly", "triHourly"],
    sources: [
      {
        document: "Endesa, Ficha contratual padronizada Indexada (F26.0407, documento editado a 12/10/2026)",
        url: "https://www.endesa.pt/content/dam/endesa-pt/precos/tarifa-indexada.pdf",
        location: "p. 2 (price table: A by option, period and power) and p. 4 (formula)",
        readOn: READ_ON,
        quote:
          "Fatura = ( CG + TP ) d + ( A + B ) consumo. A – Outros custos Simples: Preço de tarifas de acesso, custo de serviço de sistemas estimados, perdas estimadas e margem do comercializador. " +
          "B – Custos Energia Indexada: Eletricidade: Preço médio diário do OMIE em Portugal para o período de faturação.",
      },
    ],
    caveat:
      "Page 3 of the same ficha defines B as \"Preço horário do OMIE em Portugal para o período de faturação\"; the arithmetic mean of the month (page 4 and the offer page) is used.",
  },
  {
    supplier: "GALP",
    product: "Plano Flexível",
    offerIds: ["GALP_170", "GALP_171"],
    basis: "quarterHour",
    losses: { kind: "profile" },
    multiplier: 1,
    beforeLosses: 0.0191,
    adder: 0,
    levies: 0,
    tar: "added",
    options: ["simple", "biHourly", "triHourly"],
    sources: [
      {
        document: "Galp, Plano Flexível (offer page, \"Como é calculado o preço de energia de eletricidade no Plano Flexível?\")",
        url: "https://www.galp.com/pt/casa/planos-eletricidade-e-gas/flexivel",
        location: "FAQ, Plano Flexível",
        readOn: READ_ON,
        quote:
          "Energia = ((∑[ (PMi+Ci) * (1+Li)]*Q consumida perfilada i)/Q total consumida). PMi – preço horário em mercado ibérico OMIE – Portugal (€/kWh) ...; " +
          "Ci – Componente de Comercializador ... é de 0,0191€/kWh ...; Li – aplicação dos valores fixos em percentagem para perdas ..., publicados pela ERSE ...; " +
          "Q consumida perfilada i – Consumo perfilado resulta da distribuição do consumo total ... de acordo com (i) perfil de consumo publicado pela ERSE",
      },
      {
        document: "Galp, Ficha normalizada, Plano dinâmico - Residencial (with the Plano Flexível clause)",
        url: "https://www.galp.com/pt/casa/system/files/2026-09/plano-indexado-residencial-fno.pdf",
        location: "pp. 3 and 4",
        readOn: READ_ON,
        quote: "Preço Final (PF)i = [∑ (PMi+Ci) * (1+Li)]*Q consumida real i)/(Q total consumida*1000). Ci ... à data da celebração do contrato, é de 0,0159€/kWh",
      },
    ],
    caveat:
      "The ficha (September 2026) gives Ci = 0,0159 EUR/kWh, the live offer page 0,0191; Ci may be revised each quarter, and the page's value is used. Li is read as the low-voltage loss profile (data/omiePrices.ts).",
  },
  {
    supplier: "LOGICA",
    product: "Base Index S",
    offerIds: ["LOGICA_02"],
    basis: "quarterHour",
    losses: { kind: "profile" },
    multiplier: 1,
    beforeLosses: 0,
    // CGS 0,022 + CO 0,006 + DS 0,022.
    adder: 0.05,
    limits: { min: 0.14, max: 1 },
    // TS, the social-tariff financing charge.
    levies: 0.0020666,
    tar: "added",
    options: ["simple", "biHourly"],
    sources: [
      {
        document: "Logica Energy, Ficha normalizada de oferta de fornecimento de energia, Base Index (v.5.05, promocional até 30/11/2026)",
        url: "https://logicaenergy.pt/wp-content/uploads/2026/11/Ficha-Padronizada_BIS.v.5.05_V2.pdf",
        location: "p. 2 (formula) and p. 4 (100 kWh example at October 2026's OMIE PT)",
        readOn: READ_ON,
        quote:
          "PE = max(Lim_min, min(Lim_max, PO × (1 + FP) + CGS + CO + DS)) + TAR + TS. Lim_min ... 0,1400 €/kWh; Lim_max ... 1,0000 €/kWh; PO: Custo da Energia horária no Mercado Diário OMIE- Portugal; " +
          "FP: Fator de perdas de acordo com os perfis publicados pela ERSE; CGS ... 0,022 €/kWh; CO ... 0,006 €/kWh; DS ... 0,022 €/kWh; TS ... 0,0020666 €/kWh.",
      },
    ],
    caveat:
      "The limits are applied to each month's price (the bill shows one \"Ajuste de Mercado\" over the 0,14 floor). The ficha does not give FP's value: its October 2026 example (35,99 EUR for 100 kWh at 1,15 kVA) implies OMIE x (1 + FP) = 195,07 EUR/MWh, the loss profile gives 194,09, so this prices that example at 35,89 EUR.",
  },
];
