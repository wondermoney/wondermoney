import { Img, Text } from "react-email";

/** The name every email uses when the sender passes none: the hosted service's. */
export const DEFAULT_BRAND_NAME = "WonderMoney";

/**
 * The instance name to print in an email. A self-hosted server passes its `INSTANCE_NAME`;
 * blank or missing falls back to WonderMoney, so the hosted output does not change.
 */
export function resolveBrandName(brandName?: string): string {
  return brandName?.trim() || DEFAULT_BRAND_NAME;
}

/** True when the email carries the hosted service's own branding (logo, legal entity). */
const isDefaultBrand = (brandName: string) => brandName === DEFAULT_BRAND_NAME;

/**
 * The hosted logo, or the instance name as a wordmark: another instance's emails should not
 * load an image from wonder.money under someone else's name.
 */
export function BrandHeader({ brandName }: { brandName: string }) {
  if (isDefaultBrand(brandName)) {
    return (
      <Img
        src="https://app.wonder.money/logo.png"
        width="125"
        height="46"
        alt={DEFAULT_BRAND_NAME}
        className="block h-[46px] w-[125px] object-contain"
      />
    );
  }

  return (
    <Text className="m-0 font-sans text-[20px] font-semibold leading-[28px] text-[#111111]">
      {brandName}
    </Text>
  );
}

/** Closing footer line. The legal entity belongs to the hosted service only. */
export function BrandFooterLine({ brandName }: { brandName: string }) {
  return (
    <Text className="m-0 font-sans text-[10px] leading-[16px] text-[#9ca3af]">
      {isDefaultBrand(brandName) ? `${DEFAULT_BRAND_NAME} · Radix Catch, Lda. · Portugal` : brandName}
    </Text>
  );
}
