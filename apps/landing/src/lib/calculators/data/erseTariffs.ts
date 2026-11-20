// ERSE regulated-market tariffs, network-access figures and the taxes on a low-voltage household
// electricity bill in mainland Portugal, kept by hand from official documents. Edit it when ERSE
// publishes new prices (they were updated on 1 October 2026 and can change again each quarter; the
// network-access tariffs and the social-tariff discount change each 1 January) and bump `version`.
// Educational data.
//
// Every figure below was read from these documents, downloaded on 2026-11-20 unless noted:
//
// 1. ERSE, Diretiva n.º 4/2026 (Diário da República, 2.ª série, n.º 202, 19 October 2026), first
//    amendment to Diretiva n.º 1/2026, in force from 1 October 2026 ("período IV"): the tarifas
//    transitórias de venda a clientes finais em BTN (<= 20,7 kVA and > 2,3 kVA), article 31: daily
//    power price by contracted power and the energy price per kWh, simple and bi-hourly. Prices in
//    EUR, before VAT and other taxes. Read on 2026-11-19.
//    https://www.erse.pt/media/hjab13zj/diretiva-erse-4-2026-ajuste-tenergia-se-4t2026.pdf
// 2. ERSE, Diretiva n.º 1/2026 (Diário da República, 2.ª série, n.º 4, 7 January 2026), tariffs for
//    2026. Diretiva n.º 4/2026 leaves both of these articles unchanged:
//    - article 15.º, n.º 1, alínea f), "Tarifa de Acesso às Redes em BTN (<= 20,7 kVA)": the fixed
//      (power) term of the network-access tariff (TAR), EUR per day by contracted power (page 16);
//    - article 41.º, n.º 2, "Desconto tarifa social em BTN (<= 6,9 kVA)": the social-tariff discount,
//      EUR per day by contracted power and EUR per kWh, the same for every period (page 44).
//    https://files.diariodarepublica.pt/2s/2026/01/004000000/0018600288.pdf
// 3. Código do IVA, Lista I (reduced rate), as amended:
//    - verba 2.33, added by Decreto-Lei n.º 60/2019, de 13 de maio, in force since 1 July 2019:
//      "Componente fixa das tarifas de acesso às redes nos fornecimentos de eletricidade,
//      correspondentes a uma potência contratada que não ultrapasse 3,45 kVA". The reduced rate is on
//      the TAR's fixed term only, not on the whole power price a supplier charges; the rest of the
//      power term pays the standard rate.
//      https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/diplomas_legislativos/Documents/Decreto_Lei_60_2019.pdf
//    - verba 2.38, as worded by Lei n.º 38/2024, de 7 de agosto, in force since 1 January 2025:
//      electricity, "com exclusão das suas componentes fixas", for contracted power up to 6,90 kVA, in
//      the part that does not exceed 200 kWh per 30 days, or 300 kWh per 30 days for families of five
//      or more people.
//      https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/diplomas_legislativos/Documents/Lei_38_2024.pdf
//    - verba 2.2: the audiovisual contribution (CAV) pays the reduced rate (AT, Ofício Circulado
//      n.º 30199/2018, de 20 de março).
//      https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/instrucoes_administrativas/Documents/Oficio_Circulado_30199_2018.pdf
//    The rates are 6% and 23% in the mainland (artigo 18.º do Código do IVA; the manual in 5 cites
//    Lei n.º 51-A/2011 for 23%).
// 4. ERSE, "ERSExplica: Aplicação do IVA na fatura de eletricidade" (February 2025): the same rules
//    as ERSE applies them. Page 3: 6% on the "termo fixo da Tarifa de Acesso às Redes" at 1,15 to
//    3,45 kVA, 23% on the rest of the "termo de potência". Page 7: the 200/300 kWh thresholds scale
//    with the days billed, (days / 30) x 200. Page 8: with two or three periods the threshold is
//    shared in proportion to each period's kWh, and "o comercializador pode arredondar os limiares à
//    unidade".
//    https://www.erse.pt/media/tcsfm4n2/ersexplica_iva-fatura_2025.pdf
// 5. ERSE, "Manual do Simulador de Preços de Energia da ERSE" (June 2026), pages 16 to 19: the bill's
//    other parcels and the simulator's method. CAV 2,85 EUR a month (artigo 4.º da Lei n.º 30/2003 and
//    artigo 107.º da Lei n.º 45-A/2024), 1,00 EUR a month for the social-tariff beneficiaries the
//    manual lists (Lei n.º 7-A/2016); IEC 0,001 EUR/kWh (Portaria n.º 320-D/2011), from which
//    social-tariff customers are exempt (artigo 89.º do Código dos IEC).
//    https://www.erse.pt/media/5cen41xv/manual-simulador_jun26.pdf
// 6. ERSE, "Tarifa Social na Eletricidade em 2026" (updated October 2026), page 4: the social tariff
//    is the TAR discount, IEC exemption and a 1,85 EUR monthly reduction of the CAV (2,85 - 1,85 =
//    1,00 EUR); page 3: the discount on the power term pays the reduced VAT rate at 3,45 kVA.
//    https://www.erse.pt/media/vhajllzh/tarifa-social-eletricidade-out2026.pdf
// 7. Lei n.º 30/2003, de 22 de agosto, artigo 4.º, n.º 1: consumers whose annual consumption is
//    below 400 kWh are exempt from the CAV (as quoted by the Provedor de Justiça, Recomendação
//    n.º 15/A/2013). ERSE's simulator applies it: 399 kWh a year carries no CAV, 400 kWh does
//    (read on 2026-11-20, see electricityTariffComparison.fixtures.ts).
//    https://www.provedor-jus.pt/documentos/Rec_15A2013.pdf
//
// Left out on purpose: the DGEG operating fee. ERSE's simulator manual lists it among the bill's
// taxes, but its electricity amount could not be confirmed in an official text, and ERSE's own
// simulator leaves it out of its totals (its figures match ours without it), so the pages do not
// include it and say so.

