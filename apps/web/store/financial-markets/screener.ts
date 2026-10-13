import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export const AVAILABLE_SECTORS = [
  "Industrials",
  "Technology",
  "Consumer Cyclical",
  "Healthcare",
  "Basic Materials",
  "Real Estate",
  "Consumer Defensive",
  "Communication Services",
  "Energy",
  "Utilities",
  "Metals & Mining",
  "Retail",
  "Construction",
  "Media",
  "Textiles, Apparel & Luxury Goods",
  "Hotels, Restaurants & Leisure",
  "Machinery",
  "Food Products",
  "Financial",
  "Chemicals",
  "Semiconductors",
  "Commercial Services & Supplies",
  "Pharmaceuticals",
  "Electrical Equipment",
  "Trading Companies & Distributors",
  "Banking",
  "Biotechnology",
  "Services",
  "Consumer Goods",
  "Industrial Goods",
  "Building",
  "Insurance",
  "Paper & Forest",
  "Auto Components",
  "Telecommunication",
  "Diversified Consumer Services",
  "Logistics & Transportation",
  "Automobiles",
  "Transportation Infrastructure",
  "Airlines",
  "Aerospace & Defense",
  "Beverages",
  "Consumer products",
  "Professional Services",
  "Leisure Products",
  "Road & Rail",
  "Distributors",
  "Packaging",
  "Marine",
  "Conglomerates",
  "Life Sciences Tools & Services",
];

