/** A folder under `src/assets/brands/`, one per kind of brand. */
export type BrandCategory = "banks" | "brokers" | "electricity" | "fuel" | "securities"

export interface BrandLogoEntry {
	category: BrandCategory
	/** The brand as it usually writes its name. */
	name: string
	/** Other spellings the data uses. Matching ignores case, accents, spaces and punctuation already. */
	aliases?: readonly string[]
	/** A 72 px square tile on white (WebP, a few KB), so it reads on any background. */
	logo: ImageMetadata | string
	/** Where the artwork was downloaded: the brand's own website or press kit, never an aggregator. */
	source: string
}
