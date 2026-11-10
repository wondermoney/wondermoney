import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { Lang } from "./i18nLocale";
import { getTranslations, type Translate } from "./translations";

type ReactTranslationsContextValue = {
	locale: Lang;
	t: Translate;
};

const ReactTranslationsContext = createContext<ReactTranslationsContextValue | null>(null);

type ReactTranslationsProviderProps = {
	locale: Lang;
	children: ReactNode;
};

export function ReactTranslationsProvider({ locale, children }: ReactTranslationsProviderProps) {
	const value = useMemo(
		() => ({
			locale,
			t: getTranslations(locale),
		}),
		[locale],
	);

	return <ReactTranslationsContext.Provider value={value}>{children}</ReactTranslationsContext.Provider>;
}

export function useTranslations() {
	const context = useContext(ReactTranslationsContext);

	if (!context) {
		throw new Error("useTranslations must be used within ReactTranslationsProvider");
	}

	return context;
}