export const AVAILABLE_INDUSTRIES = [
  "Shell Companies",
  "Biotechnology",
  "Asset Management",
  "Banks—Regional",
  "Software—Application",
  "Specialty Industrial Machinery",
  "Engineering & Construction",
  "Other Industrial Metals & Mining",
  "Drug Manufacturers—Specialty & Generic",
  "Auto Parts",
  "Specialty Chemicals",
  "Information Technology Services",
  "Real Estate Services",
  "Electronic Components",
  "Packaged Foods",
  "Oil & Gas E&P",
  "Capital Markets",
  "Electrical Equipment & Parts",
  "Software—Infrastructure",
  "Medical Devices",
  "Real Estate—Development",
  "Gold",
  "Communication Equipment",
  "Telecom Services",
  "Steel",
  "Chemicals",
  "Conglomerates",
  "Semiconductors",
  "Credit Services",
  "Textile Manufacturing",
  "Furnishings, Fixtures & Appliances",
  "Entertainment",
  "Specialty Business Services",
  "Restaurants",
  "Internet Content & Information",
  "Advertising Agencies",
  "Apparel Manufacturing",
  "Household & Personal Products",
  "Specialty Retail",
  "Building Products & Equipment",
  "Farm Products",
  "Computer Hardware",
  "Aerospace & Defense",
  "Utilities—Regulated Electric",
  "Medical Instruments & Supplies",
  "Medical Care Facilities",
  "Packaging & Containers",
  "Leisure",
  "Marine Shipping",
  "Building Materials",
  "Internet Retail",
  "Oil & Gas Equipment & Services",
  "Electronic Gaming & Multimedia",
  "Utilities—Renewable",
  "Scientific & Technical Instruments",
  "Integrated Freight & Logistics",
  "Health Information Services",
  "Diagnostics & Research",
  "Semiconductor Equipment & Materials",
  "Education & Training Services",
  "Auto Manufacturers",
  "Agricultural Inputs",
  "Farm & Heavy Construction Machinery",
  "Metal Fabrication",
  "REIT—Diversified",
  "Consumer Electronics",
  "Department Stores",
  "Real Estate—Diversified",
  "Waste Management",
  "Staffing & Employment Services",
  "Paper & Paper Products",
  "Lodging",
  "Banks—Diversified",
  "Apparel Retail",
  "Other Precious Metals & Mining",
  "Security & Protection Services",
  "Thermal Coal",
  "Insurance—Diversified",
  "Railroads",
  "Oil & Gas Refining & Marketing",
  "Oil & Gas Midstream",
  "Rental & Leasing Services",
  "Publishing",
  "Luxury Goods",
  "Insurance—Property & Casualty",
  "Beverages—Wineries & Distilleries",
  "Tools & Accessories",
  "Drug Manufacturers—General",
  "Utilities—Regulated Gas",
  "Insurance—Life",
  "Industrial Distribution",
  "Electronics & Computer Distribution",
  "REIT—Mortgage",
  "Grocery Stores",
  "REIT—Retail",
  "Mortgage Finance",
  "Footwear & Accessories",
  "Broadcasting",
  "Oil & Gas Integrated",
  "Consulting Services",
  "Auto & Truck Dealerships",
  "Pollution & Treatment Controls",
  "REIT—Office",
  "Residential Construction",
  "Infrastructure Operations",
  "Food Distribution",
  "Airlines",
  "Travel Services",
  "Gambling",
  "REIT—Industrial",
  "Personal Services",
  "Solar",
  "Utilities—Diversified",
  "Beverages—Non-Alcoholic",
  "Confectioners",
  "Aluminum",
  "Resorts & Casinos",
  "Utilities—Independent Power Producers",
  "Pharmaceutical Retailers",
  "Copper",
  "Business Equipment & Supplies",
  "Utilities—Regulated Water",
  "Lumber & Wood Production",
  "Beverages—Brewers",
  "Medical Distribution",
  "REIT—Residential",
  "Airports & Air Services",
  "Trucking",
  "REIT—Hotel & Motel",
  "Financial Conglomerates",
  "Financial Data & Stock Exchanges",
  "Home Improvement Retail",
  "Coking Coal",
  "Uranium",
  "Tobacco",
  "Recreational Vehicles",
  "Insurance—Reinsurance",
  "Discount Stores",
  "Insurance—Specialty",
  "REIT—Specialty",
  "Insurance Brokers",
  "REIT—Healthcare Facilities",
  "Oil & Gas Drilling",
  "Healthcare Plans",
  "Silver",
  "Capital Goods",
  "Materials",
  "Health Care Equipment & Services",
  "Closed-End Fund - Equity",
  "Transportation",
  "Retailing",
  "Consumer Services",
  "Media & Entertainment",
  "Software & Services",
  "Banks",
  "Utilities",
  "Industrial Metals & Minerals",
  "Food, Beverage & Tobacco",
  "Closed-End Fund - Foreign",
  "Consumer Durables & Apparel",
  "Semiconductors & Semiconductor Equipment",
  "General Building Materials",
  "Commercial  & Professional Services",
  "Communication Services",
  "Semiconductor - Broad Line",
  "Real Estate",
  "Textile Industrial",
  "Retail Apparel & Specialty",
  "Pharmaceuticals, Biotechnology & Life Sciences",
  "Technical & System Software",
  "Diversified Electronics",
  "Diversified Financials",
  "Technology Hardware & Equipment",
  "Real Estate Development",
  "Insurance",
  "Diversified Machinery",
  "Business Services",
  "Rubber & Plastics",
  "Automobiles & Components",
  "Electronic Equipment",
  "Food - Major Diversified",
  "Telecommunication Services",
  "Food & Staples Retailing",
  "Utilities Regulated",
  "Insurance Specialty",
  "Building Materials Wholesale",
  "Regional - Northeast Banks",
  "Homebuilding & Construction",
  "Independent Oil & Gas",
  "General Contractors",
  "Auto Manufacturers - Major",
  "Diversified Utilities",
  "Lumber, Wood Production",
  "Marketing Services",
  "Broadcasting - TV",
  "Diversified Communication Services",
  "CATV Systems",
  "Steel & Iron",
  "Security Software & Services",
  "Money Center Banks",
  "Chemicals - Major Diversified",
  "Industrial Equipment Wholesale",
  "Entertainment - Diversified",
  "Application Software",
  "Energy",
  "Internet Software & Services",
  "Wireless Communications",
  "Utilities Diversified",
  "Home Furnishings & Fixtures",
  "Air Delivery & Freight Services",
  "REIT - Diversified",
  "Business Software & Services",
  "Agricultural Chemicals",
  "Property Management",
  "Shipping",
  "Jewelry Stores",
  "Beverages - Brewers",
  "Medical Appliances & Equipment",
  "Consumer Packaged Goods",
];