export const CONTRACTED_POWERS_KVA = [3.45, 4.6, 5.75, 6.9] as const;
export type ContractedPower = (typeof CONTRACTED_POWERS_KVA)[number];

export const ERSE_TARIFFS = {
  /** Bump when a price or a rule changes. */
  version: 2,
  /** First day these prices apply (ERSE "período IV" of 2026). */
  effectiveFrom: "2026-10-01",
  /** When the documents above were read. */
  checkedOn: "2026-11-20",
  sources: {
    tariffs: {
      name: "ERSE, Diretiva n.º 4/2026, de 15 de setembro de 2026 (tarifas e preços de energia elétrica em 2026)",
      url: "https://www.erse.pt/media/hjab13zj/diretiva-erse-4-2026-ajuste-tenergia-se-4t2026.pdf",
    },
    networkTariffs: {
      name: "ERSE, Diretiva n.º 1/2026, de 7 de janeiro (Diário da República, 2.ª série, n.º 4): artigos 15.º e 41.º",
      url: "https://files.diariodarepublica.pt/2s/2026/01/004000000/0018600288.pdf",
    },
    charges: {
      name: "ERSE, Manual do Simulador de Preços de Energia (junho de 2026)",
      url: "https://www.erse.pt/media/5cen41xv/manual-simulador_jun26.pdf",
    },
    vat: {
      name: "ERSE, ERSExplica: Aplicação do IVA na fatura de eletricidade",
      url: "https://www.erse.pt/media/tcsfm4n2/ersexplica_iva-fatura_2025.pdf",
    },
    vatPowerTerm: {
      name: "Decreto-Lei n.º 60/2019, de 13 de maio (Código do IVA, Lista I, verba 2.33)",
      url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/diplomas_legislativos/Documents/Decreto_Lei_60_2019.pdf",
    },
    vatEnergy: {
      name: "Lei n.º 38/2024, de 7 de agosto (Código do IVA, Lista I, verba 2.38)",
      url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/diplomas_legislativos/Documents/Lei_38_2024.pdf",
    },
    socialTariff: {
      name: "ERSE, Tarifa Social na Eletricidade em 2026 (outubro de 2026)",
      url: "https://www.erse.pt/media/vhajllzh/tarifa-social-eletricidade-out2026.pdf",
    },
    simulator: {
      name: "Simulador de preços de energia da ERSE",
      url: "https://simuladorprecos.erse.pt/",
    },
  },
  /** Power term, EUR per day, before VAT. */
  powerPerDay: { 3.45: 0.1917, 4.6: 0.2499, 5.75: 0.3079, 6.9: 0.3659 } satisfies Record<ContractedPower, number>,
  /** Energy, EUR per kWh, before VAT. Bi-hourly: "fora de vazio" (off-valley) and "vazio" (valley). */
  energyPerKwh: { simple: 0.1711, biPeak: 0.2045, biOffPeak: 0.1143 },
  /**
   * Fixed (power) term of the network-access tariff (TAR) in BTN <= 20,7 kVA, EUR per day, the same
   * for the simple, bi-hourly and tri-hourly options (Diretiva n.º 1/2026, artigo 15.º, n.º 1, f)).
   * Only the powers whose TAR fixed term pays the reduced VAT rate are kept.
   */
  tarPowerPerDay: { 1.15: 0.0573, 2.3: 0.1145, 3.45: 0.1718 } as Readonly<Record<number, number>>,
  /** Social-tariff discount on the TAR, BTN <= 6,9 kVA (Diretiva n.º 1/2026, artigo 41.º, n.º 2). */
  socialTariff: {
    /** Contracted power up to which the social tariff applies, kVA (Decreto-Lei n.º 15/2022). */
    upToKva: 6.9,
    /** Discount on the power term, EUR per day, simple, bi-hourly and tri-hourly. */
    powerPerDay: { 1.15: 0.0361, 2.3: 0.0722, 3.45: 0.1083, 4.6: 0.1444, 5.75: 0.1806, 6.9: 0.2166 } as Readonly<
      Record<number, number>
    >,
    /** Discount on energy, EUR per kWh, every period of every option. */
    energyPerKwh: 0.0468,
  },
  /** Contribuição para o Audiovisual, EUR a month, before its 6% VAT. */
  cavPerMonth: 2.85,
  /** CAV for the social-tariff beneficiaries the manual lists, EUR a month, before VAT. */
  cavPerMonthReduced: 1.0,
  /** No CAV when the annual consumption is below this many kWh (Lei n.º 30/2003, artigo 4.º, n.º 1). */
  cavExemptBelowKwhPerYear: 400,
  /** Imposto Especial de Consumo de Eletricidade, EUR per kWh, before 23% VAT. */
  iecPerKwh: 0.001,
  vat: {
    reduced: 0.06,
    standard: 0.23,
    /**
     * Reduced rate on the TAR fixed term (not on the rest of the power term) up to this contracted
     * power, kVA (Lista I, verba 2.33).
     */
    powerTermReducedUpToKva: 3.45,
    /** Reduced rate on energy, up to this contracted power, kVA (Lista I, verba 2.38). */
    energyReducedUpToKva: 6.9,
    /** kWh per 30 days that get the reduced rate. */
    reducedKwhPer30Days: 200,
    /** The same, for households of five or more people. */
    reducedKwhPer30DaysLargeFamily: 300,
    /** The days the two thresholds above refer to. */
    thresholdDays: 30,
  },
} as const;
