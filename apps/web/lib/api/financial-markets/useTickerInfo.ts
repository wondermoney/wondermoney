import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";

// Only the profile + price-snapshot fields the info card / fundamentals block
// render; the API's strict info DTO carries nothing else.
export interface CompanyInformation {
  symbol: string;
  companyName: string;
  currency?: SupportedCurrencyCodes;
  industry: string;
  image: string;
  beta: number | null;
  // Nullable on purpose. The provider's current plan returns no live quote,
  // so these arrive as null and the info card is written to show "—" for them.
  price: number | null;
  changePercentage: number | null;
}

export interface CompanyInformationResponse {
  companyInformation: CompanyInformation;
}

// The strict info DTO shape returned by the API, wrapped in the
// { companyInformation } envelope (null when the provider has no profile).
interface CompanyInfoDto {
  symbol: string;
  name: string | null;
  currency: string | null;
  industry: string | null;
  image: string | null;
  beta: number | null;
  price: number | null;
  changePercentage: number | null;
}

interface CompanyInfoApiResponse {
  companyInformation: CompanyInfoDto | null;
}

// Neutral placeholder when the provider has no (https) logo — Next <Image>
// rejects an empty src, and this asset already ships as the search fallback.
const FALLBACK_LOGO = "/chart-candlestick.svg";

async function getCompanyInfo(
  ticker: string,
  apiClient: AxiosInstance = api,
): Promise<CompanyInformationResponse> {
  const { data } = await apiClient.get<CompanyInfoApiResponse>(
    `/v1/financial-markets/ticker/${ticker}/info`,
  );
  const info = data.companyInformation;
  return {
    // Preserve the pre-existing contract: a missing profile surfaces as a null
    // companyInformation (the callers already gate on the query error state).
    companyInformation: info
      ? {
          symbol: info.symbol,
          companyName: info.name ?? "",
          currency: (info.currency ?? undefined) as
            | SupportedCurrencyCodes
            | undefined,
          industry: info.industry ?? "",
          image: info.image ?? FALLBACK_LOGO,
          beta: info.beta,
          // The API returns null for both while the provider has no live
          // quote. Never coerce to zero: that would make the info card's own
          // `=== null` guard unreachable and render "Price US$0.00" next to a
          // chart showing $330. A missing quote is not a quote of zero; pass
          // the null through and let the card say "—".
          price: info.price,
          changePercentage: info.changePercentage,
        }
      : (null as unknown as CompanyInformation),
  };
}

export default function useCompanyInfo<R = CompanyInformationResponse>(
  ticker: string,
  options?: Omit<
    UseQueryOptions<CompanyInformationResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["company-info", ticker],
    queryFn: () => getCompanyInfo(ticker),
    ...options,
  });
}