export const AVAILABLE_COUNTRIES = [
  "US",
  "CA",
  "RU",
  "BM",
  "FR",
  "IL",
  "MX",
  "IE",
  "IN",
  "CN",
  "HK",
  "DE",
  "GB",
  "NL",
  "MY",
  "AU",
  "LU",
  "ZA",
  "SG",
  "SE",
  "KY",
  "TH",
  "KZ",
  "BR",
  "AE",
  "SA",
  "GG",
  "CY",
  "GR",
  "JP",
  "LI",
  "ID",
  "IT",
  "EG",
  "MC",
  "FI",
  "CH",
  "BE",
  "NO",
  "ES",
  "MO",
  "CL",
  "MT",
  "PL",
  "AT",
  "PT",
  "TR",
  "JE",
  "DK",
  "NZ",
  "VG",
  "PA",
  "IM",
  "MA",
  "TW",
  "RO",
  "AR",
  "QA",
  "KR",
  "AZ",
  "CR",
  "PR",
  "GI",
  "CO",
  "MN",
  "CK",
  "VN",
  "UY",
  "MU",
  "PH",
  "ZM",
  "IS",
  "UA",
  "BG",
  "BS",
  "PG",
  "PE",
  "SK",
  "LT",
  "DO",
  "KH",
  "TC",
  "CW",
  "FK",
  "VI",
  "EE",
  "JO",
  "BD",
  "NG",
  "AI",
  "GA",
  "GE",
  "TG",
  "SN",
  "BB",
];

export const AVAILABLE_EXCHANGES = [
  "nyse",
  "nasdaq",
  "amex",
  "euronext",
  "tsx",
  "etf",
  "mutual_fund",
];

interface ScreenerState {
  marketCapMin: undefined | number;
  marketCapMax: undefined | number;
  priceMin: undefined | number;
  priceMax: undefined | number;
  betaMin: undefined | number;
  betaMax: undefined | number;
  volumeMin: undefined | number;
  volumeMax: undefined | number;
  dividendYieldMin: undefined | number;
  dividendYieldMax: undefined | number;
  isEtf: boolean;
  isActivelyTrading: boolean;
  // FMP's screener endpoint only accepts a single value per dimension, not a
  // list — these are single-select, not multi-select.
  sector: string | undefined;
  availableSectors: typeof AVAILABLE_SECTORS;
  industry: string | undefined;
  availableIndustries: typeof AVAILABLE_INDUSTRIES;
  country: string | undefined;
  availableCountries: typeof AVAILABLE_COUNTRIES;
  exchange: string | undefined;
  availableExchanges: typeof AVAILABLE_EXCHANGES;
  page: number;
  reset: () => void;
  setPage: (page: number) => void;
  changeMarketCapMin: (marketCapMin: number | undefined) => void;
  changeMarketCapMax: (marketCapMax: number | undefined) => void;
  changePriceMin: (priceMin: number | undefined) => void;
  changePriceMax: (priceMax: number | undefined) => void;
  changeBetaMin: (betaMin: number | undefined) => void;
  changeBetaMax: (betaMax: number | undefined) => void;
  changeVolumeMin: (volumeMin: number | undefined) => void;
  changeVolumeMax: (volumeMax: number | undefined) => void;
  changeDividendYieldMin: (dividendYieldMin: number | undefined) => void;
  changeDividendYieldMax: (dividendYieldMax: number | undefined) => void;
  changeIsEtf: (isEtf: boolean) => void;
  changeIsActivelyTrading: (isActivelyTrading: boolean) => void;
  changeSector: (sector: string | undefined) => void;
  changeIndustry: (industry: string | undefined) => void;
  changeCountry: (country: string | undefined) => void;
  changeExchange: (exchange: string | undefined) => void;
}

