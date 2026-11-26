import type { InstanceDescription } from "@/lib/api/instance/useInstance";
import { type DocsLocale, docsLocaleFor } from "@/lib/docs-links";

/** The optional parts of a server the setup page lists, in the order it lists them. */
export const SETUP_FEATURES = [
  "email",
  "fileStorage",
  "ai",
  "bankSync",
  "marketData",
  "googleSignIn",
  "singleSignOn",
] as const;

export type SetupFeature = (typeof SETUP_FEATURES)[number];

export interface SetupChecklistItem {
  /** Where the docs explain how to turn it on. */
  docsHref: string;
  feature: SetupFeature;
  on: boolean;
}


/**
 * The heading anchors of `self-hosting/configure` in each docs locale. The docs slug the localized
 * heading, so the anchor differs per language.
 */
const CONFIGURE_ANCHORS: Record<
  DocsLocale,
  Record<Exclude<SetupFeature, "singleSignOn">, string>
> = {
  en: {
    ai: "ai-features",
    bankSync: "bank-sync",
    email: "email",
    fileStorage: "file-storage",
    googleSignIn: "google-sign-in",
    marketData: "market-data",
  },
  es: {
    ai: "funciones-de-ia",
    bankSync: "sincronización-bancaria",
    email: "correo",
    fileStorage: "almacenamiento-de-archivos",
    googleSignIn: "inicio-de-sesión-con-google",
    marketData: "datos-de-mercado",
  },
  pt: {
    ai: "funcionalidades-de-ia",
    bankSync: "sincronização-bancária",
    email: "email",
    fileStorage: "armazenamento-de-ficheiros",
    googleSignIn: "início-de-sessão-com-google",
    marketData: "dados-de-mercado",
  },
};

function isOn(
  feature: SetupFeature,
  features: InstanceDescription["features"],
): boolean {
  switch (feature) {
    case "ai":
      return Object.values(features.ai).some(Boolean);
    case "bankSync":
      return features.bankSync;
    case "email":
      return features.email;
    case "fileStorage":
      return features.fileStorage;
    case "googleSignIn":
      return features.googleSignIn;
    case "marketData":
      return features.marketData;
    case "singleSignOn":
      return Boolean(features.oidc);
  }
}

/**
 * What the setup page shows about this server: each optional feature, whether the operator has
 * turned it on (from `GET /v1/instance` `features`), and the docs section that explains it. The
 * list only reports: every setting is an environment variable on the server.
 */
export function setupChecklist(
  features: InstanceDescription["features"],
  locale: string,
  docsUrl: string,
): SetupChecklistItem[] {
  const docsLocale = docsLocaleFor(locale);
  const selfHosting = `${docsUrl.replace(/\/+$/u, "")}/${docsLocale}/docs/self-hosting`;
  return SETUP_FEATURES.map((feature) => ({
    docsHref:
      feature === "singleSignOn"
        ? `${selfHosting}/single-sign-on`
        : `${selfHosting}/configure#${CONFIGURE_ANCHORS[docsLocale][feature]}`,
    feature,
    on: isOn(feature, features),
  }));
}
