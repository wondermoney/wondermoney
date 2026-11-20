// Public brand names for the supplier codes in ERSE's offers export (the "COM" column), which gives
// only a code. Each name is as the supplier writes it on its own site (checked on 2026-11-20 on the
// site the export links for the supplier; Iberdrola's site refused automated requests, so its name
// is the one its iberdrola.pt domain and offer documents carry). A code with no entry shows as the
// code, so a new supplier in a weekly refresh still appears; add its name here.
//
// The regulated tariff ("TUR", supplied by SU Eletricidade) is not a brand: the page labels it
// with its own localized name.

export const ELECTRICITY_SUPPLIER_NAMES = {
  ALFAENERGIA: "Alfa Energia",
  AUDAX: "Audax",
  COOP: "Coopérnico",
  EDPC: "EDP",
  END: "Endesa",
  ENIPLENITUDE: "Plenitude",
  EZUENERGIA: "EZU Energia",
  GALP: "Galp",
  GOLD: "Goldenergy",
  IBD: "Iberdrola",
  JAFPLUS: "JAFplus",
  LOGICA: "Logica Energy",
  LUZBOA: "Luzboa",
  LUZIGAS: "LuziGás",
  MEOENERGIA: "MEO Energia",
  NABALIAENERGIA: "Nabalia Energia",
  NOSSAENERGIA: "Nossa Energia",
  OENEO: "OENEO Energy",
  PORTULOGOS: "Portulogos",
  REPSOL: "Repsol",
  YESENERGY: "Yes Energy",
} as const satisfies Record<string, string>;

export type KnownSupplierCode = keyof typeof ELECTRICITY_SUPPLIER_NAMES;

/** The brand name of a supplier code, or the code itself when it has none yet. */
export function supplierName(code: string): string {
  return (ELECTRICITY_SUPPLIER_NAMES as Record<string, string>)[code] ?? code;
}
