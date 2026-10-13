export interface CampaignLinkOptions {
  destinationUrl: string;
  nextPath?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent: string;
}

/**
 * Composes campaign links centrally and always restores `next` last so it
 * cannot be dropped or replaced by query parameters supplied in the base URL.
 */
export function buildCampaignUrl({
  destinationUrl,
  nextPath = "/pt/portfolio",
  utmSource = "mailjet",
  utmMedium = "email",
  utmCampaign = "portfolio_launch",
  utmContent,
}: CampaignLinkOptions): string {
  const url = new URL(destinationUrl);

  url.searchParams.set("utm_source", utmSource);
  url.searchParams.set("utm_medium", utmMedium);
  url.searchParams.set("utm_campaign", utmCampaign);
  url.searchParams.set("utm_content", utmContent);
  url.searchParams.set("next", nextPath);

  return url.toString();
}
