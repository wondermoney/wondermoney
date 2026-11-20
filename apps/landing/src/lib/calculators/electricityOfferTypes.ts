export type ContractedPowerKva = 1.15 | 2.3 | 3.45 | 4.6 | 5.75 | 6.9 | 10.35 | 13.8 | 17.25 | 20.7 | 27.6 | 34.5 | 41.4;
export interface OfferPrices {          // EUR before VAT; powerPerDay is EUR/day
  simple?: { powerPerDay: number; energy: number };
  biHourly?: { powerPerDay: number; offValley: number; valley: number };            // TV|TVFV|TVP, TVV|TVC
  triHourly?: { powerPerDay: number; peak: number; shoulder: number; valley: number }; // TVP, TVC, TVVz
}
export interface ElectricityOffer {
  id: string;            // COD_Proposta
  supplier: string;      // COM
  name: string;          // NomeProposta
  regulated: boolean;    // TUR
  dual: boolean;         // Fornecimento DUAL (requires gas too)
  segment: "domestic" | "all";
  indexed: boolean;      // FiltroPrecosIndex_ELE
  renewable: boolean;    // FiltroRenovavel_ELE
  conditioned: boolean;  // FiltroRestrições (ERSE "ofertas condicionadas")
  loyalty: boolean;      // FiltroFidelização
  socialTariff: boolean; // FiltroTarifaSocial
  durationMonths: number | null;
  validFrom: string; validTo: string | null;   // ISO dates
  mandatoryServicesPerYear: number;            // CustoServicos_c/IVA, EUR with VAT
  refunds: { fixedPerYear: number; powerPercent: number; energyPercent: number; energyPerKwh: number };
  newClient: { fixedPerYear: number; powerPercent: number; energyPercent: number; energyPerKwh: number };
  requirements: { directDebit: boolean; eInvoice: boolean }; // decoded from FiltroPagamento / Filtrofaturacao
  conditions: string;   // TxTModalidade
  notes: string;        // TxTERSE
  links: { offer?: string; standardSheet?: string; terms?: string; supplier?: string };
  prices: Partial<Record<ContractedPowerKva, OfferPrices>>;
}
