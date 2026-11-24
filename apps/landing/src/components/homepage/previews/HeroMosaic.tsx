import NetWorthPreview from "./NetWorthPreview";
import { HERO_NET_WORTH } from "./netWorthSample";

/**
 * The hero's one visual: a single household's net worth, where bank accounts plus investments
 * minus the credit card add up to the headline figure. The net worth feature page draws the same
 * card with a second household (`netWorthSample.ts`).
 */
export default function HeroMosaic() {
	return <NetWorthPreview sample={HERO_NET_WORTH} />;
}