const useScreenerStore = create<ScreenerState>()(
  immer((set) => ({
    marketCapMin: undefined,
    marketCapMax: undefined,
    priceMin: undefined,
    priceMax: undefined,
    betaMin: undefined,
    betaMax: undefined,
    volumeMin: undefined,
    volumeMax: undefined,
    dividendYieldMin: undefined,
    dividendYieldMax: undefined,
    isEtf: false,
    isActivelyTrading: true,
    sector: undefined,
    availableSectors: AVAILABLE_SECTORS,
    industry: undefined,
    availableIndustries: AVAILABLE_INDUSTRIES,
    country: undefined,
    availableCountries: AVAILABLE_COUNTRIES,
    exchange: undefined,
    availableExchanges: AVAILABLE_EXCHANGES,
    page: 0,
    reset: () =>
      set({
        marketCapMin: undefined,
        marketCapMax: undefined,
        priceMin: undefined,
        priceMax: undefined,
        betaMin: undefined,
        betaMax: undefined,
        volumeMin: undefined,
        volumeMax: undefined,
        dividendYieldMin: undefined,
        dividendYieldMax: undefined,
        isEtf: false,
        isActivelyTrading: true,
        sector: undefined,
        industry: undefined,
        country: undefined,
        exchange: undefined,
        page: 0,
      }),
    setPage: (page) =>
      set((state) => {
        state.page = page;
      }),
    changeMarketCapMin: (marketCapMin) =>
      set((state) => {
        state.marketCapMin = marketCapMin;
        state.page = 0;
      }),
    changeMarketCapMax: (marketCapMax) =>
      set((state) => {
        state.marketCapMax = marketCapMax;
        state.page = 0;
      }),
    changePriceMin: (priceMin) =>
      set((state) => {
        state.priceMin = priceMin;
        state.page = 0;
      }),
    changePriceMax: (priceMax) =>
      set((state) => {
        state.priceMax = priceMax;
        state.page = 0;
      }),
    changeBetaMin: (betaMin) =>
      set((state) => {
        state.betaMin = betaMin;
        state.page = 0;
      }),
    changeBetaMax: (betaMax) =>
      set((state) => {
        state.betaMax = betaMax;
        state.page = 0;
      }),
    changeVolumeMin: (volumeMin) =>
      set((state) => {
        state.volumeMin = volumeMin;
        state.page = 0;
      }),
    changeVolumeMax: (volumeMax) =>
      set((state) => {
        state.volumeMax = volumeMax;
        state.page = 0;
      }),
    changeDividendYieldMin: (dividendYieldMin) =>
      set((state) => {
        state.dividendYieldMin = dividendYieldMin;
        state.page = 0;
      }),
    changeDividendYieldMax: (dividendYieldMax) =>
      set((state) => {
        state.dividendYieldMax = dividendYieldMax;
        state.page = 0;
      }),
    changeIsEtf: (isEtf) =>
      set((state) => {
        state.isEtf = isEtf;
        state.page = 0;
      }),
    changeIsActivelyTrading: (isActivelyTrading) =>
      set((state) => {
        state.isActivelyTrading = isActivelyTrading;
        state.page = 0;
      }),
    changeSector: (sector) =>
      set((state) => {
        state.sector = sector;
        state.page = 0;
      }),
    changeIndustry: (industry) =>
      set((state) => {
        state.industry = industry;
        state.page = 0;
      }),
    changeCountry: (country) =>
      set((state) => {
        state.country = country;
        state.page = 0;
      }),
    changeExchange: (exchange) =>
      set((state) => {
        state.exchange = exchange;
        state.page = 0;
      }),
  })),
);

export default useScreenerStore;
