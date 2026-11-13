import type {
  CryptoWalletDto,
  ManualAsset,
} from "@/lib/api/manual-asset/types";

/** An asset as the API returns it: a shared home in euros, valued once, owned by the viewer. */
export function manualAsset(overrides: Partial<ManualAsset> = {}): ManualAsset {
  return {
    manualAssetKey: 1,
    name: "Family home",
    kind: "property",
    notes: null,
    currency: "EUR",
    currencyKey: 1,
    isPrivate: false,
    isOwner: true,
    ownerAppuserKey: 10,
    ownerFirstName: "Ana",
    archived: false,
    archivedAt: null,
    purchaseDate: null,
    purchasePrice: null,
    growthRule: null,
    value: 250_000,
    valueInUserCurrency: 250_000,
    userCurrency: "EUR",
    lastValuation: {
      manualAssetValuationKey: 100,
      date: "2026-06-01",
      value: 250_000,
      note: null,
    },
    linkedLoans: [],
    linkedDebt: 0,
    equity: 250_000,
    unconvertedLoanCurrencies: [],
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * A text matcher for a figure `Amount` splits into several nodes (symbol,
 * digits): the innermost element whose whole text is `text`.
 */
export function figure(text: string | RegExp) {
  const matches = (element: Element | null) => {
    const content = (element?.textContent ?? "").replace(/\s+/g, " ").trim();
    return typeof text === "string" ? content === text : text.test(content);
  };
  return (_content: string, element: Element | null) =>
    matches(element) && !Array.from(element?.children ?? []).some(matches);
}

/** A wallet as the API returns it: one Bitcoin address, read, with its coin counted. */
export function cryptoWallet(
  overrides: Partial<CryptoWalletDto> = {},
): CryptoWalletDto {
  return {
    addresses: [
      {
        cryptoWalletAddressKey: 11,
        chain: "bitcoin",
        kind: "address",
        address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        label: "Cold storage",
        status: "ok",
        errorCode: null,
        lastAttemptAt: "2026-11-12T04:30:00.000Z",
        lastSyncedAt: "2026-11-12T04:30:00.000Z",
        tokens: [
          {
            cryptoWalletTokenKey: 21,
            native: true,
            contractAddress: null,
            symbol: "BTC",
            name: "Bitcoin",
            quantity: "0.01234567",
            tracked: true,
            priceMissing: false,
          },
        ],
      },
    ],
    lastSyncedAt: "2026-11-12T04:30:00.000Z",
    unpricedSymbols: [],
    ...overrides,
  };
}

/** A crypto wallet asset: valued in US dollars from its balances. */
export function cryptoWalletAsset(
  overrides: Partial<ManualAsset> = {},
): ManualAsset {
  return manualAsset({
    name: "Hardware wallet",
    kind: "crypto_wallet",
    currency: "USD",
    currencyKey: 2,
    value: 1_200,
    valueInUserCurrency: 1_100,
    lastValuation: {
      manualAssetValuationKey: 300,
      date: "2026-11-12",
      value: 1_200,
      note: null,
    },
    linkedDebt: 0,
    equity: 1_200,
    ...overrides,
  });
}
