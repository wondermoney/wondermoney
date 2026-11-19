// ERSE regulated-market tariffs for low-voltage normal households in mainland Portugal, kept by
// hand from ERSE's official documents. Edit it when ERSE publishes new prices (they were updated on
// 1 October 2026 and can change again each quarter) and bump `version`. Educational data.
//
// Every figure below was read from these documents, downloaded on 2026-11-19:
//
// 1. ERSE, Diretiva n.º 4/2026 (15 September 2026), first amendment to Diretiva n.º 1/2026, in force
//    from 1 October 2026 ("período IV"): the tarifas transitórias de venda a clientes finais em BTN
//    (<= 20,7 kVA and > 2,3 kVA), article 31: daily power price by contracted power and the energy
//    price per kWh, simple and bi-hourly. Prices are in EUR, before VAT and other taxes.
//    https://www.erse.pt/media/hjab13zj/diretiva-erse-4-2026-ajuste-tenergia-se-4t2026.pdf
// 2. ERSE, "Manual do Simulador de Preços de Energia da ERSE" (June 2026), the bill's other
//    parcels: Contribuição para o Audiovisual 2,85 EUR a month (6% VAT) and IEC 0,001 EUR/kWh
//    (23% VAT).
//    https://www.erse.pt/media/5cen41xv/manual-simulador_jun26.pdf
// 3. ERSE, "ERSExplica: Aplicação do IVA na fatura de eletricidade" (February 2025), the VAT rules
//    (Lei n.º 38/2024 and Decreto-Lei n.º 60/2019).
//    https://www.erse.pt/media/tcsfm4n2/ersexplica_iva-fatura_2025.pdf
//
// Left out on purpose: the DGEG operating fee. ERSE's simulator manual lists it among the bill's
// taxes but its electricity amount could not be confirmed in an ERSE document, so the page does not
// include it and says so.

export const CONTRACTED_POWERS_KVA = [3.45, 4.6, 5.75, 6.9] as const;
export type ContractedPower = (typeof CONTRACTED_POWERS_KVA)[number];

export const ERSE_TARIFFS = {
  /** Bump when a price or a rule changes. */
  version: 1,
  /** First day these prices apply (ERSE "período IV" of 2026). */
  effectiveFrom: "2026-10-01",
  /** When the documents above were read. */
  checkedOn: "2026-11-19",
  sources: {
    tariffs: {
      name: "ERSE, Diretiva n.º 4/2026, de 15 de setembro de 2026 (tarifas e preços de energia elétrica em 2026)",
      url: "https://www.erse.pt/media/hjab13zj/diretiva-erse-4-2026-ajuste-tenergia-se-4t2026.pdf",
    },
    charges: {
      name: "ERSE, Manual do Simulador de Preços de Energia (junho de 2026)",
      url: "https://www.erse.pt/media/5cen41xv/manual-simulador_jun26.pdf",
    },
    vat: {
      name: "ERSE, ERSExplica: Aplicação do IVA na fatura de eletricidade",
      url: "https://www.erse.pt/media/tcsfm4n2/ersexplica_iva-fatura_2025.pdf",
    },
    simulator: {
      name: "Simulador de preços de energia da ERSE",
      url: "https://simulador.precos.erse.pt/",
    },
  },
  /** Power term, EUR per day, before VAT. */
  powerPerDay: { 3.45: 0.1917, 4.6: 0.2499, 5.75: 0.3079, 6.9: 0.3659 } satisfies Record<ContractedPower, number>,
  /** Energy, EUR per kWh, before VAT. Bi-hourly: "fora de vazio" (off-valley) and "vazio" (valley). */
  energyPerKwh: { simple: 0.1711, biPeak: 0.2045, biOffPeak: 0.1143 },
  /** Contribuição para o Audiovisual, EUR a month, before its 6% VAT. */
  cavPerMonth: 2.85,
  /** Imposto Especial de Consumo de Eletricidade, EUR per kWh, before 23% VAT. */
  iecPerKwh: 0.001,
  vat: {
    reduced: 0.06,
    standard: 0.23,
    /** Reduced rate on the power term up to this contracted power, kVA. */
    powerTermReducedUpToKva: 3.45,
    /** Reduced rate on energy, up to this contracted power, kVA. */
    energyReducedUpToKva: 6.9,
    /** kWh per 30 days that get the reduced rate. */
    reducedKwhPer30Days: 200,
    /** The same, for households of five or more people. */
    reducedKwhPer30DaysLargeFamily: 300,
  },
} as const;
